#!/bin/bash
set -euo pipefail
cd /opt/picoflow/code

echo "[deploy] extracting payload"
tar -xzf /tmp/picoflow-phase9.tar.gz

echo "[deploy] applying users-table migration to running postgres (idempotent)"
docker compose exec -T postgres psql -U picoflow -d picoflow <<'SQL'
CREATE TABLE IF NOT EXISTS users (
  user_id        TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'owner',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
SQL

echo "[deploy] rebuilding sellers + dashboard images"
docker compose build sellers dashboard

echo "[deploy] restarting containers"
docker compose up -d sellers dashboard

echo "[deploy] waiting 6s for boot"
sleep 6

echo "[verify] seller healthz:"
curl -sf http://localhost:3030/api/healthz || echo "FAIL healthz"

echo "[verify] dashboard landing renders 'Sign up' link:"
curl -sf https://picoflow.qubitpage.com/ | grep -oE 'Sign up|Get started free|Create a free account' | head -3 || echo "FAIL landing"

echo "[verify] /signup returns 200:"
curl -s -o /dev/null -w "%{http_code}\n" https://picoflow.qubitpage.com/signup

echo "[verify] /login returns 200:"
curl -s -o /dev/null -w "%{http_code}\n" https://picoflow.qubitpage.com/login

echo "[verify] /dashboard (old ledger view) returns 200:"
curl -s -o /dev/null -w "%{http_code}\n" https://picoflow.qubitpage.com/dashboard

echo "[verify] /api/auth/signup smoke (random email):"
EMAIL="probe-$(date +%s)@picoflow.test"
curl -s -X POST http://localhost:3030/api/auth/signup \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"hunter2hunter2\",\"org_name\":\"Probe Org\"}" | head -c 400
echo

echo "[deploy] done"
