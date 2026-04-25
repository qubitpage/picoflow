# @version 0.4.3
# @title BondVault — PicoFlow / ProofMesh
# @notice Sellers stake USDC against claim_ids. Validators may slash on failure;
#         otherwise stake refunds after `validation_window`.

from ethereum.ercs import IERC20

USDC: public(immutable(IERC20))
INSURANCE: public(immutable(address))
VALIDATION_WINDOW: public(immutable(uint256))
OWNER: public(immutable(address))

struct Bond:
    staker: address
    amount: uint256
    staked_at: uint256
    resolved: bool

bonds: public(HashMap[bytes32, Bond])
validators: public(HashMap[address, bool])

event Staked:
    claim_id: indexed(bytes32)
    staker: indexed(address)
    amount: uint256

event Slashed:
    claim_id: indexed(bytes32)
    validator: indexed(address)
    validator_share: uint256
    insurance_share: uint256

event Refunded:
    claim_id: indexed(bytes32)
    staker: indexed(address)
    amount: uint256

event ValidatorSet:
    validator: indexed(address)
    allowed: bool

@deploy
def __init__(usdc: IERC20, insurance: address, validation_window_secs: uint256, initial_validator: address):
    assert insurance != empty(address), "insurance required"
    assert validation_window_secs > 0, "window required"
    USDC = usdc
    INSURANCE = insurance
    VALIDATION_WINDOW = validation_window_secs
    OWNER = msg.sender
    if initial_validator != empty(address):
        self.validators[initial_validator] = True
        log ValidatorSet(validator=initial_validator, allowed=True)

@external
def set_validator(validator: address, allowed: bool):
    assert msg.sender == OWNER, "owner only"
    assert validator != empty(address), "validator required"
    self.validators[validator] = allowed
    log ValidatorSet(validator=validator, allowed=allowed)

@external
def stake(claim_id: bytes32, amount: uint256):
    assert self.bonds[claim_id].staker == empty(address), "claim already bonded"
    assert amount > 0, "amount required"
    extcall USDC.transferFrom(msg.sender, self, amount)
    self.bonds[claim_id] = Bond(
        staker=msg.sender,
        amount=amount,
        staked_at=block.timestamp,
        resolved=False,
    )
    log Staked(claim_id=claim_id, staker=msg.sender, amount=amount)

@external
def slash(claim_id: bytes32):
    assert self.validators[msg.sender], "not validator"
    bond: Bond = self.bonds[claim_id]
    assert not bond.resolved, "already resolved"
    assert bond.amount > 0, "no such bond"
    self.bonds[claim_id].resolved = True
    half: uint256 = bond.amount // 2
    extcall USDC.transfer(msg.sender, half)
    extcall USDC.transfer(INSURANCE, bond.amount - half)
    log Slashed(claim_id=claim_id, validator=msg.sender, validator_share=half, insurance_share=bond.amount - half)

@external
def refund(claim_id: bytes32):
    bond: Bond = self.bonds[claim_id]
    assert not bond.resolved, "already resolved"
    assert bond.amount > 0, "no such bond"
    assert block.timestamp >= bond.staked_at + VALIDATION_WINDOW, "window not elapsed"
    self.bonds[claim_id].resolved = True
    extcall USDC.transfer(bond.staker, bond.amount)
    log Refunded(claim_id=claim_id, staker=bond.staker, amount=bond.amount)
