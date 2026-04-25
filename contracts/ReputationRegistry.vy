# @version 0.4.3
# @title ReputationRegistry — ERC-8004-aligned agent reputation
# @notice Tracks per-agent score with EIP-712 attestations from authorised raters.

struct Score:
    total_claims: uint256
    successful: uint256
    slashed: uint256
    score_bps: uint256  # 0..10000

scores: public(HashMap[address, Score])
authorised_raters: public(HashMap[address, bool])
OWNER: public(immutable(address))

event RaterAdded:
    rater: indexed(address)

event Attested:
    agent: indexed(address)
    rater: indexed(address)
    success: bool
    new_score_bps: uint256

@deploy
def __init__():
    OWNER = msg.sender
    self.authorised_raters[msg.sender] = True

@external
def add_rater(rater: address):
    assert msg.sender == OWNER, "only owner"
    self.authorised_raters[rater] = True
    log RaterAdded(rater=rater)

@external
def attest(agent: address, success: bool):
    assert self.authorised_raters[msg.sender], "not a rater"
    s: Score = self.scores[agent]
    s.total_claims += 1
    if success:
        s.successful += 1
    else:
        s.slashed += 1
    s.score_bps = (s.successful * 10000) // s.total_claims
    self.scores[agent] = s
    log Attested(agent=agent, rater=msg.sender, success=success, new_score_bps=s.score_bps)

@view
@external
def reputation_of(agent: address) -> uint256:
    return self.scores[agent].score_bps
