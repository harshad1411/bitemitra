# Platform-specific behaviour — Jamzo Delivery Partner app

Location is declared in native config now and used from Phase 6 (MOBILE.md §5).

| Area | Android | iOS | Where |
|---|---|---|---|
| Location permissions | `ACCESS_FINE/COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION` (requested separately, after an in-app prominent disclosure — Play policy) | When-In-Use then Always; purpose strings in `app.config.js` | `app.config.js` (Phase 6: `src/platform/location.*.js`) |
| Background execution | foreground service type `location` (`FOREGROUND_SERVICE_LOCATION`) with a persistent notification while online | `UIBackgroundModes: location` | `app.config.js` |
| Delivery request alerts | "offers" notification channel | standard notifications | `src/app/index.js` |
| Keyboard avoidance | system `adjustResize` | `KeyboardAvoidingView` padding | `@jamzo/mobile-ui` `Screen` |

No `src/platform/` files exist yet (Phase 1).
