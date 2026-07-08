#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl debian-keyring debian-archive-keyring apt-transport-https git gnupg

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
chmod o+r /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

id fst-api >/dev/null 2>&1 || useradd --system --home /opt/fst-api --shell /usr/sbin/nologin fst-api
install -d -o fst-api -g fst-api /opt/fst-api /var/lib/fst-api/uploads

if [[ ! -d /opt/fst-api/.git ]]; then
  git clone https://github.com/NIMITHASHREE/fst_server_records_Application.git /opt/fst-api
else
  git -C /opt/fst-api pull --ff-only origin main
fi

npm --prefix /opt/fst-api ci --omit=dev
chown -R fst-api:fst-api /opt/fst-api /var/lib/fst-api
install -m 0644 /opt/fst-api/deploy/fst-api.service /etc/systemd/system/fst-api.service
systemctl daemon-reload

echo "Installation complete. Create /etc/fst-api.env and /etc/caddy/Caddyfile, then enable the services."
