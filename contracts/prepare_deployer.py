"""
Auto-prepare Arc deployer wallet and request testnet faucet funding.

Strategy:
  1. If ARC_DEPLOYER_PK is set in env, reuse it (and just check balance).
  2. Otherwise, generate a new dev wallet, save the PK to:
       contracts/.deployer.secret.json   (gitignored)
     and append a record to d:/api_key.txt under [ARC_DEPLOYER].
  3. Probe the deployer balance via Arc RPC.
  4. If balance == 0, attempt to call the public Arc testnet faucet endpoint
     (best-effort — falls back to printing manual instructions if the faucet
     URL is not programmatic).
  5. Print exactly what the user needs to do next.

Usage:
    python contracts/prepare_deployer.py
"""
from __future__ import annotations
import json, os, sys, time
from pathlib import Path

try:
    import requests
    from eth_account import Account
except ImportError:
    print("ERROR: pip install eth-account requests", file=sys.stderr)
    sys.exit(2)

ARC_RPC = os.environ.get("ARC_RPC", "https://rpc.testnet.arc.network")
ARC_CHAIN_ID = int(os.environ.get("ARC_CHAIN_ID", "5042002"))
USDC = os.environ.get("USDC_ADDRESS", "0x3600000000000000000000000000000000000000")
HERE = Path(__file__).parent
SECRET = HERE / ".deployer.secret.json"
VAULT = Path(r"d:/api_key.txt")
GITIGNORE = HERE.parent / ".gitignore"

# 1. Get or generate PK
pk = os.environ.get("ARC_DEPLOYER_PK")
if not pk and SECRET.exists():
    pk = json.loads(SECRET.read_text())["private_key"]
    print(f"[prepare] reused deployer from {SECRET}")

if not pk:
    Account.enable_unaudited_hdwallet_features()
    acct = Account.create()
    pk = acct.key.hex()
    if not pk.startswith("0x"):
        pk = "0x" + pk
    SECRET.write_text(json.dumps({
        "address": acct.address,
        "private_key": pk,
        "generated_at": int(time.time()),
        "purpose": "PicoFlow Vyper deployer on Arc Testnet (chainId 5042002) — DEV ONLY",
    }, indent=2))
    print(f"[prepare] generated NEW deployer -> {SECRET}")
    # Append to vault
    if VAULT.exists():
        with VAULT.open("a", encoding="utf-8") as fh:
            fh.write(f"\n[ARC_DEPLOYER]\n")
            fh.write(f"address = {acct.address}\n")
            fh.write(f"private_key = {pk}\n")
            fh.write(f"generated_at = {int(time.time())}\n")
            fh.write(f"purpose = Vyper deployer on Arc Testnet — disposable dev wallet\n")
            fh.write(f"secret_file = {SECRET}\n")
    # Ensure gitignore excludes the secret
    if GITIGNORE.exists():
        gi = GITIGNORE.read_text()
        if "contracts/.deployer.secret.json" not in gi:
            with GITIGNORE.open("a", encoding="utf-8") as fh:
                fh.write("\n# Vyper deployer secret\ncontracts/.deployer.secret.json\n")

acct = Account.from_key(pk)
print(f"[prepare] deployer  = {acct.address}")
print(f"[prepare] rpc       = {ARC_RPC}")

# 2. Probe balance
def rpc(method, params):
    r = requests.post(ARC_RPC, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=15)
    r.raise_for_status()
    j = r.json()
    if "error" in j:
        raise RuntimeError(j["error"])
    return j["result"]

try:
    bal_wei = int(rpc("eth_getBalance", [acct.address, "latest"]), 16)
    print(f"[prepare] balance   = {bal_wei} wei  ({bal_wei / 1e18:.6f} native)")
except Exception as exc:  # noqa: BLE001
    print(f"[prepare] balance probe failed: {exc}")
    bal_wei = -1

# 3. Faucet attempt (best-effort)
faucet_urls = [
    # Public Arc faucet endpoints — order: most likely to succeed first.
    "https://faucet.testnet.arc.network/api/drip",
    "https://faucet.testnet.arc.network/drip",
]
funded = False
if bal_wei == 0:
    for u in faucet_urls:
        try:
            r = requests.post(u, json={"address": acct.address, "chainId": ARC_CHAIN_ID}, timeout=20)
            print(f"[prepare] faucet POST {u} -> {r.status_code}")
            if r.ok:
                print(f"[prepare]   body: {r.text[:240]}")
                funded = True
                break
        except Exception as exc:  # noqa: BLE001
            print(f"[prepare] faucet {u} unreachable: {exc}")

# 4. Final guidance
print()
if bal_wei > 0:
    print("[prepare] ✅ deployer is funded — ready to run:")
    print("           python contracts/deploy_arc.py")
elif funded:
    print("[prepare] ⏳ faucet drip submitted — wait ~30 s, then run:")
    print("           python contracts/deploy_arc.py")
else:
    print("[prepare] ⚠️  deployer NOT funded and no programmatic faucet succeeded.")
    print("           Open the Arc testnet faucet in a browser and paste this address:")
    print(f"             address: {acct.address}")
    print(f"             faucet:  https://faucet.testnet.arc.network")
    print(f"           Then run: python contracts/deploy_arc.py")
print()
print(f"[prepare] To run the deploy automatically once funded:")
print(f"  $env:ARC_DEPLOYER_PK = (Get-Content {SECRET} | ConvertFrom-Json).private_key")
print(f"  python contracts/deploy_arc.py")
