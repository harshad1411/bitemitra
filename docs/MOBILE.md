# Mobile applications

Status: **Phase 0 design.** App projects are created in Phase 1 (shells: auth, remote config, version
gate, push registration, deep links); features arrive in Phases 3 (customer), 5 (restaurant), 6 (rider).

Covers MASTER_SPEC Part B (B1–B3, B7–B10), §6, §19–§21, §39, §40, §59–§61.

## 1. Three independent products

| | Customer | Restaurant | Rider |
|---|---|---|---|
| Folder | `apps/customer` | `apps/restaurant` | `apps/rider` |
| Store name (proposal) | BiteMitra | BiteMitra Partner | BiteMitra Rider |
| Android package / iOS bundle id (**⚠ Q8 — irreversible once published**) | `com.bitemitra.customer` | `com.bitemitra.restaurant` | `com.bitemitra.rider` |
| URL scheme | `bitemitra://` | `bitemitra-partner://` | `bitemitra-rider://` |
| Universal / App links | `https://<domain>/…` (needs owner domain) | — | — |
| Icon background (from `assets/brand`) | Orange `#F37321` | Charcoal `#25282B` | Leaf green `#3E9B37` |
| Splash | vertical logo + tagline on orange | on charcoal | on green |
| Push | own FCM sender + APNs topic | own; high-priority order alert channel | own; offer alert channel |
| Special permissions | location (when in use), notifications, camera (reviews) | notifications (loud alerts), optional camera (menu photos) | **foreground + background location**, notifications, camera (proof of delivery), phone (call bridge) |
| Release tag | `customer@1.5.0` | `restaurant@1.2.0` | `rider@1.3.0` |

Each app has its own `package.json` (own semver `version`), `app.json` + `app.config.js`, `eas.json`,
EAS project id, store listings, signing credentials and CI workflow triggered only by changes to that
app or the packages it depends on. **Releasing one app never requires releasing another** (B10).

Build variants per app: `development` (`.dev` id suffix), `preview` (`.preview`), `production` — so all
three variants of all three apps can be installed side by side on one test device.

## 2. Stack (JavaScript only)

| Concern | Choice |
|---|---|
| Framework | Expo SDK 57 (React Native 0.86), created from the **JavaScript** template — no `.ts/.tsx` |
| Navigation | Expo Router (file-based, `src/app/`) — deep links for free |
| Server state | TanStack Query (cache, retries, offline pause/resume, request de-duplication) |
| Local state | Zustand (cart draft, UI state) — kept small |
| Storage | `expo-secure-store` (tokens), MMKV (cache) |
| Lists | FlashList (large menus, order lists) |
| Images | `expo-image` (memory/disk cache, blurhash placeholders); API returns sized renditions |
| Networking | `@bitemitra/api-client` (version headers, timeouts, retry with backoff for idempotent calls, Idempotency-Key on mutations, token refresh) |
| Builds / releases | EAS Build, EAS Submit, EAS Update (OTA JS updates) with `runtimeVersion: { policy: "appVersion" }` so an OTA update only reaches binaries it is compatible with |
| Monitoring | Sentry React Native (proposal, **⚠ Q11**) |

## 3. What is shared, what is not (B9)

Shared via `packages/`: `shared-types` (constants/JSDoc), `validation` (zod schemas for forms),
`api-client`, `ui` (tokens), `mobile-ui` (low-level primitives: Button, Text, Screen, Skeleton,
EmptyState, ErrorState, PriceText). **Not shared**: screens, navigation, app state, business flows.
Each app remains a standalone product with role-appropriate UX: the customer app is a premium consumer
experience; restaurant and rider apps optimise for speed, large touch targets and glanceability.

## 4. Platform-specific code policy

Platform differences live in `src/platform/` of the app that needs them, using React Native's
`.ios.js` / `.android.js` file resolution, and each app has a `PLATFORM.md` listing every divergence
and why. No `Platform.OS` checks scattered through screens.

## 5. Rider app platform specifics

| Topic | Android | iOS |
|---|---|---|
| Permission flow | foreground first, then background ("Allow all the time") with an in-app **prominent disclosure** screen before the system prompt (Play policy) | "When In Use" first, then upgrade to "Always"; `NSLocationWhenInUseUsageDescription` + `NSLocationAlwaysAndWhenInUseUsageDescription` strings |
| Background execution | `expo-location` background task via `expo-task-manager` running as a **foreground service** (type `location`; `FOREGROUND_SERVICE_LOCATION` on Android 14+) with a persistent "You are online" notification | `UIBackgroundModes: location`; `showsBackgroundLocationIndicator` |
| Store review | Play Console background-location declaration + demo video | App Review justification for "Always" location |
| Battery | prompt to exclude from battery optimisation (OEM-specific guidance for Xiaomi/Oppo/Vivo etc.) | significant-change fallback when throttled |
| Recovery | on boot/app restart, resume the task if the rider was online; queue points while offline and flush in batches | same |

Only while the rider is **online** does background tracking run; going offline stops it.

## 6. Restaurant app alert specifics

New orders must be hard to miss (§20): high-importance Android notification channel with a custom
long sound; iOS custom sound (≤ 30 s). While the app is foregrounded, a looping in-app alert plays until
the order is acknowledged, with optional keep-awake on a counter tablet. iOS *Critical Alerts* (bypass
silent mode) need a special Apple entitlement — proposed as a later request, not assumed.

## 7. Verification plan per app (B8)

Automated in CI/local where possible, and each gap is listed explicitly in the phase report:

| Check | How |
|---|---|
| Android build | `expo prebuild` + Gradle release build (CI Linux runner) and/or `eas build --local` |
| iOS build/config | `expo prebuild` + `xcodebuild` for simulator (macOS runner); config validated with `expo config --type prebuild` and `expo-doctor` |
| JS bundles for both platforms | `expo export --platform android,ios` |
| Navigation, auth, API, loading/error states, keyboard, safe areas | Jest-Expo + React Native Testing Library component tests; Maestro flows on Android emulator **and** iOS simulator |
| Deep links | Maestro `openLink` on both platforms |
| Push configuration | config/plugin assertions + receiving a test push on a simulator/emulator (real device required for APNs production delivery) |
| Permissions | Maestro permission-dialog flows; rider background location on emulator/simulator with simulated routes |
| Screen sizes | Maestro on small (e.g. 360×640 dp), large phone and tablet profiles |
| Rider network loss / background ↔ foreground | Maestro + emulator network toggles; background task tests with simulated locations |

Real-device behaviour that emulators cannot prove (OEM battery killers, APNs production delivery,
long-running background location) is listed as **owner-run device tests** with step-by-step scripts.
