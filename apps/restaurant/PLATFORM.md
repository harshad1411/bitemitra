# Platform-specific behaviour — Jamzo Restaurant Partner app

| Area | Android | iOS | Where |
|---|---|---|---|
| Order alert channel | "orders" notification channel (loud, high importance from Phase 5) | notification sound from Phase 5; Critical Alerts only if Apple grants the entitlement | `registerForPush` in `src/app/index.js` |
| Tablet layouts | phones and tablets | `supportsTablet: true` | `app.config.js` |
| Keyboard avoidance | system `adjustResize` | `KeyboardAvoidingView` padding | `@jamzo/mobile-ui` `Screen` |

No `src/platform/` files exist yet (Phase 1).
