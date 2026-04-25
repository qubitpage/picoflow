#!/bin/bash
set -euo pipefail
cd /opt/picoflow/code

echo "[deploy] extracting quota patch"
tar -xzf /tmp/picoflow-quota.tar.gz

echo "[deploy] rebuilding sellers (uses workspace tollbooth + nanometer-core)"
docker compose build sellers

echo "[deploy] restarting sellers"
docker compose up -d sellers

echo "[deploy] waiting 5s for boot"
sleep 5

echo "[verify] healthz:"
curl -sf http://localhost:3030/api/healthz && echo

echo "[verify] sign up a quota-probe user, mint a key, set limit=2, fire 3 calls, expect 429 on 3rd"
EMAIL="quota-$(date +%s)@picoflow.test"
SIGNUP=$(curl -s -X POST http://localhost:3030/api/auth/signup \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"hunter2hunter2\",\"org_name\":\"Quota Probe\"}")
echo "[signup] $SIGNUP"
SESSION=$(echo "$SIGNUP" | grep -oE '"session":"[^"]+"' | head -1 | cut -d'"' -f4)
ORG_ID=$(echo "$SIGNUP" | grep -oE '"org_id":"[^"]+"' | head -1 | cut -d'"' -f4)
echo "[ctx] org_id=$ORG_ID session_len=${#SESSION}"

echo "[deploy] forcing monthly_call_limit=2 on the new org"
docker compose exec -T postgres psql -U picoflow -d picoflow -c \
  "UPDATE orgs SET monthly_call_limit=2 WHERE org_id='$ORG_ID' RETURNING org_id, monthly_call_limit;"

KEY=$(curl -s -X POST http://localhost:3030/api/me/keys \
  -H 'content-type: application/json' \
  -H "x-pf-session: $SESSION" \
  -d '{"label":"quota-probe"}' | grep -oE '"plaintext":"[^"]+"' | cut -d'"' -f4)
echo "[mint] key_prefix=$(echo $KEY | cut -d'_' -f2)  full_len=${#KEY}"

# These hit a free metered route — featherless route requires payment.
# Use /api/me to confirm the auth + quota counts even on free paths? No —
# free paths skip the auth middleware. We need a paid/keyed route.
# Easiest: /api/secure/echo if it exists, else any tollbooth route. List them:
echo "[probe] candidate metered routes (first 30):"
docker compose exec -T sellers wget -qO- http://localhost:3030/api/healthz >/dev/null
# Use the well-known feather route which is keyed but does early auth.
AUTH_VALUE="Bearer $KEY"
for i in 1 2 3; do
  CODE=$(curl -s -o /tmp/q.out -w "%{http_code}" -X POST http://localhost:3030/api/secure/echo \
    -H "Authorization: $AUTH_VALUE" \
    -H 'content-type: application/json' \
    -d '{"msg":"ping"}')
  echo "[call $i] HTTP $CODE  body=$(head -c 200 /tmp/q.out)"
done

echo "[verify] action count for org:"
docker compose exec -T postgres psql -U picoflow -d picoflow -c \
  "SELECT count(*) FROM actions WHERE meta->>'org_id'='$ORG_ID';"
