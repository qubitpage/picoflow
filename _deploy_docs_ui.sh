#!/bin/bash
set -euo pipefail
cd /opt/picoflow/code

echo "[deploy] extracting docs/ui bundle"
tar -xzf /tmp/picoflow-docs-ui.tar.gz
find apps/dashboard/public/docs -maxdepth 1 -type f -name 'picoflow-*' \
  ! -name 'picoflow-whitepaper.*' \
  ! -name 'picoflow-pitch-deck.*' \
  ! -name 'picoflow-docs.css' -delete

echo "[deploy] rebuilding sellers + dashboard images"
docker compose build sellers dashboard

echo "[deploy] restarting sellers + dashboard"
docker compose up -d sellers dashboard

echo "[deploy] waiting for sellers + dashboard boot"
for i in {1..30}; do
  if curl -fsS http://localhost:3030/api/healthz >/dev/null && curl -fsS http://localhost:3000 >/dev/null; then
    break
  fi
  sleep 2
  if [ "$i" = "30" ]; then
    echo "sellers or dashboard did not boot" >&2
    docker compose logs --tail=120 sellers >&2 || true
    docker compose logs --tail=120 dashboard >&2 || true
    exit 1
  fi
done

echo "[verify] public routes"
for path in / /docs /dashboard /demo /network /providers /splits /margin /console /registry /track /proofmesh; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://picoflow.qubitpage.com${path}")
  echo "${path} ${code}"
  if [ "$path" = "/console" ]; then
    test "$code" = "200" -o "$code" = "307"
  else
    test "$code" = "200"
  fi
done

echo "[verify] homepage copy"
curl -fsS https://picoflow.qubitpage.com/ | grep -E "Arbitrum One|Arc Testnet|toll meter for APIs" >/dev/null

echo "[verify] docs tabs + unified artifacts"
curl -fsS https://picoflow.qubitpage.com/docs | grep -E "Unified Whitepaper|Pitch Deck|one whitepaper" >/dev/null
node -e "const j=require('./apps/dashboard/public/docs/index.json'); if(j.docs.length!==2) throw new Error('expected exactly 2 docs'); console.log('[verify] docs count', j.docs.length)"
curl -fsS -o /tmp/picoflow-whitepaper.pdf https://picoflow.qubitpage.com/docs/picoflow-whitepaper.pdf
test -s /tmp/picoflow-whitepaper.pdf
curl -fsS https://picoflow.qubitpage.com/docs/picoflow-whitepaper.html | grep -E "Mainnet proof|PicoFlow settlement pipeline|Unified product appendix|Appendix" >/dev/null
! curl -fsS https://picoflow.qubitpage.com/docs/picoflow-whitepaper.html | grep -Ei "video script|submission/video-script|record video|speech" >/dev/null
curl -fsS https://picoflow.qubitpage.com/dashboard | grep -E "Real-funds mainnet proof|Arc-native rehearsal|Arbitrum One|Arc Testnet" >/dev/null
curl -fsS https://picoflow.qubitpage.com/dashboard | grep -E "0xcacbbfcb|0x00792829|0xba0307bba" >/dev/null
curl -fsS https://picoflow.qubitpage.com/docs | grep -E "0xcacbbfcb|0x00792829|0xba0307bba" >/dev/null
curl -fsS https://picoflow.qubitpage.com/proofmesh | grep -E "Verified Arc Testnet artifacts|0x00792829|0xba0307bba" >/dev/null
for path in /splits /margin /registry /providers /track /proofmesh; do
  curl -fsS "https://picoflow.qubitpage.com${path}" | grep -E "Networks|network tabs|Mainnets|Testnets|/api/chains|Arbitrum One|Arc Testnet" >/dev/null
done
curl -fsS https://picoflow.qubitpage.com/demo | grep -E "Choose network before running|Terminal transcript|Arbitrum One|Arc Testnet" >/dev/null
curl -fsS "https://picoflow.qubitpage.com/api/demo/state?format=terminal" | grep -E "PicoFlow demo terminal transcript|workflow|live log tail" >/dev/null

echo "[deploy] docs/ui production update complete"
