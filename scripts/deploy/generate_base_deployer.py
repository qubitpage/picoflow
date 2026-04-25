from __future__ import annotations

import json
import time
from pathlib import Path

from eth_account import Account

ROOT = Path(__file__).resolve().parents[2]
SECRET_PATH = ROOT / "contracts" / ".base-mainnet.deployer.secret.json"
CREDENTIALS_PATH = ROOT / ".env.credentials"
API_KEYS_PATH = Path(r"D:\api_keys.txt")


def main() -> int:
    if SECRET_PATH.exists():
        data = json.loads(SECRET_PATH.read_text(encoding="utf-8"))
        address = data["address"]
        created = False
    else:
        account = Account.create()
        address = account.address
        data = {
            "network": "base-mainnet",
            "chain_id": 8453,
            "address": address,
            "private_key": "0x" + account.key.hex().removeprefix("0x"),
            "created_at": int(time.time()),
            "purpose": "PicoFlow Base mainnet contract deployer only; fund with ETH gas, deploy, then archive.",
        }
        SECRET_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
        created = True

    credentials = CREDENTIALS_PATH.read_text(encoding="utf-8")
    block = f"""
# ============================================================================
# BASE MAINNET — REAL-MONEY FALLBACK UNTIL ARC MAINNET LAUNCHES
# ============================================================================
BASE_MAINNET_RPC_PRIMARY=https://mainnet.base.org
BASE_MAINNET_RPC_FALLBACK_1=https://base-rpc.publicnode.com
BASE_MAINNET_RPC_FALLBACK_2=https://base.llamarpc.com
BASE_MAINNET_CHAIN_ID=8453
BASE_MAINNET_USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
BASE_MAINNET_DEPLOYER={address}
BASE_MAINNET_DEPLOYER_SECRET_FILE=contracts/.base-mainnet.deployer.secret.json
BASE_MAINNET_MIN_NATIVE_BALANCE=0.005
"""
    if "BASE MAINNET — REAL-MONEY FALLBACK" not in credentials:
        CREDENTIALS_PATH.write_text(credentials.rstrip() + "\n" + block, encoding="utf-8")

    if API_KEYS_PATH.exists():
        api_keys = API_KEYS_PATH.read_text(encoding="utf-8")
        entry = f"PicoFlow Base mainnet deployer: {address} (private key saved in {SECRET_PATH})"
        if address not in api_keys:
            API_KEYS_PATH.write_text(api_keys.rstrip() + "\n\n" + entry + "\n", encoding="utf-8")

    print(json.dumps({"created": created, "address": address, "secret_file": str(SECRET_PATH)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
