# @version 0.4.3
# @title MetadataLogger — append-only event sink for action metadata hashes.

event ActionMetadata:
    action_id: indexed(bytes32)
    seller: indexed(address)
    buyer: indexed(address)
    metadata_hash: bytes32
    price_atomic: uint256
    timestamp: uint256

@external
def log_action(action_id: bytes32, seller: address, buyer: address, metadata_hash: bytes32, price_atomic: uint256):
    log ActionMetadata(
        action_id=action_id,
        seller=seller,
        buyer=buyer,
        metadata_hash=metadata_hash,
        price_atomic=price_atomic,
        timestamp=block.timestamp,
    )
