# Mobile applications

Status: **Phase 1 builds the three application shells and shared foundations** (OD-4, OD-26). Product
features arrive in Phase 3 (customer), 2/5 (restaurant), 6 (rider). Nothing in the shells pretends to be a
finished feature: after sign-in each app shows who you are, your approval status and which phase delivers
the next functionality.

## 1. Three independent products

All identifiers come from **`packages/config/src/apps.js`** (D-15) — never typed anywhere else.

| | Customer | Restaurant Partner | Delivery Partner |
|---|---|---|---|
| Folder / package | `apps/customer` · `@jamzo/customer` | `apps/restaurant` · `@jamzo/restaurant` | `apps/rider` · `@jamzo/rider` |
| Display name (proposal A-20) | Jamzo | Jamzo Restaurant Partner | Jamzo Delivery Partner |
| Android package / iOS bundle id (OD-3) | `in.jamzo.customer` | `in.jamzo.restaurant` | `in.jamzo.rider` |
| Variant suffixes | `.dev`, `.preview`, none for production | same | same |
| URL scheme | `jamzo` | `jamzo-restaurant` | `jamzo-rider` |
| Universal / App Links | `https://jamzo.in/...` (config ready; needs the `apple-app-site-association` / `assetlinks.json` files on jamzo.in before it works) | — | — |
| Icon / splash | **placeholder** "J" monogram, plum `#5B2A86` (D-16) | **placeholder**, teal `#0F766E` | **placeholder**, saffron `#F2A516` |
| Push | own Expo project → own FCM/APNs credentials | own; high-priority order channel (Phase 5) | own; offer channel (Phase 6) |
| Permissions declared now | notifications | notifications | notifications, **foreground + background location** (declared for Phase 6; not requested yet) |
| Version | own `package.json` `version` (1.0.0 dev) | own | own |
| Release tag | `customer@x.y.z` | `restaurant@x.y.z` | `rider@x.y.z` |

Each app has its own `package.json`, `app.config.js` (reads the registry + env), `eas.json`, EAS project
id (created by the owner's Expo account — not created during development), signing credentials and
release workflow. **No store publication happens during development** (OD-3).

## 2. Stack (JavaScript only)

| Concern | Choice |
|---|---|
| Framework | Expo SDK 57 (React Native 0.86), JavaScript — `.js`/`.jsx` only |
| Navigation / deep links | Expo Router (`src/app/`) |
| Server state | TanStack Query |
| Tokens | `expo-secure-store` (Keychain / Android Keystore) |
| Networking | `@jamzo/api-client` via `@jamzo/mobile-foundation` |
| Network state | `@react-native-community/netinfo` |
| Push registration | `expo-notifications` (token → `POST /v1/me/devices`) |
| Builds / updates | EAS Build/Submit/Update with `runtimeVersion: { policy: "appVersion" }` (configured, not run) |

## 3. Shared foundations — `@jamzo/mobile-foundation` (OD-26, D-11)

| Concern | What the package provides |
|---|---|
| Environment | `getAppEnv()` from `expo-constants` `extra` (API URL, app variant) validated with zod |
| Secure storage | token store on `expo-secure-store` |
| API client | `@jamzo/api-client` bound to the app id, version and platform; automatic refresh; Idempotency-Key on mutations |
| Authentication | `SessionProvider`: restore → sign in (OTP request/verify) → sign out; `useSession()` |
| Version check / forced & optional update | `AppGate` decides from remote config: maintenance → force update → optional update banner |
| Remote configuration | `RemoteConfigProvider` fetches `/v1/app-config`, refreshes on foreground |
| Push registration | `registerForPush()` → permission → Expo push token → API; reports a clear status when it cannot (simulator, no EAS project id, denied) |
| Deep linking | Expo Router scheme per app; `parseDeepLink()` helper |
| Network / offline | `useNetwork()` + `OfflineBanner` |
| Errors | `ErrorBoundary`, `ErrorState`, API error → user message mapping |
| Loading | `LoadingState` / skeleton primitives from `@jamzo/mobile-ui` |
| Lifecycle | `useAppLifecycle()` (foreground/background callbacks) |
| Logging | `createLogger()` (console in dev; pluggable sink; redacts tokens/OTP/phone) |
| Analytics | `analytics.track()` interface with a **no-op/console adapter** — no vendor chosen |

Screens, navigation and flows are **not** shared; each app composes the foundations into its own shell.

## 4. Platform-specific code policy

Platform differences live in `src/platform/` of the app that needs them (`.ios.js` / `.android.js`), and
each app's `PLATFORM.md` lists every divergence and why. Phase 1 has none beyond Expo config (Info.plist
strings and Android permissions for the rider app).

## 5. Rider app platform specifics (Phase 6 — declared in config now)

| Topic | Android | iOS |
|---|---|---|
| Permission flow | foreground first, then background with an in-app prominent disclosure (Play policy) | When In Use → Always; `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription` |
| Background execution | `expo-location` + `expo-task-manager` foreground service (type `location`, `FOREGROUND_SERVICE_LOCATION`) with a persistent "You are online" notification | `UIBackgroundModes: location` |
| Store review | Play background-location declaration + video | App Review justification |
| Recovery | resume tracking after restart if online; queue points offline, flush in batches | same |

## 6. Restaurant app alert specifics (Phase 5)

High-importance Android channel with a long custom sound; iOS custom sound; looping in-app alert until
acknowledged; iOS Critical Alerts only if Apple grants the entitlement.

## 7. Verification (B8) — what can and cannot be proven on the current machine

The development Mac currently has **no iOS simulator runtime, no CocoaPods, no Java and no Android SDK**.
Native Android/iOS builds and on-device runs therefore cannot be executed here without installing
multi-GB toolchains (not done without owner approval). Phase 1 verification per app:

| Check | Method | Runs here? |
|---|---|---|
| JS bundle for Android **and** iOS | `expo export --platform android --platform ios` | yes |
| Native config (ids, schemes, permissions, plugins) | `expo config --type prebuild` + `expo prebuild --no-install` and inspection of generated `AndroidManifest.xml` / `Info.plist` | yes |
| Dependency health | `expo-doctor` / `expo install --check` | yes |
| Foundations logic (version gate, session, API refresh, deep-link parsing) | unit tests | yes |
| Screens render (login, gates, shell) incl. loading/error states | Jest-Expo + React Native Testing Library | yes |
| Android native build | Gradle via CI (`ubuntu`) or `eas build` | **no — CI/owner** |
| iOS native build | `xcodebuild` on a Mac with a simulator runtime + CocoaPods, or `eas build` | **no — needs `xcodebuild -downloadPlatform iOS` + CocoaPods** |
| Real push delivery, deep links from other apps, keyboard/safe areas on devices, screen sizes | Maestro flows on emulator/simulator, then device checks | **no — listed in the phase report with owner steps** |
