#!/usr/bin/env bash
# PicoFlow server bootstrap — idempotent
# Run remotely:  ssh root@95.179.169.4 'bash -s' < bootstrap.sh
set -euo pipefail

echo "==> [1/8] System update"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl wget git ufw fail2ban nginx ca-certificates gnupg lsb-release jq htop unzip postgresql-client-16 || \
  apt-get install -y -qq curl wget git ufw fail2ban nginx ca-certificates gnupg lsb-release jq htop unzip

echo "==> [2/8] Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> [3/8] Node 22 + pnpm"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
npm i -g pnpm@9.12.0 || true

echo "==> [4/8] Firewall"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> [5/8] fail2ban"
systemctl enable --now fail2ban

echo "==> [6/8] Certbot (snap)"
if ! command -v certbot >/dev/null; then
  apt-get install -y -qq snapd
  snap install core; snap refresh core
  snap install --classic certbot
  ln -sf /snap/bin/certbot /usr/bin/certbot
fi

echo "==> [7/8] Application directory"
install -d -m 0755 /opt/picoflow
install -d -m 0755 /opt/picoflow/data/postgres
install -d -m 0755 /opt/picoflow/data/redis

echo "==> [8/8] nginx vhost (HTTP only — certbot will upgrade)"
cat > /etc/nginx/sites-available/picoflow <<'NGINX'
server {
    listen 80;
    server_name picoflow.qubitpage.com;
    client_max_body_size 16m;

    # Dashboard (Next.js) on 3000
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }

    # TollBooth (paid API endpoints) on 3030
    location /api/ {
        proxy_pass http://127.0.0.1:3030;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # StreamMeter (WebSocket)
    location /stream/ {
        proxy_pass http://127.0.0.1:3024;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
    }

    # Healthcheck
    location = /healthz {
        access_log off;
        return 200 "ok\n";
        add_header Content-Type text/plain;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/picoflow /etc/nginx/sites-enabled/picoflow
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo ""
echo "===================================================="
echo "BOOTSTRAP COMPLETE"
echo "Docker:  $(docker --version)"
echo "Node:    $(node -v)"
echo "pnpm:    $(pnpm -v 2>/dev/null || echo not-installed)"
echo "Nginx:   $(nginx -v 2>&1)"
echo "Certbot: $(certbot --version 2>&1)"
echo "===================================================="
