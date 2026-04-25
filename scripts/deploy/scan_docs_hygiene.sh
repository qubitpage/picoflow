#!/usr/bin/env bash
set -euo pipefail
cd /opt/picoflow/code
set +e
grep -RIni \
  -e AgentBazaar \
  -e Lumina \
  -e ClawRouter \
  -e Franklin \
  -e competitor \
  -e rival \
  docs \
  apps/dashboard/public/docs \
  README.md \
  DELIVERY_REPORT.md \
  apps/dashboard/src/app/feedback \
  apps/dashboard/src/app/docs
status=$?
set -e
if [ "$status" -eq 1 ]; then
  echo NO_DOC_COMPETITOR_REFS
  exit 0
fi
exit "$status"
