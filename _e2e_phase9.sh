#!/bin/bash
set -euo pipefail
EMAIL="e2e-$(date +%s)@picoflow.test"
echo "== signup =="
SIGNUP=$(curl -s -X POST http://localhost:3030/api/auth/signup \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"hunter2hunter2\"}")
echo "$SIGNUP"
echo
echo "== login =="
LOGIN=$(curl -s -X POST http://localhost:3030/api/auth/login \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"hunter2hunter2\"}")
echo "$LOGIN"
SESS=$(echo "$LOGIN" | python3 -c 'import sys,json;print(json.load(sys.stdin)["session"])')
echo
echo "== /api/auth/me =="
curl -s -H "x-pf-session: $SESS" http://localhost:3030/api/auth/me
echo
echo "== mint key =="
MINT=$(curl -s -X POST -H "x-pf-session: $SESS" -H 'content-type: application/json' \
  -d '{"label":"smoke"}' http://localhost:3030/api/me/keys)
echo "$MINT"
KEY=$(echo "$MINT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["full_key"])')
echo
echo "== list keys =="
curl -s -H "x-pf-session: $SESS" http://localhost:3030/api/me/keys
echo
echo "== call paid endpoint with new key =="
AUTH_VALUE="Bearer $KEY"
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Authorization: $AUTH_VALUE" \
  http://localhost:3030/api/stats
echo
echo "== bad session rejected =="
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H 'x-pf-session: bogus.123.deadbeef' http://localhost:3030/api/auth/me
echo "== wrong password rejected =="
curl -s -X POST http://localhost:3030/api/auth/login \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"wrongwrong\"}"
echo
