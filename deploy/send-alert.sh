#!/usr/bin/env bash
# Sends an alert email through the server's email settings (Brevo, D-105) to ALERT_EMAIL (default
# admin@jamzo.in). Used by watchdog.sh and backup.sh.   Usage: send-alert.sh "Subject" "Message"
set -euo pipefail
cd "$(dirname "$0")"
TO="${ALERT_EMAIL:-admin@jamzo.in}"
docker compose -f docker-compose.prod.yml run --rm --no-deps -T -w /app/services/api \
  -e ALERT_TO="$TO" -e ALERT_SUBJECT="$1" -e ALERT_TEXT="$2" api node --input-type=module -e "
import { loadEnv, apiEnvSchema } from '@jamzo/config';
import { createEmailProvider } from '@jamzo/notifications';
const env = loadEnv(apiEnvSchema);
const email = createEmailProvider(env.EMAIL_PROVIDER, { env });
await email.send({ to: process.env.ALERT_TO, subject: process.env.ALERT_SUBJECT, text: process.env.ALERT_TEXT, purpose: 'ALERT' });
email.close?.();
" >/dev/null
