#!/usr/bin/env bash
# Connect the server to Zoho Mail for outgoing email (D-105), run by the owner so the app password never leaves
# the server:   ssh -t root@<droplet-ip> /opt/jamzo/deploy/set-email.sh
# Asks for the Zoho mailbox that owns the noreply@ alias and its app password (hidden), saves them in
# deploy/.env.production, restarts the API and worker, and sends a test email.
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE=.env.production
[ -f "$ENV_FILE" ] || { echo "Run first-setup.sh first."; exit 1; }

echo
echo "== Outgoing email through Zoho Mail =="
read -r -p "Zoho mailbox that owns the noreply alias (e.g. admin@jamzo.in): " SMTP_USER
read -r -s -p "Its Zoho app password (hidden): " SMTP_PASS; echo
read -r -p "Send emails from [noreply@jamzo.in]: " FROM; FROM="${FROM:-noreply@jamzo.in}"
read -r -p "Send a test email to [$SMTP_USER]: " TEST_TO; TEST_TO="${TEST_TO:-$SMTP_USER}"

# Organisation (custom domain) mailboxes in Zoho's India data centre use smtppro.zoho.in, SSL on 465.
sed -i -E '/^(EMAIL_PROVIDER|SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|EMAIL_FROM)=/d' "$ENV_FILE"
cat >> "$ENV_FILE" <<ENV
EMAIL_PROVIDER=smtp
SMTP_HOST=smtppro.zoho.in
SMTP_PORT=465
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
" || { echo "✗ The test email failed. Check the mailbox, the app password and that '$FROM' is an alias of that mailbox."; exit 1; }

$COMPOSE up -d --force-recreate api worker >/dev/null
echo "✓ Saved. The API and worker were restarted with email turned on. Check your inbox for 'Jamzo test email'."
