#!/usr/bin/env bash
# Deploy "إقفال" on a Debian/Ubuntu VPS (Hostinger, DigitalOcean, etc).
# Installs Node 20, Postgres 16, nginx, certbot, then sets up the app.
#
# Usage (run AS ROOT inside the cloned repo):
#   sudo bash scripts/deploy-vps.sh <domain> <admin-email>
#
# Example:
#   sudo bash scripts/deploy-vps.sh eqfal.brave.com.sa admin@brave.com.sa
#
# Prereqs:
#   - Repo cloned at /opt/eqfal (or anywhere; uses CWD).
#   - DNS A record for <domain> pointing to this server.

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
APP_DIR="$(pwd)"
APP_NAME="eqfal"
APP_PORT="${PORT:-8787}"
NODE_VERSION="20"
DB_NAME="eqfal"
DB_USER="eqfal"

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo bash scripts/deploy-vps.sh <domain> <admin-email>"
  exit 1
fi
if [[ "$EUID" -ne 0 ]]; then
  echo "Please run as root: sudo bash scripts/deploy-vps.sh $DOMAIN ${EMAIL:-admin@example.com}"
  exit 1
fi
if [[ ! -f "$APP_DIR/package.json" ]]; then
  echo "ERROR: package.json not found in $APP_DIR. cd into the cloned repo first."
  exit 1
fi

echo
echo "==> Updating apt"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg lsb-release ufw nginx openssl

echo
echo "==> Installing Node.js $NODE_VERSION"
if ! command -v node >/dev/null || [[ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt "$NODE_VERSION" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y nodejs
fi
echo "Node $(node -v)"

echo
echo "==> Installing Postgres 16"
if ! command -v psql >/dev/null; then
  apt-get install -y postgresql postgresql-contrib
fi
systemctl enable --now postgresql

# Create DB + user (idempotent).
DB_PASSWORD="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)"
sudo -u postgres psql <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';
  END IF;
END \$\$;

SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='$DB_NAME')\gexec

GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
SQL

# If user already existed, password line above does nothing — set it just in case.
sudo -u postgres psql -c "ALTER ROLE $DB_USER WITH PASSWORD '$DB_PASSWORD';" >/dev/null

echo
echo "==> Installing certbot"
apt-get install -y certbot python3-certbot-nginx

echo
echo "==> Writing .env.production"
JWT_SECRET="$(openssl rand -base64 48)"
DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME"
cat > "$APP_DIR/.env.production" <<EOF
DATABASE_URL=$DATABASE_URL
JWT_SECRET=$JWT_SECRET
PORT=$APP_PORT
HOST=127.0.0.1
NODE_ENV=production
UPLOAD_DIR=$APP_DIR/data/uploads
EOF
chmod 600 "$APP_DIR/.env.production"

echo
echo "==> Installing app dependencies"
cd "$APP_DIR"
npm install --omit=dev

echo
echo "==> Running migrations"
node --env-file=.env.production scripts/migrate.js

echo
echo "==> Creating systemd service: $APP_NAME.service"
cat > "/etc/systemd/system/$APP_NAME.service" <<EOF
[Unit]
Description=إقفال (Eqfal) — closing console
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env.production
Environment=NODE_ENV=production
ExecStart=/usr/bin/node $APP_DIR/scripts/server.js
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

echo
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

echo
echo "==> Firewall"
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable || true

if [[ -n "$EMAIL" ]]; then
  echo
  echo "==> Issuing Let's Encrypt cert for $DOMAIN"
  certbot --nginx --non-interactive --agree-tos -m "$EMAIL" -d "$DOMAIN" --redirect || {
    echo "(!) certbot failed — fix DNS then run:"
    echo "    certbot --nginx -m $EMAIL -d $DOMAIN --redirect"
  }
else
  echo
  echo "==> Skipping HTTPS (no email passed). Run later:"
  echo "    certbot --nginx -m you@example.com -d $DOMAIN --redirect"
fi

echo
echo "==> Backups (daily pg_dump at 03:00, kept 7 days)"
mkdir -p /var/backups/$APP_NAME
cat > "/etc/cron.d/$APP_NAME-backup" <<EOF
0 3 * * * postgres pg_dump $DB_NAME | gzip > /var/backups/$APP_NAME/db-\$(date +\\%Y\\%m\\%d).sql.gz
5 3 * * * root find /var/backups/$APP_NAME -name 'db-*.sql.gz' -mtime +7 -delete
EOF

echo
echo "============================================================"
echo " ✓ Deployment complete"
echo "   Public URL:  https://$DOMAIN"
echo "   App port:    127.0.0.1:$APP_PORT (proxied by nginx)"
echo "   Logs:        journalctl -u $APP_NAME -f"
echo "   Reload:      systemctl restart $APP_NAME"
echo "   DB backups:  /var/backups/$APP_NAME/  (daily 03:00, 7 days)"
echo "   Env file:    $APP_DIR/.env.production  (chmod 600)"
echo "============================================================"
echo
echo " Now visit https://$DOMAIN/console/signup to create the admin."
echo
