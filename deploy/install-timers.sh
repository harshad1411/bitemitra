#!/usr/bin/env bash
# Installs the systemd timers for the daily extra backup (02:30 India time) and the 5-minute watchdog (D-118).
# Safe to run again. Usage on the Droplet: /opt/jamzo/deploy/install-timers.sh
set -euo pipefail
D=/opt/jamzo/deploy
cat > /etc/systemd/system/jamzo-backup.service <<UNIT
[Unit]
Description=Jamzo daily extra database backup to Spaces
After=docker.service
[Service]
Type=oneshot
ExecStart=$D/backup.sh
UNIT
cat > /etc/systemd/system/jamzo-backup.timer <<UNIT
[Unit]
Description=Jamzo daily extra database backup (02:30 IST)
[Timer]
OnCalendar=*-*-* 21:00:00 UTC
Persistent=true
RandomizedDelaySec=300
[Install]
WantedBy=timers.target
UNIT
cat > /etc/systemd/system/jamzo-watchdog.service <<UNIT
[Unit]
Description=Jamzo watchdog (website, API, admin, disk, backups)
After=docker.service
[Service]
Type=oneshot
ExecStart=$D/watchdog.sh
UNIT
cat > /etc/systemd/system/jamzo-watchdog.timer <<UNIT
[Unit]
Description=Jamzo watchdog every 5 minutes
[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now jamzo-backup.timer jamzo-watchdog.timer
systemctl list-timers --no-pager 'jamzo-*'
