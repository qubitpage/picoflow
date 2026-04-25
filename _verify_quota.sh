#!/bin/bash
set -euo pipefail
cd /opt/picoflow/code

EMAIL="quota-$(date +%s)@picoflow.test"
echo "[1] signup ($EMAIL)"
SIGNUP=$(curl -s -X POST http://localhost:3030/api/auth/signup \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"hunter2hunter2\",\"org_name\":\"Quota Probe $(date +%s%N)\"}")
SESSION=$(echo "$SIGNUP" | grep -oE '"session":"[^"]+"' | head -1 | cut -d'"' -f4)
ORG_ID=$(echo "$SIGNUP" | grep -oE '"org_id":"[^"]+"' | head -1 | cut -d'"' -f4)
echo "    org_id=$ORG_ID"

echo "[2] cap quota at 2"
docker compose exec -T postgres psql -U picoflow -d picoflow -t -c \
  "UPDATE orgs SET monthly_call_limit=2 WHERE org_id='$ORG_ID' RETURNING monthly_call_limit;"

echo "[3] mint api key"
KEYRES=$(curl -s -X POST http://localhost:3030/api/me/keys \
  -H 'content-type: application/json' -H "x-pf-session: $SESSION" \
  -d '{"label":"quota-probe"}')
KEY=$(echo "$KEYRES" | grep -oE '"full_key":"[^"]+"' | cut -d'"' -f4)
echo "    key=${KEY:0:24}..."

echo "[4] pre-seed 2 actions for org_id (skipping tollbooth payment)"
docker compose exec -T postgres psql -U picoflow -d picoflow <<SQL
INSERT INTO actions (action_id, route, method, buyer_addr, seller_label, seller_addr, price_atomic, price_human, asset_addr, network_id, status, meta)
VALUES (gen_random_uuid(), '/api/seed', 'GET', '0x0000000000000000000000000000000000000000', 'seed', '0x0000000000000000000000000000000000000000', 0, '0', '0x0000000000000000000000000000000000000000', 5042002, 'completed', jsonb_build_object('org_id','$ORG_ID')),
       (gen_random_uuid(), '/api/seed', 'GET', '0x0000000000000000000000000000000000000000', 'seed', '0x0000000000000000000000000000000000000000', 0, '0', '0x0000000000000000000000000000000000000000', 5042002, 'completed', jsonb_build_object('org_id','$ORG_ID'));
SELECT count(*) AS seeded FROM actions WHERE meta->>'org_id'='$ORG_ID';
SQL

echo "[5] enable REQUIRE_API_KEY (check it's already on)"
docker compose exec -T sellers env | grep REQUIRE_API_KEY || echo "    REQUIRE_API_KEY not set in container"

echo "[6] hit a paid route with Bearer key (no payment header) -> expect 429 if quota enforced, 402 if quota disabled"
AUTH_VALUE="Bearer $KEY"
CODE=$(curl -s -o /tmp/q.out -w "%{http_code}" \
  -H "Authorization: $AUTH_VALUE" \
  "http://localhost:3030/api/aisa/data?symbol=BTC")
echo "    HTTP $CODE"
echo "    body: $(cat /tmp/q.out | head -c 300)"

echo "[7] cleanup probe org"
docker compose exec -T postgres psql -U picoflow -d picoflow -c \
  "DELETE FROM actions WHERE meta->>'org_id'='$ORG_ID'; DELETE FROM users WHERE org_id='$ORG_ID'; DELETE FROM api_keys WHERE org_id='$ORG_ID'; DELETE FROM orgs WHERE org_id='$ORG_ID';" 2>&1 | tail -5

if [ "$CODE" = "429" ]; then
  echo "[OK] quota enforcement WORKING (HTTP 429)"
  exit 0
else
  echo "[FAIL] expected 429, got $CODE"
  exit 1
fi
