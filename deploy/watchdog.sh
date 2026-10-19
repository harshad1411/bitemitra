#!/usr/bin/env bash
# Every 5 minutes (jamzo-watchdog timer, D-118): checks the website, the API, Jamzo Admin, disk space and the
# daily backup from this server, and emails ALERT_EMAIL once when something breaks and once when it is fine
# again. It cannot report the server itself being off — that needs an outside check (DigitalOcean Uptime).
set -uo pipefail
cd "$(dirname "$0")"
STATE=/var/lib/jamzo-watchdog
mkdir -p "$STATE"
problems=()

check_url() {
  local name="$1" url="$2" ok=0
  for _ in 1 2 3; do
    curl -fsS -o /dev/null --max-time 15 "$url" && { ok=1; break; }
    sleep 10
  done
  [ "$ok" = 1 ] || problems+=("$name is not answering ($url)")
}
check_url "The app server (API)" "https://api.jamzo.in/ready"
check_url "Jamzo Admin" "https://admin.jamzo.in/"
check_url "The website" "https://jamzo.in/"

USED="$(df --output=pcent / | tail -1 | tr -dc 0-9)"
[ "$USED" -lt 85 ] || problems+=("The server disk is ${USED}% full")

LAST="$(cat /var/backups/jamzo/last-success 2>/dev/null || echo 0)"
if [ -f /etc/systemd/system/jamzo-backup.timer ] && [ $(( $(date +%s) - LAST )) -gt $((36 * 3600)) ]; then
  problems+=("No successful extra database backup in the last 36 hours")
fi

if [ ${#problems[@]} -gt 0 ]; then
  summary="$(printf -- '- %s\n' "${problems[@]}")"
  if [ "$(cat "$STATE/last" 2>/dev/null)" != "$summary" ]; then
    ./send-alert.sh "Jamzo: something needs attention" "Checked from $(hostname) at $(date -u '+%Y-%m-%d %H:%M UTC'):
$summary
Docker restarts stopped services by itself; if this does not clear in 15 minutes, check: cd /opt/jamzo/deploy && docker compose -f docker-compose.prod.yml ps" &&
      printf '%s' "$summary" > "$STATE/last"
  fi
  printf '%s\n' "$summary" >&2
  exit 1
fi
if [ -s "$STATE/last" ]; then
  ./send-alert.sh "Jamzo: all fine again" "Everything checked from $(hostname) is working again ($(date -u '+%Y-%m-%d %H:%M UTC'))." &&
    rm -f "$STATE/last"
fi
echo "✓ all checks passed"
