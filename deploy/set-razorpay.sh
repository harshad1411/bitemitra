#!/usr/bin/env bash
# Connect the server to Razorpay (D-82), run by the owner so the secrets never leave the server:
#   ssh -t root@<droplet-ip> /opt/jamzo/deploy/set-razorpay.sh
# Asks for the Key ID and Key Secret (hidden), checks them with Razorpay, makes a webhook secret and shows it once
# (to paste into Razorpay → Webhooks), saves everything in deploy/.env.production, then restarts the API and worker.
# Test keys (rzp_test_) first; live keys (rzp_live_) only once the server runs in production mode.
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE=.env.production
[ -f "$ENV_FILE" ] || { echo "Run first-setup.sh first."; exit 1; }

echo
echo "== Razorpay =="
read -r -p "Key ID (starts with rzp_test_ or rzp_live_): " KEY_ID
KEY_ID="$(printf '%s' "$KEY_ID" | tr -d '[:space:]')"
case "$KEY_ID" in rzp_test_* | rzp_live_*) ;; *) echo "That is not a Razorpay Key ID. Nothing was saved."; exit 1 ;; esac
if [ "${KEY_ID#rzp_live_}" != "$KEY_ID" ] && ! grep -q '^APP_ENV=production' "$ENV_FILE"; then
  echo "Live keys are only allowed when the server runs in production mode (it is in demo mode). Use the test keys."
  exit 1
fi
while :; do
  read -r -s -p "Key Secret (hidden — paste with Cmd+V, then Enter): " KEY_SECRET; echo
  KEY_SECRET="$(printf '%s' "$KEY_SECRET" | tr -d '[:space:]')"
  [ "${#KEY_SECRET}" -ge 16 ] && { echo "  ✓ got a secret of ${#KEY_SECRET} characters"; break; }
  echo "  ✗ got ${#KEY_SECRET} characters — that is not a full secret. Paste it again."
done

echo "Checking the keys with Razorpay …"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -u "$KEY_ID:$KEY_SECRET" 'https://api.razorpay.com/v1/orders?count=1')"
[ "$CODE" = "200" ] || { echo "  ✗ Razorpay said $CODE (401 = wrong Key ID or Secret). Nothing was saved."; exit 1; }
echo "  ✓ Keys work"

# Keep an existing webhook secret so a re-run does not break the webhook already set up in Razorpay.
WEBHOOK_SECRET="$(grep -E '^RAZORPAY_WEBHOOK_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)"
NEW_WEBHOOK=0
if [ -z "$WEBHOOK_SECRET" ]; then WEBHOOK_SECRET="$(openssl rand -hex 24)"; NEW_WEBHOOK=1; fi

cp -p "$ENV_FILE" "$ENV_FILE.bak"
sed -i -E '/^(PAYMENT_PROVIDER|RAZORPAY_KEY_ID|RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET)=/d' "$ENV_FILE"
cat >> "$ENV_FILE" <<ENV
PAYMENT_PROVIDER=razorpay
RAZORPAY_KEY_ID=$KEY_ID
RAZORPAY_KEY_SECRET=$KEY_SECRET
RAZORPAY_WEBHOOK_SECRET=$WEBHOOK_SECRET
ENV
chmod 600 "$ENV_FILE"
unset KEY_SECRET

COMPOSE="docker compose -f docker-compose.prod.yml"
$COMPOSE up -d --force-recreate api worker >/dev/null
for i in $(seq 1 30); do
  if $COMPOSE exec -T api node -e "fetch('http://127.0.0.1:4000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    rm -f "$ENV_FILE.bak"
    echo "✓ Saved. The API now takes payments through Razorpay ($KEY_ID)."
    echo
    echo "Last step — Razorpay dashboard → Account & Settings → Webhooks → Add New Webhook:"
    echo "  Webhook URL:   https://api.jamzo.in/v1/webhooks/payments/razorpay"
    if [ "$NEW_WEBHOOK" = 1 ]; then
      echo "  Secret:        $WEBHOOK_SECRET"
      echo "                 (copy it into Razorpay now; it is not shown again — never send it to anyone)"
    else
      echo "  Secret:        unchanged — the one you already entered in Razorpay"
    fi
    echo "  Active events: payment.authorized, payment.captured, payment.failed, refund.processed, refund.failed"
    exit 0
  fi
  sleep 2
done
mv "$ENV_FILE.bak" "$ENV_FILE"
$COMPOSE up -d --force-recreate api worker >/dev/null
echo "✗ The API did not start with these settings, so the old settings were put back. Nothing changed."
exit 1
