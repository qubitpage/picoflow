"""
PicoFlow multi-network deploy launcher.

Wraps deploy_arc_mainnet.py (network-agnostic) with curated presets so we can
ship the same 3 Vyper contracts to any EVM network where USDC + x402 work.

Usage:
    python contracts/deploy.py <network>

Where <network> is one of:
    arc-testnet        Live (chainId 5042002) — 3/3 contracts already deployed
    base-mainnet       Production-ready (chainId 8453, native USDC)
    base-sepolia       Base testnet (chainId 84532)
    arbitrum-mainnet   Production rehearsal (chainId 42161, native USDC)
    arc-mainnet        Reserved — Circle has not launched mainnet yet

Each preset sets ARC_RPC_URLS, ARC_CHAIN_ID, ARC_USDC_ADDR, NETWORK_LABEL,
then invokes deploy_arc_mainnet.py. The deployer private key must be supplied
via ARC_DEPLOYER_PK env var (NEVER hardcoded). For testnet, it can be loaded
from contracts/.deployer.secret.json by passing --use-dev-key.

Examples:
    # Idempotent re-check on testnet (uses dev key from .deployer.secret.json)
    python contracts/deploy.py arc-testnet --use-dev-key

    # Real Base mainnet deploy (you provide funded deployer)
    $env:ARC_DEPLOYER_PK = "0x<your_funded_base_mainnet_pk>"
    python contracts/deploy.py base-mainnet
"""
from __future__ import annotations
import argparse
import json
import os
import subprocess
import sys
import urllib.request
from decimal import Decimal
from pathlib import Path

from eth_account import Account

HERE = Path(__file__).parent

# Network presets. Sources:
#   Arc testnet:    https://docs.arc.network/arc/references/connect-to-arc
#   Arc USDC:       https://docs.arc.network/arc/references/contract-addresses
#   Base mainnet:   https://docs.base.org/chain/network-information
#   Base USDC:      https://developers.circle.com/stablecoins/usdc-on-main-networks
#   Base Sepolia:   https://docs.base.org/chain/network-information
PRESETS: dict[str, dict[str, str]] = {
    "arc-testnet": {
        "ARC_CHAIN_ID": "5042002",
        "ARC_RPC_URLS": ",".join([
            "https://arc-testnet.g.alchemy.com/v2/Ljy_yjqBi70q-hWcAQgVM",
            "https://rpc.testnet.arc.network",
            "https://rpc.blockdaemon.testnet.arc.network",
            "https://rpc.drpc.testnet.arc.network",
            "https://rpc.quicknode.testnet.arc.network",
        ]),
        "ARC_USDC_ADDR": "0x3600000000000000000000000000000000000000",
        "NETWORK_LABEL": "arc-testnet",
        "MIN_NATIVE_BALANCE": "0.01",
        "NATIVE_BALANCE_SYMBOL": "USDC",
    },
    "base-mainnet": {
        "ARC_CHAIN_ID": "8453",
        "ARC_RPC_URLS": ",".join([
            "https://mainnet.base.org",
            "https://base-rpc.publicnode.com",
            "https://base.llamarpc.com",
        ]),
        "ARC_USDC_ADDR": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "NETWORK_LABEL": "base-mainnet",
        "MIN_NATIVE_BALANCE": "0.005",  # ~$15 of ETH covers all 3 deploys
        "NATIVE_BALANCE_SYMBOL": "ETH",
    },
    "base-sepolia": {
        "ARC_CHAIN_ID": "84532",
        "ARC_RPC_URLS": ",".join([
            "https://sepolia.base.org",
            "https://base-sepolia-rpc.publicnode.com",
        ]),
        "ARC_USDC_ADDR": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        "NETWORK_LABEL": "base-sepolia",
        "MIN_NATIVE_BALANCE": "0.005",
        "NATIVE_BALANCE_SYMBOL": "ETH",
    },
    # Arbitrum One (chainId 42161) — production rehearsal target while Arc
    # mainnet is not yet live. Native USDC (Circle), NOT USDC.e.
    # Sources:
    #   Arbitrum:  https://docs.arbitrum.io/build-decentralized-apps/reference/node-providers
    #   USDC:      https://developers.circle.com/stablecoins/usdc-on-main-networks
    "arbitrum-mainnet": {
        "ARC_CHAIN_ID": "42161",
        "ARC_RPC_URLS": ",".join([
            "https://arb1.arbitrum.io/rpc",
            "https://arbitrum.llamarpc.com",
            "https://arbitrum-one.publicnode.com",
        ]),
        "ARC_USDC_ADDR": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        "NETWORK_LABEL": "arbitrum-mainnet",
        "MIN_NATIVE_BALANCE": "0.001",  # ~$2.30 of ETH covers all 3 deploys
        "NATIVE_BALANCE_SYMBOL": "ETH",
    },
    "arc-mainnet": {
        # Placeholders — Circle has not launched Arc mainnet as of 2026-04-25.
        # When they do, fill these in from
        # https://docs.arc.network/arc/references/connect-to-arc
        "ARC_CHAIN_ID": os.getenv("ARC_MAINNET_CHAIN_ID", ""),
        "ARC_RPC_URLS": os.getenv("ARC_MAINNET_RPC_URLS", ""),
        "ARC_USDC_ADDR": os.getenv("ARC_MAINNET_USDC", ""),
        "NETWORK_LABEL": "arc-mainnet",
        "MIN_NATIVE_BALANCE": "0.01",
        "NATIVE_BALANCE_SYMBOL": "USDC",
    },
}


def load_dev_key() -> str:
    secret = HERE / ".deployer.secret.json"
    if not secret.exists():
        raise SystemExit(f"[deploy] {secret} not found")
    with secret.open("r", encoding="utf-8") as f:
        return json.load(f)["private_key"]


def load_secret_file(path: Path) -> str:
    if not path.exists():
        raise SystemExit(f"[deploy] secret file not found: {path}")
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    private_key = data.get("private_key")
    if not isinstance(private_key, str):
        raise SystemExit(f"[deploy] secret file has no 0x private_key: {path}")
    if not private_key.startswith("0x"):
        private_key = f"0x{private_key}"
    if len(private_key) != 66:
        raise SystemExit(f"[deploy] secret file private_key has invalid length: {path}")
    return private_key


def rpc(url: str, method: str, params: list[object]) -> object:
    req = urllib.request.Request(
        url,
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "PicoFlowDeploy/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        body = json.loads(response.read().decode("utf-8"))
    if "error" in body:
        raise SystemExit(f"[deploy] RPC error from {url}: {body['error']}")
    return body["result"]


def hex_to_int(value: object) -> int:
    if not isinstance(value, str) or not value.startswith("0x"):
        raise SystemExit(f"[deploy] expected hex RPC value, got {value!r}")
    return int(value, 16)


def check_only(preset: dict[str, str], private_key: str) -> int:
    account = Account.from_key(private_key)
    rpc_urls = [url.strip() for url in preset["ARC_RPC_URLS"].split(",") if url.strip()]
    last_error = None
    first_rpc = rpc_urls[0]
    for candidate_rpc in rpc_urls:
        try:
            chain_id = hex_to_int(rpc(candidate_rpc, "eth_chainId", []))
            first_rpc = candidate_rpc
            break
        except Exception as exc:
            last_error = exc
    else:
        raise SystemExit(f"[deploy] all RPCs failed during check-only: {last_error}")
    expected_chain_id = int(preset["ARC_CHAIN_ID"])
    if chain_id != expected_chain_id:
        raise SystemExit(f"[deploy] chainId mismatch: expected {expected_chain_id}, got {chain_id}")

    balance_wei = hex_to_int(rpc(first_rpc, "eth_getBalance", [account.address, "latest"]))
    balance = Decimal(balance_wei) / Decimal(10**18)
    required = Decimal(preset["MIN_NATIVE_BALANCE"])
    symbol = preset["NATIVE_BALANCE_SYMBOL"]
    nonce_latest = hex_to_int(rpc(first_rpc, "eth_getTransactionCount", [account.address, "latest"]))
    nonce_pending = hex_to_int(rpc(first_rpc, "eth_getTransactionCount", [account.address, "pending"]))

    print(f"[check] address        = {account.address}")
    print(f"[check] chainId        = {chain_id}")
    print(f"[check] balance        = {balance} {symbol}")
    print(f"[check] required       = {required} {symbol}")
    print(f"[check] nonce latest   = {nonce_latest}")
    print(f"[check] nonce pending  = {nonce_pending}")
    print(f"[check] funded         = {balance >= required}")
    return 0 if balance >= required else 4


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("network", choices=list(PRESETS.keys()))
    p.add_argument("--use-dev-key", action="store_true",
                   help="Load deployer pk from contracts/.deployer.secret.json (TESTNET ONLY)")
    p.add_argument("--secret-file", type=Path,
                   help="Load deployer private key from a gitignored JSON secret file")
    p.add_argument("--force", action="store_true",
                   help="Pass FORCE_REDEPLOY=true to redeploy even if contracts are live")
    p.add_argument("--check-only", action="store_true",
                   help="Check RPC, chainId, address, nonce, and funding without deploying")
    args = p.parse_args()

    preset = PRESETS[args.network]
    if args.network == "arc-mainnet" and not preset["ARC_CHAIN_ID"]:
        print(
            "[deploy] arc-mainnet preset is empty.\n"
            "         Circle has not launched Arc mainnet yet (verified 2026-04-25\n"
            "         via https://docs.arc.network).\n"
            "         When they ship it, set these env vars and re-run:\n"
            "           $env:ARC_MAINNET_CHAIN_ID = '<chain id>'\n"
            "           $env:ARC_MAINNET_RPC_URLS = '<url1>,<url2>'\n"
            "           $env:ARC_MAINNET_USDC = '0x...'\n"
            "         For production today, use:  python contracts/deploy.py base-mainnet"
        )
        return 2

    # Validate that we will not accidentally cross networks
    if args.network.endswith("mainnet") and args.use_dev_key:
        raise SystemExit(
            "[deploy] REFUSED: --use-dev-key is forbidden on mainnet. "
            "Set $env:ARC_DEPLOYER_PK to a fresh funded production wallet."
        )

    env = os.environ.copy()
    env.update(preset)
    if args.force:
        env["FORCE_REDEPLOY"] = "true"
    if args.use_dev_key:
        env["ARC_DEPLOYER_PK"] = load_dev_key()
    if args.secret_file:
        env["ARC_DEPLOYER_PK"] = load_secret_file(args.secret_file)
    if not env.get("ARC_DEPLOYER_PK"):
        raise SystemExit(
            "[deploy] ARC_DEPLOYER_PK not set. "
            "Export it, pass --secret-file, or pass --use-dev-key (testnet only)."
        )

    print(f"[deploy] network        = {args.network}")
    print(f"[deploy] chainId target = {preset['ARC_CHAIN_ID']}")
    print(f"[deploy] USDC           = {preset['ARC_USDC_ADDR']}")
    rpcs = preset["ARC_RPC_URLS"].split(",")
    print(f"[deploy] RPC pool size  = {len(rpcs)}")

    if args.check_only:
        return check_only(preset, env["ARC_DEPLOYER_PK"])

    script = HERE / "deploy_arc_mainnet.py"
    return subprocess.call([sys.executable, str(script)], env=env)


if __name__ == "__main__":
    raise SystemExit(main())
