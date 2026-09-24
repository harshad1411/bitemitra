# Jamzo Restaurant Partner — `@jamzo/restaurant`

Independent Expo (React Native, JavaScript) app for **Android and iOS**. Identity (bundle/package id,
name, scheme, colour) comes from the central registry via `app.config.js` (DECISIONS D-15); its version is
this package's `version` and it releases on its own (`restaurant@x.y.z`).

**Phase 1 shell:** phone-OTP sign-in, approval-aware home screen, maintenance / forced-update gate, push
registration (reports why it cannot register), offline banner. Menu management arrives in Phase 2; new-order alerts and order management in Phase 5.

| Command | What it does |
|---|---|
| `pnpm start` | Expo dev server (set `EXPO_PUBLIC_API_URL`, see `.env.example`) |
| `pnpm test` | component tests (Jest-Expo + React Native Testing Library) |
| `pnpm export` | JavaScript bundles for Android and iOS |
| `APP_VARIANT=production pnpm prebuild:check` | generate native projects to inspect (git-ignored) |

Platform differences: [PLATFORM.md](PLATFORM.md). Icons and splash are **placeholders** (DECISIONS D-16).
