# Platform-specific behaviour — Jamzo customer app

Divergences between Android and iOS, and why (MOBILE.md §4). Code for these lives in `src/platform/`.

| Area | Android | iOS | Where |
|---|---|---|---|
| Keyboard avoidance | system `adjustResize` | `KeyboardAvoidingView` padding | `@jamzo/mobile-ui` `Screen` |
| Push channel | "default" notification channel created before requesting permission | not applicable | `@jamzo/mobile-foundation` `registerForPush` |
| Universal / App Links | `intentFilters` with `autoVerify` (production only) | `associatedDomains: applinks:jamzo.in` (production only) | `@jamzo/config/expo` |

No `src/platform/` files exist yet (Phase 1).
