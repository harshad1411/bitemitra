# Workers (`@jamzo/workers`)

Separately runnable Node.js process (OD-5). Claims `outbox_events` rows from PostgreSQL with `FOR UPDATE SKIP LOCKED` (no Redis — DECISIONS D-9), runs idempotent handlers, retries with backoff and parks events after the maximum attempts.

Phase 1 handlers: `media.uploaded` → image renditions. Later: restaurant acceptance timeouts, dispatch offers, payment expiry/reconciliation, notifications, settlement runs.
