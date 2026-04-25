"""
Background watchdog: retry deploy_arc.py until Arc Testnet's public RPC accepts
the txn (mempool currently saturated, error -32003 'txpool is full'). Writes
status to ./deploy_watchdog.log and stops on first success.

Usage (PowerShell, async):
    $env:ARC_DEPLOYER_PK = (Get-Content .deployer.secret.json | ConvertFrom-Json).private_key
    Start-Process -WindowStyle Hidden D:\QubitDev\.venv\Scripts\python.exe contracts/deploy_watchdog.py
"""
from __future__ import annotations
import json, os, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).parent
LOG = HERE / "deploy_watchdog.log"
SECRET = HERE / ".deployer.secret.json"
OUT = HERE / "deployments.arc-testnet.json"
INTERVAL = int(os.environ.get("RETRY_INTERVAL_S", "60"))
MAX_ATTEMPTS = int(os.environ.get("RETRY_MAX_ATTEMPTS", "1440"))  # ~24h

if not SECRET.exists():
    raise SystemExit(f"missing {SECRET}")
secret = json.loads(SECRET.read_text())
env = os.environ.copy()
env["ARC_DEPLOYER_PK"] = secret["private_key"]
env["PYTHONIOENCODING"] = "utf-8"
env["PYTHONUTF8"] = "1"


def log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n"
    LOG.open("a", encoding="utf-8").write(line)
    print(line, end="", flush=True)


log(f"watchdog started (interval={INTERVAL}s, max={MAX_ATTEMPTS})")
for attempt in range(1, MAX_ATTEMPTS + 1):
    try:
        proc = subprocess.run(
            [sys.executable, str(HERE / "deploy_arc.py")],
            env=env, capture_output=True, text=True, timeout=600,
        )
        tail = (proc.stdout + proc.stderr).splitlines()[-3:]
        if proc.returncode == 0 and OUT.exists():
            log(f"attempt {attempt}: SUCCESS")
            log(f"deployments: {OUT.read_text()}")
            sys.exit(0)
        log(f"attempt {attempt}: rc={proc.returncode}  tail={tail}")
    except subprocess.TimeoutExpired:
        log(f"attempt {attempt}: TIMEOUT")
    time.sleep(INTERVAL)

log("watchdog gave up")
sys.exit(1)
