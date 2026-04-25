#!/bin/sh
set -e
echo "=== HTTPS ==="
for p in / /api/healthz /registry /margin /proofmesh /demo; do
  c=$(curl -sSk -o /dev/null -w '%{http_code}' "https://picoflow.qubitpage.com$p")
  echo "  $p = $c"
done
echo "=== DB COUNTS ==="
docker exec picoflow-postgres-1 psql -U picoflow -d picoflow -tAc "
SELECT 'actions=' || COUNT(*) FROM actions;
SELECT 'payments=' || COUNT(*) FROM payments;
SELECT 'settlements=' || COUNT(*) FROM settlements;
SELECT 'splits=' || COUNT(*) FROM splits;
SELECT 'bonds=' || COUNT(*) FROM bonds;
SELECT 'onchain_tx=' || COUNT(*) FROM onchain_tx;
"
