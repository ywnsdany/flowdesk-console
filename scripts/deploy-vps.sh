#!/usr/bin/env bash
# Deploy closing-console on a Debian/Ubuntu VPS (Hostinger, DigitalOcean, etc).
#
# Usage (run AS ROOT inside the cloned repo):
#   bash scripts/deploy-vps.sh <domain> <admin-email>
#
# Example:
#   bash scripts/deploy-vps.sh flowdesk.brave.com.sa admin@brave.com.sa
#
# Prereqs:
#   - Repo cloned at /opt/closing-console (or wherever; uses CWD).
#   - .env.production created in repo root with DATABASE_URL + JWT_SECRET.
#   - DNS A record for <domain> already pointing to this server.
#   - Run as root (sudo).

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
APP_DIR="$(pwd)"
APP_NAME="closing-console"
APP_PORT="${PORT:-8787}"
NODE_VERSION="20"

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: bash scripts/deploy-vps.sh <domain> <admin-email>"
  exit 1
fi

if [[ "$EUID" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/deploy-vps.sh $DOMAIN ${EMAIL:-admin@example.com}"
  exit 1
fi

if [[ ! -f "$APP_DIR/package.json" ]]; then
  echo "ERROR: package.json not found in $APP_DIR. cd into the cloned repo first."
  exit 1
fi

if [[ ! -f "$APP_DIR/.env.production" ]]; then
  cat <<EOF
ERROR: $APP_DIR/.env.production is missing.

Create it with:
  cat > .env.production <<'ENV'
  DATABASE_URL=postgresql://...
  JWT_SECRET=...
  PORT=$APP_PORT
  HOST=127.0.0.1
  NODE_ENV=production
  ENV
EOF
  exit 1
fi

echo "==> Updating apt and installing prerequisites"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg lsb-release ufw nginx

echo "==> Installing Node.js $NODE_VERSION via NodeSource"
if ! command -v node >/dev/null || [[ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt "$NODE_VERSION" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Installing certbot for HTTPS"
apt-get install -y certbot python3-certbot-nginx

echo "==> Installing project dependencies"
cd "$APP_DIR"
npm ci --omit=dev || npm install --omit=dev

echo "==> Running database migrations"
node --env-file=.env.production scripts/migrate.js

echo "==> Creating systemd service: $APP_NAME.service"
cat > "/etc/systemd/system/$APP_NAME.service" <<EOF
[Unit]
Description=Closing Console (كاشير اقفال)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env.production
Environment=NODE_ENV=production
ExecStart=/usr/bin/node $APP_DIR/scripts/dev-server.js
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$APP_NAME"
systemctl restart "$APP_NAME"
sleep 2
systemctl --no-pager status "$APP_NAME" | head -15

echo "==> Configuring nginx for $DOMAIN"
cat > "/etc/nginx/sites-available/$APP_NAME" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    client_max_body_size 16M;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_read_timeout 60s;
    }
}
EOF
ln -sf "/etc/nginx/sites-available/$APP_NAME" "/etc/nginx/sites-enabled/$APP_NAME"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Opening firewall ports (HTTP/HTTPS/SSH)"
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable || true

if [[ -n "$EMAIL" ]]; then
  echo "==> Issuing Let's Encrypt cert for $DOMAIN"
  certbot --nginx --non-interactive --agree-tos -m "$EMAIL" -d "$DOMAIN" --redirect || {
    echo "(!) certbot failed — continuing. Run manually after fixing DNS:"
    echo "    certbot --nginx -m $EMAIL -d $DOMAIN --redirect"
  }
else
  echo "==> Skipping HTTPS (no email passed). Run later:"
  echo "    certbot --nginx -m you@example.com -d $DOMAIN --redirect"
fi

echo
echo "============================================================"
echo " ✓ Deployment done"
echo "   App:    http://127.0.0.1:$APP_PORT (proxied)"
echo "   Public: https://$DOMAIN"
echo "   Logs:   journalctl -u $APP_NAME -f"
echo "   Reload: systemctl restart $APP_NAME"
echo "============================================================"
