# Workers (`@bitemitra/workers`)

BullMQ (Redis) consumers and schedulers sharing the API's domain modules: outbox relay, restaurant-acceptance timeouts, dispatch offers, payment expiry & reconciliation, notifications, media renditions, settlement runs, COD reconciliation, analytics roll-ups. Every handler is idempotent.

Status: not created yet (Phase 1 skeleton: outbox relay + notifications + media).
