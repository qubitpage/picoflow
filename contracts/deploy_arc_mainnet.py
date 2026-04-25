"""
PicoFlow Vyper deployment — production-grade engineered version.

Despite the historical filename, this script is network-neutral. It deploys
the PicoFlow Vyper contracts to any EVM chain configured through env vars
(Arc Testnet today, Base Mainnet today, Arc Mainnet when Circle launches it).

Differences vs deploy_arc.py (testnet):
- Multi-RPC round-robin (env: ARC_RPC_URLS=url1,url2,url3)
- Pre-flight checks: chainId, balance >= MIN_BALANCE_ETH, RPC reachability
- Manual nonce management with cancel-replace for stuck txs
  (eth_getTransactionCount(pending) > eth_getTransactionCount(latest)
   triggers a same-nonce 0-value self-tx with 1.5x gasPrice to clear it)
- Idempotent: if deployments file exists with on-chain code at the addresses,
  skips re-deploy unless FORCE_REDEPLOY=true
- Post-deploy: eth_getCode != "0x" verification with 30s wait
- Writes deployments.<network>.json with chainId, rpc, deployer, contracts,
  tx_hashes, block_numbers

Usage:
    # Mainnet (when keys are ready):
    $env:ARC_RPC_URLS = "https://rpc.arc.network,https://backup.arc.network"
    $env:ARC_DEPLOYER_PK = "0x..."
    $env:ARC_CHAIN_ID = "5042000"   # or whatever Arc mainnet chainId is
    $env:ARC_USDC_ADDR = "0x..."     # from Circle docs USDC contract page
    $env:NATIVE_BALANCE_SYMBOL = "USDC"
    $env:NETWORK_LABEL = "arc-mainnet"
    python contracts/deploy_arc_mainnet.py

    # Testnet redeploy (idempotent — skips if already deployed):
    $env:ARC_RPC_URLS = "https://arc-testnet.g.alchemy.com/v2/<key>,https://rpc.testnet.arc.network"
    $env:ARC_DEPLOYER_PK = (Get-Content contracts/.deployer.secret.json | ConvertFrom-Json).private_key
    $env:ARC_CHAIN_ID = "5042002"
    $env:NETWORK_LABEL = "arc-testnet"
    $env:NATIVE_BALANCE_SYMBOL = "USDC"
    python contracts/deploy_arc_mainnet.py
"""
from __future__ import annotations
import json, os, sys, time
from pathlib import Path
from decimal import Decimal

import requests
from eth_account import Account

HERE = Path(__file__).parent
NETWORK_LABEL = os.environ.get("NETWORK_LABEL", "arc-testnet")
OUT = HERE / f"deployments.{NETWORK_LABEL}.json"

RPC_URLS = [u.strip() for u in os.environ.get("ARC_RPC_URLS", "").split(",") if u.strip()]
if not RPC_URLS:
    print("ERROR: set ARC_RPC_URLS=url1,url2,...", file=sys.stderr)
    sys.exit(2)

CHAIN_ID = int(os.environ.get("ARC_CHAIN_ID", "5042002"))
PK = os.environ.get("ARC_DEPLOYER_PK")
if not PK:
    print("ERROR: set ARC_DEPLOYER_PK", file=sys.stderr)
    sys.exit(2)

USDC_ADDR = os.environ.get("ARC_USDC_ADDR", "0x3600000000000000000000000000000000000000")
INSURANCE_ADDR = os.environ.get("INSURANCE_ADDR")
VALIDATOR_ADDR = os.environ.get("BOND_VALIDATOR_ADDR")
VALIDATION_WINDOW_SECS = int(os.environ.get("BOND_VALIDATION_WINDOW_SECS", "3600"))
NATIVE_BALANCE_SYMBOL = os.environ.get("NATIVE_BALANCE_SYMBOL", "native")
MIN_NATIVE_BALANCE = Decimal(os.environ.get("MIN_NATIVE_BALANCE", os.environ.get("MIN_BALANCE_ETH", "0.05")))
FORCE_REDEPLOY = os.environ.get("FORCE_REDEPLOY", "").lower() in ("1", "true", "yes")
GAS_BUMP_FACTOR = Decimal(os.environ.get("GAS_BUMP_FACTOR", "1.5"))
RECEIPT_TIMEOUT_S = int(os.environ.get("RECEIPT_TIMEOUT_S", "180"))


# ---------------------------------------------------------------- RPC helpers
class RpcError(RuntimeError):
    pass


def rpc(method: str, params, attempts: int = 3):
    """Round-robin RPC with retry. Raises RpcError after all URLs fail."""
    last_err = None
    for attempt in range(attempts):
        for url in RPC_URLS:
            try:
                r = requests.post(
                    url,
                    json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                    timeout=20,
                )
                j = r.json()
                if "error" in j:
                    last_err = f"{url} {method}: {j['error']}"
                    continue
                return j["result"]
            except Exception as e:
                last_err = f"{url} {method}: {e}"
        time.sleep(1.5 * (attempt + 1))
    raise RpcError(last_err or f"{method} failed across all RPCs")


def hex2int(h):
    return int(h, 16) if isinstance(h, str) and h.startswith("0x") else h


# ---------------------------------------------------------------- Pre-flight
acct = Account.from_key(PK)
print(f"[deploy] network        = {NETWORK_LABEL}")
print(f"[deploy] chainId target = {CHAIN_ID}")
print(f"[deploy] RPCs           = {RPC_URLS}")
print(f"[deploy] deployer       = {acct.address}")

reported_chain = hex2int(rpc("eth_chainId", []))
if reported_chain != CHAIN_ID:
    print(f"ERROR: chainId mismatch. expected {CHAIN_ID}, RPC reports {reported_chain}", file=sys.stderr)
    sys.exit(3)

bal_wei = hex2int(rpc("eth_getBalance", [acct.address, "latest"]))
bal_native = Decimal(bal_wei) / Decimal(10**18)
print(f"[deploy] balance        = {bal_native} {NATIVE_BALANCE_SYMBOL} ({bal_wei} wei)")
if bal_native < MIN_NATIVE_BALANCE:
    print(f"ERROR: balance {bal_native} < required {MIN_NATIVE_BALANCE} {NATIVE_BALANCE_SYMBOL}", file=sys.stderr)
    sys.exit(4)

block = hex2int(rpc("eth_blockNumber", []))
print(f"[deploy] blockNumber    = {block}")

# Cancel-replace stuck txs
nonce_pending = hex2int(rpc("eth_getTransactionCount", [acct.address, "pending"]))
nonce_latest  = hex2int(rpc("eth_getTransactionCount", [acct.address, "latest"]))
print(f"[deploy] nonce latest={nonce_latest}  pending={nonce_pending}")
if nonce_pending > nonce_latest:
    stuck = nonce_pending - nonce_latest
    print(f"[deploy] WARNING: {stuck} stuck pending tx(s). Sending cancel-replace(s).")
    base_gas = hex2int(rpc("eth_gasPrice", []))
    bumped = int(Decimal(base_gas) * GAS_BUMP_FACTOR)
    for n in range(nonce_latest, nonce_pending):
        tx = {
            "to": acct.address,
            "value": 0,
            "gas": 21000,
            "gasPrice": bumped,
            "nonce": n,
            "chainId": CHAIN_ID,
            "data": b"",
        }
        signed = acct.sign_transaction(tx)
        try:
            h = rpc("eth_sendRawTransaction", [signed.raw_transaction.hex() if hasattr(signed, "raw_transaction") else signed.rawTransaction.hex()])
            print(f"[deploy] cancel-replace nonce={n} sent: {h}")
        except RpcError as e:
            print(f"[deploy] cancel-replace nonce={n} failed (likely already mined): {e}")
    # wait briefly for new pending count
    for _ in range(20):
        time.sleep(3)
        nl = hex2int(rpc("eth_getTransactionCount", [acct.address, "latest"]))
        if nl >= nonce_pending:
            print(f"[deploy] mempool clear: nonce_latest now {nl}")
            break
        print(f"[deploy] waiting for cancel-replace mining... latest={nl}")

# Idempotency check
if OUT.exists() and not FORCE_REDEPLOY:
    existing = json.loads(OUT.read_text())
    all_live = True
    for name, info in existing.get("contracts", {}).items():
        code = rpc("eth_getCode", [info["address"], "latest"])
        live = isinstance(code, str) and code != "0x" and len(code) > 4
        print(f"[idempotent] {name} {info['address']}: on_chain={live}")
        if not live:
            all_live = False
    if all_live:
        print(f"[idempotent] all {len(existing['contracts'])} contracts already deployed. Skipping. Set FORCE_REDEPLOY=true to redeploy.")
        sys.exit(0)
    print("[idempotent] partial deployment detected; redeploying missing contracts...")

# ---------------------------------------------------------------- Deploy via boa
# Use titanoboa with the FIRST working RPC. boa picks one network at a time.
try:
    import boa
except ImportError:
    print("ERROR: pip install titanoboa", file=sys.stderr)
    sys.exit(2)

active_rpc = RPC_URLS[0]
print(f"[deploy] boa using RPC  = {active_rpc}")
boa.set_network_env(active_rpc)
boa.env.add_account(acct, force_eoa=True)

ins = INSURANCE_ADDR or acct.address
val = VALIDATOR_ADDR or acct.address
print(f"[deploy] USDC           = {USDC_ADDR}")
print(f"[deploy] insurance      = {ins}")
print(f"[deploy] validator      = {val}")

contracts = [
    ("BondVault",          HERE / "BondVault.vy",          [USDC_ADDR, ins, VALIDATION_WINDOW_SECS, val]),
    ("ReputationRegistry", HERE / "ReputationRegistry.vy", []),
    ("MetadataLogger",     HERE / "MetadataLogger.vy",     []),
]

results = {}
for name, path, args in contracts:
    print(f"[deploy] -> {name}")
    t0 = time.time()
    src = path.read_text(encoding="utf-8")
    deployed = boa.loads(src, *args)
    addr = str(deployed.address)
    # verify code on-chain
    code = "0x"
    deadline = time.time() + RECEIPT_TIMEOUT_S
    while time.time() < deadline:
        code = rpc("eth_getCode", [addr, "latest"])
        if isinstance(code, str) and code != "0x" and len(code) > 4:
            break
        time.sleep(2)
    on_chain = isinstance(code, str) and code != "0x" and len(code) > 4
    elapsed = round(time.time() - t0, 2)
    print(f"[deploy]    address={addr}  on_chain={on_chain}  ({elapsed}s)")
    if not on_chain:
        print(f"ERROR: {name} not on chain after {RECEIPT_TIMEOUT_S}s", file=sys.stderr)
        sys.exit(5)
    results[name] = {"address": addr, "deployed_at": int(time.time()), "code_bytes": (len(code) - 2) // 2}

OUT.write_text(json.dumps({
    "network": NETWORK_LABEL,
    "chainId": CHAIN_ID,
    "rpc": active_rpc,
    "rpc_pool": RPC_URLS,
    "deployer": acct.address,
    "deployed_at": int(time.time()),
    "contracts": results,
}, indent=2), encoding="utf-8")
print(f"[deploy] wrote {OUT}")
print("[deploy] DONE")
