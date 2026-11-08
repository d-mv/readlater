#!/usr/bin/env bash
# Installs (or updates) the nightly backup job on the VPS from this checkout:
# the script as /usr/local/sbin/readlater-backup, the systemd service and
# timer, and the pinned images. The timer is enabled only once
# /etc/readlater-backup.env exists — the credentials go there by hand (see
# docs/architecture.md "Backup and restore"), never through this script.
#
#   bash ops/backup/install.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
vps="$HOME/.agents/skills/deploy/scripts/vps.sh"
host="${DEPLOY_HOST:-admin@167.86.70.240}"
staging=/tmp/readlater-backup-install

rsync -az --delete -e "ssh -o BatchMode=yes" \
  "$here/readlater-backup.sh" "$here/readlater-backup.service" "$here/readlater-backup.timer" \
  "$host:$staging/"

"$vps" --root "
set -e
install -m 755 -o root -g root $staging/readlater-backup.sh /usr/local/sbin/readlater-backup
install -m 644 -o root -g root $staging/readlater-backup.service $staging/readlater-backup.timer /etc/systemd/system/
install -d -m 700 -o root -g root /var/backups/readlater
rm -rf $staging
docker pull -q postgres:17.6-alpine >/dev/null
docker pull -q amazon/aws-cli:2.31.0 >/dev/null
systemctl daemon-reload
if [ -f /etc/readlater-backup.env ]; then
  chmod 600 /etc/readlater-backup.env && chown root:root /etc/readlater-backup.env
  systemctl enable --now readlater-backup.timer
  systemctl list-timers readlater-backup.timer --no-pager
else
  echo 'installed; timer NOT enabled: /etc/readlater-backup.env is missing'
fi
"
