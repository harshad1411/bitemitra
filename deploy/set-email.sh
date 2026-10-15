#!/usr/bin/env bash
# Connect the server to an email-sending service (D-105), run by the owner so the password never leaves the
# server:   ssh -t root@<droplet-ip> /opt/jamzo/deploy/set-email.sh
# DigitalOcean blocks ports 25/465/587 on every Droplet (D-112), so the default is Brevo's SMTP relay on port
# 2525. Asks for the SMTP login and key (hidden), saves them in deploy/.env.production, sends a test email, then
# restarts the API and worker.
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE=.env.production
[ -f "$ENV_FILE" ] || { echo "Run first-setup.sh first."; exit 1; }

echo
echo "== Outgoing email (Brevo SMTP relay) =="
read -r -p "SMTP server [smtp-relay.brevo.com]: " SMTP_HOST; SMTP_HOST="${SMTP_HOST:-smtp-relay.brevo.com}"
read -r -p "SMTP port [2525]: " SMTP_PORT; SMTP_PORT="${SMTP_PORT:-2525}"
read -r -p "SMTP login (Brevo shows it, e.g. 9a1b2c001@smtp-brevo.com): " SMTP_USER
case "$SMTP_USER" in *@*) ;; *) echo "The login should look like an email address. Nothing was saved."; exit 1 ;; esac
read -r -s -p "SMTP key (hidden): " SMTP_PASS; echo
read -r -p "Send emails from [noreply@jamzo.in]: " FROM; FROM="${FROM:-noreply@jamzo.in}"
read -r -p "Send a test email to [admin@jamzo.in]: " TEST_TO; TEST_TO="${TEST_TO:-admin@jamzo.in}"

cp -p "$ENV_FILE" "$ENV_FILE.bak"
sed -i -E '/^(EMAIL_PROVIDER|SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|EMAIL_FROM)=/d' "$ENV_FILE"
cat >> "$ENV_FILE" <<ENV
EMAIL_PROVIDER=smtp
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
EMAIL_FROM=Jamzo <$FROM>
ENV
chmod 600 "$ENV_FILE"
unset SMTP_PASS

COMPOSE="docker compose -f docker-compose.prod.yml"
echo "Sending a test email to $TEST_TO …"
$COMPOSE run --rm --no-deps -w /app/services/api -e TEST_TO="$TEST_TO" api node --input-type=module -e "
import { loadEnv, apiEnvSchema } from '@jamzo/config';
import { createEmailProvider } from '@jamzo/notifications';
const env = loadEnv(apiEnvSchema);
const email = createEmailProvider(env.EMAIL_PROVIDER, { env });
const r = await email.send({ to: process.env.TEST_TO, subject: 'Jamzo test email', text: 'This is a test from your Jamzo server. Outgoing email works.', purpose: 'TEST' });
console.log('✓ Sent (' + r.providerRef + ')');
email.close?.();
" || { mv "$ENV_FILE.bak" "$ENV_FILE"; echo "✗ The test email failed, so nothing was saved. Check the login, the key and that '$FROM' is a verified sender."; exit 1; }
rm -f "$ENV_FILE.bak"

$COMPOSE up -d --force-recreate api worker >/dev/null
echo "✓ Saved. The API and worker were restarted with email turned on. Check your inbox for 'Jamzo test email'."
