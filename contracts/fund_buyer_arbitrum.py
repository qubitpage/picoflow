"""
Mint a mainnet buyer wallet, fund with USDC from deployer.
Idempotent: if .arbitrum-buyer.secret.json exists, reuse it.
"""
import json, os, sys, time, pathlib
from eth_account import Account
from web3 import Web3

ROOT = pathlib.Path(__file__).resolve().parent
DEPLOYER_SECRET = ROOT / ".arbitrum-mainnet.deployer.secret.json"
BUYER_SECRET = ROOT / ".arbitrum-buyer.secret.json"
RPC = "https://arb1.arbitrum.io/rpc"
USDC = Web3.to_checksum_address("0xaf88d065e77c8cC2239327C5EDb3A432268e5831")
USDC_DECIMALS = 6
TRANSFER_USDC = float(os.environ.get("TRANSFER_USDC", "0.10"))  # default 0.10 USDC

ERC20_ABI = [
    {"name": "transfer", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "to", "type": "address"}, {"name": "amount", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"name": "balanceOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "a", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
]

def main():
    deployer = json.loads(DEPLOYER_SECRET.read_text())
    deployer_pk = deployer["private_key"]
    if not deployer_pk.startswith("0x"):
        deployer_pk = "0x" + deployer_pk
    deployer_acc = Account.from_key(deployer_pk)
    print(f"[deployer] {deployer_acc.address}")

    if BUYER_SECRET.exists():
        buyer = json.loads(BUYER_SECRET.read_text())
        buyer_acc = Account.from_key(buyer["private_key"])
        print(f"[buyer]    {buyer_acc.address} (existing)")
    else:
        buyer_acc = Account.create()
        BUYER_SECRET.write_text(json.dumps({
            "network": "arbitrum-mainnet",
            "chain_id": 42161,
            "address": buyer_acc.address,
            "private_key": buyer_acc.key.hex(),
            "created_at": int(time.time()),
            "purpose": "PicoFlow Arbitrum mainnet buyer wallet for production rehearsal.",
        }, indent=2))
        print(f"[buyer]    {buyer_acc.address} (NEW, written to {BUYER_SECRET.name})")

    w3 = Web3(Web3.HTTPProvider(RPC))
    assert w3.is_connected(), "RPC down"
    print(f"[chain]    chainId={w3.eth.chain_id}, block={w3.eth.block_number}")

    usdc = w3.eth.contract(address=USDC, abi=ERC20_ABI)

    deployer_eth = w3.eth.get_balance(deployer_acc.address)
    deployer_usdc = usdc.functions.balanceOf(deployer_acc.address).call()
    buyer_eth = w3.eth.get_balance(buyer_acc.address)
    buyer_usdc = usdc.functions.balanceOf(buyer_acc.address).call()
    print(f"[before] deployer ETH={Web3.from_wei(deployer_eth,'ether')} USDC={deployer_usdc/1e6}")
    print(f"[before] buyer    ETH={Web3.from_wei(buyer_eth,'ether')} USDC={buyer_usdc/1e6}")

    target_atomic = int(TRANSFER_USDC * (10**USDC_DECIMALS))
    if buyer_usdc >= target_atomic:
        print(f"[skip] buyer already has >= {TRANSFER_USDC} USDC, no transfer needed.")
        return

    needed = target_atomic - buyer_usdc
    print(f"[plan] transfer {needed/1e6} USDC from deployer -> buyer")

    if "--yes" not in sys.argv:
        ans = input("Proceed? [y/N] ").strip().lower()
        if ans != "y":
            print("[abort]"); return

    nonce = w3.eth.get_transaction_count(deployer_acc.address, "pending")
    print(f"[nonce] {nonce}")
    tx = usdc.functions.transfer(buyer_acc.address, needed).build_transaction({
        "from": deployer_acc.address,
        "nonce": nonce,
        "chainId": 42161,
        "gas": 120_000,
        "maxFeePerGas": w3.to_wei("0.2", "gwei"),
        "maxPriorityFeePerGas": w3.to_wei("0.01", "gwei"),
    })
    signed = deployer_acc.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.raw_transaction)
    print(f"[tx] sent: 0x{h.hex()}")
    rcpt = w3.eth.wait_for_transaction_receipt(h, timeout=180)
    print(f"[tx] mined block {rcpt.blockNumber} status={rcpt.status} gas={rcpt.gasUsed}")
    assert rcpt.status == 1, "tx reverted!"

    buyer_usdc2 = usdc.functions.balanceOf(buyer_acc.address).call()
    print(f"[after] buyer USDC={buyer_usdc2/1e6}")
    print(f"[done] arbiscan: https://arbiscan.io/tx/0x{h.hex()}")


if __name__ == "__main__":
    main()
