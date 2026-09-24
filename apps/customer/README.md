# Customer app (`@jamzo/customer`)

Expo (React Native, **JavaScript**) app for ordering food — Android + iOS from one codebase.

- Identifiers (proposed, see docs/DECISIONS.md Q8): `in.jamzo.customer` · scheme `jamzo://`
- Own version, icon (orange), splash, EAS project, store listings and release tag `customer@x.y.z`
- Displays prices only; every amount comes from the API pricing engine (MASTER_SPEC §9)
- Planned layout: `src/app/` (Expo Router routes), `src/features/`, `src/platform/` (+ `PLATFORM.md`), `assets/`, `app.json`, `app.config.js`, `eas.json`

Status: not created yet — shell in Phase 1, features in Phase 3. Design: [docs/MOBILE.md](../../docs/MOBILE.md).
