from __future__ import annotations

from pathlib import Path

FRAGMENT = Path('/tmp/picoflow-operator.env')
TARGETS = [Path('/opt/picoflow/code/.env'), Path('/opt/picoflow/code/.env.production')]
KEYS = {'ADMIN_TOKEN', 'DASHBOARD_ADMIN_USER', 'DASHBOARD_ADMIN_PASSWORD'}

if not FRAGMENT.exists():
    raise SystemExit(f'missing fragment: {FRAGMENT}')

fragment_lines = [line.rstrip('\n') for line in FRAGMENT.read_text(encoding='utf-8').splitlines() if line.strip()]
fragment_keys = {line.split('=', 1)[0] for line in fragment_lines if '=' in line}
missing = KEYS - fragment_keys
if missing:
    raise SystemExit(f'fragment missing keys: {sorted(missing)}')

for target in TARGETS:
    target.touch(mode=0o600, exist_ok=True)
    original = target.read_text(encoding='utf-8') if target.exists() else ''
    keep = []
    for line in original.splitlines():
        key = line.split('=', 1)[0] if '=' in line else ''
        if key not in KEYS:
            keep.append(line)
    target.with_suffix(target.suffix + '.bak-auth').write_text(original, encoding='utf-8')
    merged = '\n'.join(keep).rstrip() + '\n\n' + '\n'.join(fragment_lines).rstrip() + '\n'
    target.write_text(merged, encoding='utf-8')
    print(f'{target}: configured {len(fragment_keys)} operator keys')

FRAGMENT.unlink()
