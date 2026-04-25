"""
PicoFlow Vyper deployment script for Arc Testnet (chainId 5042002).

Deploys: BondVault.vy, ReputationRegistry.vy, MetadataLogger.vy
Writes results to ./deployments.arc-testnet.json

Usage (PowerShell):
    $env:ARC_DEPLOYER_PK = "0x...64hex..."
    python contracts/deploy_arc.py

Requirements (install once):
    pip install titanoboa eth-account requests
"""
from __future__ import annotations
import json
import os
import sys
import time
from pathlib import Path

ARC_RPC = os.environ.get("ARC_RPC", "https://rpc.testnet.arc.network")
ARC_CHAIN_ID = int(os.environ.get("ARC_CHAIN_ID", "5042002"))
PK = os.environ.get("ARC_DEPLOYER_PK")
ARC_USDC_ADDR = os.environ.get("ARC_USDC_ADDR", "0x3600000000000000000000000000000000000000")
VALIDATION_WINDOW_SECS = int(os.environ.get("BOND_VALIDATION_WINDOW_SECS", "3600"))
HERE = Path(__file__).parent
OUT = HERE / "deployments.arc-testnet.json"

if not PK:
    print("ERROR: set ARC_DEPLOYER_PK env var (0x-prefixed 64-hex private key)", file=sys.stderr)
    sys.exit(2)

try:
    import boa  # titanoboa
    from eth_account import Account
except ImportError:
    print("ERROR: pip install titanoboa eth-account", file=sys.stderr)
    sys.exit(2)

print(f"[deploy] RPC      = {ARC_RPC}")
print(f"[deploy] chainId  = {ARC_CHAIN_ID}")

boa.set_network_env(ARC_RPC)
acct = Account.from_key(PK)
boa.env.add_account(acct, force_eoa=True)
print(f"[deploy] deployer = {acct.address}")


def clean_address(name: str, value: str) -> str:
    if not (value.startswith("0x") and len(value) == 42):
        raise SystemExit(f"ERROR: {name} must be a 0x-prefixed EVM address")
    int(value[2:], 16)
    return value


ARC_USDC_ADDR = clean_address("ARC_USDC_ADDR", ARC_USDC_ADDR)
INSURANCE_ADDR = clean_address("INSURANCE_ADDR", os.environ.get("INSURANCE_ADDR") or os.environ.get("PLATFORM_ADDR") or acct.address)
BOND_VALIDATOR_ADDR = clean_address("BOND_VALIDATOR_ADDR", os.environ.get("BOND_VALIDATOR_ADDR") or os.environ.get("VALIDATOR_ADDR") or acct.address)
if VALIDATION_WINDOW_SECS <= 0:
    raise SystemExit("ERROR: BOND_VALIDATION_WINDOW_SECS must be > 0")

print(f"[deploy] Arc USDC = {ARC_USDC_ADDR}")
print(f"[deploy] insurance = {INSURANCE_ADDR}")
print(f"[deploy] validator = {BOND_VALIDATOR_ADDR}")
print(f"[deploy] bond validation window = {VALIDATION_WINDOW_SECS}s")

contracts = [
    ("BondVault", HERE / "BondVault.vy", [ARC_USDC_ADDR, INSURANCE_ADDR, VALIDATION_WINDOW_SECS, BOND_VALIDATOR_ADDR]),
    ("ReputationRegistry", HERE / "ReputationRegistry.vy", []),
    ("MetadataLogger", HERE / "MetadataLogger.vy", []),
]

results: dict[str, dict[str, str]] = {}
for name, path, args in contracts:
    print(f"[deploy] -> {name} from {path.name}")
    t0 = time.time()
    src = path.read_text(encoding="utf-8")
    deployed = boa.loads(src, *args)
    addr = str(deployed.address)
    # boa stores last tx hash on env; fall back if unavailable
    tx_hash = getattr(getattr(boa.env, "_last_tx", None), "hash", None)
    tx_hex = tx_hash.hex() if tx_hash else ""
    elapsed = round(time.time() - t0, 2)
    print(f"[deploy]    address = {addr}  ({elapsed}s)  tx = {tx_hex}")
    results[name] = {"address": addr, "tx_hash": tx_hex, "deployed_at": int(time.time())}

OUT.write_text(json.dumps({
    "chainId": ARC_CHAIN_ID,
    "rpc": ARC_RPC,
    "deployer": acct.address,
    "contracts": results,
}, indent=2), encoding="utf-8")

print(f"[deploy] wrote {OUT}")
print("[deploy] DONE")
