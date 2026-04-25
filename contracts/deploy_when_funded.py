"""
Auto-runner: poll deployer balance, then deploy Vyper contracts, then update prod env.

Workflow once the user pastes the deployer address into https://faucet.circle.com:
  1. Poll deployer balance every 30 s for up to MAX_WAIT_S seconds.
  2. As soon as balance ≥ MIN_USDC, invoke deploy_arc.py.
  3. Read deployments.arc-testnet.json, push BOND_VAULT_ADDR / REPUTATION_REGISTRY_ADDR /
     METADATA_LOGGER_ADDR into /opt/picoflow/code/.env.production on Vultr,
     and restart sellers + dashboard containers.
  4. Print a final summary line for the user.

Usage (PowerShell):
    python contracts/deploy_when_funded.py

Env overrides:
    MAX_WAIT_S (default 1800 = 30 min)
    POLL_S    (default 30)
    MIN_NATIVE_WEI (default 1e16 = 0.01 native units; gas paid in USDC at 18 dec on Arc)
"""
from __future__ import annotations
import json, os, subprocess, sys, time
from pathlib import Path

import requests
from eth_account import Account

ARC_RPC = os.environ.get("ARC_RPC", "https://rpc.testnet.arc.network")
HERE = Path(__file__).parent
ROOT = HERE.parent
SECRET = HERE / ".deployer.secret.json"
DEPLOY_OUT = HERE / "deployments.arc-testnet.json"
MERGE_SCRIPT = ROOT / "scripts" / "deploy" / "merge_contract_env.py"
MAX_WAIT_S = int(os.environ.get("MAX_WAIT_S", "1800"))
POLL_S = int(os.environ.get("POLL_S", "30"))
MIN_WEI = int(os.environ.get("MIN_NATIVE_WEI", str(10**16)))  # 0.01 USDC equivalent
SSH_HOST = os.environ.get("PICOFLOW_SSH", "root@95.179.169.4")

if not SECRET.exists():
    print(f"ERROR: {SECRET} not found. Run prepare_deployer.py first.", file=sys.stderr)
    sys.exit(2)

secret = json.loads(SECRET.read_text())
PK = secret["private_key"]
ADDR = secret["address"]


def rpc(method, params):
    r = requests.post(ARC_RPC, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=15)
    r.raise_for_status()
    j = r.json()
    if "error" in j:
        raise RuntimeError(j["error"])
    return j["result"]


def get_balance() -> int:
    return int(rpc("eth_getBalance", [ADDR, "latest"]), 16)


print(f"[wait] deployer = {ADDR}")
print(f"[wait] watching balance until ≥ {MIN_WEI} wei (poll every {POLL_S}s, max {MAX_WAIT_S}s)")
print(f"[wait] If unfunded: open https://faucet.circle.com → Arc Testnet → paste {ADDR}")

start = time.time()
last = -1
while True:
    try:
        bal = get_balance()
    except Exception as exc:  # noqa: BLE001
        print(f"[wait] rpc error: {exc}; retrying...")
        time.sleep(POLL_S)
        continue
    if bal != last:
        print(f"[wait] t={int(time.time()-start)}s  balance={bal}  ({bal/1e18:.6f} native)")
        last = bal
    if bal >= MIN_WEI:
        print(f"[wait] ✅ funded — proceeding to deploy")
        break
    if time.time() - start > MAX_WAIT_S:
        print(f"[wait] timeout after {MAX_WAIT_S}s — exiting. Re-run when ready.")
        sys.exit(3)
    time.sleep(POLL_S)

# Deploy
env = os.environ.copy()
env["ARC_DEPLOYER_PK"] = PK
print(f"[deploy] launching deploy_arc.py ...")
r = subprocess.run([sys.executable, str(HERE / "deploy_arc.py")], env=env)
if r.returncode != 0:
    print(f"[deploy] ❌ deploy_arc.py failed (exit {r.returncode})", file=sys.stderr)
    sys.exit(r.returncode)

if not DEPLOY_OUT.exists():
    print(f"[deploy] ❌ {DEPLOY_OUT} missing", file=sys.stderr)
    sys.exit(4)

deployed = json.loads(DEPLOY_OUT.read_text())
contracts = deployed["contracts"]
addrs = {
    "BOND_VAULT_ADDR": contracts["BondVault"]["address"],
    "REPUTATION_REGISTRY_ADDR": contracts["ReputationRegistry"]["address"],
    "METADATA_LOGGER_ADDR": contracts["MetadataLogger"]["address"],
}

print(f"[deploy] ✅ deployed:")
for k, v in addrs.items():
    print(f"           {k}={v}")

if not MERGE_SCRIPT.exists():
    print(f"[deploy] ❌ missing merge helper: {MERGE_SCRIPT}", file=sys.stderr)
    sys.exit(5)

env_fragment = HERE / ".contract-addresses.env.tmp"
env_fragment.write_text("\n".join(f"{k}={v}" for k, v in addrs.items()) + "\n", encoding="utf-8")

print(f"[deploy] pushing addresses to {SSH_HOST} and restarting containers ...")
try:
    r = subprocess.run(["scp", str(env_fragment), f"{SSH_HOST}:/tmp/picoflow-contracts.env"])
    if r.returncode != 0:
        raise SystemExit(r.returncode)
    r = subprocess.run(["scp", str(MERGE_SCRIPT), f"{SSH_HOST}:/tmp/merge_contract_env.py"])
    if r.returncode != 0:
        raise SystemExit(r.returncode)
finally:
    env_fragment.unlink(missing_ok=True)

r = subprocess.run([
    "ssh",
    SSH_HOST,
    "sh",
    "-lc",
    "set -e; python3 /tmp/merge_contract_env.py; cd /opt/picoflow/code; docker compose --env-file .env.production restart sellers dashboard",
])
if r.returncode != 0:
    print(f"[deploy] ⚠️  ssh push failed (exit {r.returncode}); addresses still saved locally at {DEPLOY_OUT}", file=sys.stderr)
    sys.exit(r.returncode)

print(f"[deploy] ✅ DONE — production updated with deployed contract addresses")
print(f"[deploy] Explorer:")
for name, info in contracts.items():
    print(f"           {name}: https://testnet.arcscan.app/address/{info['address']}")
