#!/bin/bash
# Round-3 smoke test: create org, mint key, exercise /api/whoami + paid endpoint
set -euo pipefail
cd /opt/picoflow/code
ADMIN=$(grep -E '^ADMIN_TOKEN=' .env | cut -d= -f2)
if [ -z "$ADMIN" ]; then
  echo "FAIL: ADMIN_TOKEN missing from .env" >&2
  exit 1
fi
echo "==> 1. Create org (timestamped name)"
NAME="round3-$(date +%s)"
ORG=$(curl -sS -X POST -H "X-Admin-Token: $ADMIN" -H 'Content-Type: application/json' \
  -d "{\"name\":\"$NAME\",\"plan_tier\":\"pro\",\"monthly_call_limit\":1000}" \
  http://127.0.0.1:3030/api/admin/orgs)
echo "$ORG"
ORG_ID=$(echo "$ORG" | python3 -c 'import sys,json;print(json.load(sys.stdin)["org_id"])')
echo "ORG_ID=$ORG_ID"

echo "==> 2. Mint key"
KEY=$(curl -sS -X POST -H "X-Admin-Token: $ADMIN" -H 'Content-Type: application/json' \
  -d "{\"org_id\":\"$ORG_ID\",\"label\":\"round3\"}" \
  http://127.0.0.1:3030/api/admin/api-keys)
echo "$KEY"
FULL=$(echo "$KEY" | python3 -c 'import sys,json;print(json.load(sys.stdin)["full_key"])')
echo "KEY_PREFIX=${FULL:0:20}..."

echo "==> 3. /api/whoami (no key) — expect 401"
curl -sS -o /tmp/r1.json -w 'HTTP %{http_code}\n' http://127.0.0.1:3030/api/whoami
cat /tmp/r1.json; echo

echo "==> 4. /api/whoami (with key) — expect 200 + payload"
AUTH_VALUE="Bearer $FULL"
curl -sS -o /tmp/r2.json -w 'HTTP %{http_code}\n' \
  -H "Authorization: $AUTH_VALUE" http://127.0.0.1:3030/api/whoami
cat /tmp/r2.json; echo

echo "==> 5. Paid /api/aisa/data (with key) — expect 402 (price quote)"
curl -sS -o /tmp/r3.json -w 'HTTP %{http_code}\n' \
  -H "Authorization: $AUTH_VALUE" "http://127.0.0.1:3030/api/aisa/data?symbol=BTC"
head -c 400 /tmp/r3.json; echo

echo "==> 6. provider_costs row count"
docker exec picoflow-postgres-1 psql -U picoflow -d picoflow -c "SELECT provider, COUNT(*), SUM(atomic_cost) FROM provider_costs GROUP BY provider;"
