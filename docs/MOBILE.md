# Mobile applications

Status: **Phase 1 built the three application shells and shared foundations** (OD-4, OD-26). **Phase 2** adds the Restaurant Partner app's store status controls (open/close, pause, busy mode, preparation time) and menu screen with sold-out toggles (RESTAURANTS.md §7); menu content editing by restaurants is not built (D-39). **Phases 3 + 4** turn the customer shell into a browsing app: location, CMS home, search, restaurant menus, item customisation and a cart whose bill comes from the server (§8); **Phase 5** adds checkout (cash on delivery), order tracking and cancellation to the customer app and the order
screens with a looping new-order alert to the Restaurant Partner app (§9). **Phase 6** builds the Jamzo Delivery Partner app (apply, go online with background location, requests, the whole trip, cash, earnings — §10), rider tracking and the delivery code in the customer app, and "who collects" in the Restaurant Partner app. Nothing in the shells pretends to be a
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
| Permissions declared now | notifications | notifications | notifications, **foreground + background location** (requested after an in-app disclosure when going online, Phase 6), camera/photos (documents, proof) |
| Version | own `package.json` `version` (1.0.0 dev) | own | own |
| Release tag | `customer@x.y.z` | `restaurant@x.y.z` | `rider@x.y.z` |

Each app has its own `package.json`, `app.config.js` (reads the registry + env), `eas.json`, EAS project
id (created by the owner's Expo account — not created during development), signing credentials and
release workflow. **No store publication happens during development** (OD-3).

## 2. Stack (JavaScript only)

| Concern | Choice |
|---|---|
| Framework | Expo SDK 57 (React Native 0.86.3, React 19.2.3), JavaScript — `.js`/`.jsx` only; one version for all three apps via the pnpm catalog (SDK upgrades are coordinated, releases are not — D-30) |
| Navigation / deep links | Expo Router (`src/app/`) |
| Server state | TanStack Query (customer app since Phase 3, D-29, D-55) |
| Device state | AsyncStorage — customer cart and chosen location (no secrets, D-55) |
| Location | `expo-location`, foreground only (customer app) |
| Tokens | `expo-secure-store` (Keychain / Android Keystore) |
| Networking | `@jamzo/api-client` via `@jamzo/mobile-foundation` |
| Network state | `@react-native-community/netinfo` |
| Push registration | `expo-notifications` (token → `POST /v1/me/devices`) |
| Builds / updates | EAS Build/Submit/Update with `runtimeVersion: { policy: "appVersion" }` (configured, not run) |

## 3. Shared foundations — `@jamzo/mobile-foundation` (OD-26, D-11)

| Concern | What the package provides |
|---|---|
| Environment | `getAppEnv()` from `expo-constants` `extra` (API URL, variant, schemes, EAS project id); fails loudly if the API URL is missing |
| Secure storage | token store on `expo-secure-store` |
| API client | `@jamzo/api-client` bound to the app id, version and platform; automatic refresh; Idempotency-Key on mutations |
| Authentication | `JamzoProvider` session: restore on launch → phone OTP sign-in (`PhoneSignIn`) → sign out; read via `useJamzo().session` |
| Version check / forced & optional update | `AppGate` decides from remote config: maintenance → force update → optional update banner |
| Remote configuration | `JamzoProvider` fetches `/v1/app-config` on launch and whenever the app returns to the foreground |
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

## 5. Rider app platform specifics (built in Phase 6)

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

The development Mac has **an iOS 26.3 simulator runtime (installed in Phase 6) but no CocoaPods, no Java and no Android SDK**. Installing CocoaPods with Homebrew stopped because it needs the Xcode 26.6 Command Line Tools (`sudo xcode-select --install`, owner's password). So `expo run:ios` has **not** been run.
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

## 8. Customer app (Phases 3 + 4)

| Screen (`apps/customer/src/app/`) | What it does |
|---|---|
| `index.js` | Home for the chosen location: server-resolved CMS sections (D-56), "not served here" explanations, cart bar |
| `location.js` | Current location (foreground permission), saved addresses (signed in), demo point (development builds only) |
| `search.js` | Dishes and restaurants that deliver to the location |
| `restaurant/[id].js` | Menu with Jamzo prices, offers, open/closed and "doesn't deliver here" states, favourite toggle |
| `customize.js` | Size and add-on choices with required/min/max rules and quantity |
| `cart.js` | Lines and quantities, coupon, tip presets, the **server** bill (D-46, D-58), issues |
| `checkout.js` | Saved address, cash on delivery (online methods shown as coming soon — D-60), notes, contactless, the server bill; one idempotency key per attempt (a retry never creates a second order) |
| `orders/index.js`, `orders/[id].js` | Order list and tracking: status, timeline, items, bill; from rider acceptance the partner's first name, vehicle, last location time and the **delivery code** to share at the door (Phase 6; calls only via Jamzo support); cancel until pickup — after acceptance the app first explains there is no refund and, for cash on delivery, how many such cancellations are left before cash on delivery is switched off (OD-38); refreshed by realtime notices and polling |
| `account.js`, `sign-in.js`, `addresses.js` | Guest or signed-in account, phone OTP sign-in when needed, saved addresses, favourites, notifications, legal pages, build info |
| `page/[slug].js` | Published CMS pages (legal drafts show "Not published yet", Q-12) |

**Location permission.** Only foreground location is requested (`NSLocationWhenInUseUsageDescription`,
Android `ACCESS_COARSE/FINE_LOCATION`). The plugin's default "Always" and motion usage descriptions are
removed and Android background location is blocked (`blockedPermissions`) — checked in the prebuild
output (`Info.plist`, `AndroidManifest.xml`) — the customer app never tracks in the background. Denial is explained and saved
addresses remain available. A map pin picker needs the maps provider (Q-14).

**Tests.** `apps/customer/__tests__/app.test.js` drives the real screens through Expo Router against a
fake API whose customer responses (`fixtures.json`) were captured from the real API on the seeded
development database (restaurant marked open so the tests do not depend on the time of day).
**Not verified on a simulator or device** — see §7 and Q-17.

## 9. Restaurant Partner app orders (Phase 5)

| Screen (`apps/restaurant/src/app/`) | What it does |
|---|---|
| `orders.js` | New / In the kitchen / Past. New orders on top with items, choices, notes, food value and time left to accept; accept with a preparation time or reject with a reason; start preparing, ready, +5 minutes. Tells the API the order was seen. |
| `order/[id].js` | Full order; owners and managers also see the money and can cancel an accepted order (D-67). Phase 6: the delivery partner's first name and whether they are at the counter (also on the kitchen list); never their phone. |

**New-order alert.** While any order waits for acceptance and the app is open, a chime loops and the phone
vibrates (`expo-audio`, plays with the iPhone silent switch on); it stops when every new order is accepted or
rejected. When the app is closed, the push notification uses the same sound on a high-importance Android
channel (`new-orders`) and as the iOS notification sound. The chime is a **placeholder**
(`scripts/generate-order-sound.mjs`, Q-13). **Not verified on a device** — sound, vibration and background
push need a simulator/device and the Expo projects (Q-17, Q-18).

**Realtime.** Both apps use `useRealtime` from `@jamzo/mobile-foundation` (Socket.IO, D-62) and also poll
(restaurant 15 s, customer order 20 s).

## 10. Jamzo Delivery Partner app (Phase 6)

| Screen (`apps/rider/src/app/`) | What it does |
|---|---|
| `apply.js` | Application: name and city, vehicle, document photos (camera or library; number only where needed, shown back as last 4), submit; shows what is missing and rejection notes |
| `index.js` | Not yet active → application status. Active → online switch (prominent location disclosure first, then foreground → background permission), the current request with a countdown and vibration (accept / reject with a reason), the current trip: at restaurant → pickup (last 4 digits of the order number) → arrived → delivered (delivery code, cash amount, optional proof photo), navigate (opens Google Maps / Apple Maps), call support, report a problem, give the order back (before pickup), cash in hand and limit |
| `earnings.js` | Today or this week: trips, trip pay, waiting pay, incentives, tips — never food prices or commission |

**Background location.** `src/lib/location.js` registers the task `jamzo-rider-location`
(`expo-location` + `expo-task-manager`; Android foreground service with a "You are online" notification;
iOS `UIBackgroundModes: location`). Points are queued in AsyncStorage and sent in batches of up to 50, so
a lost connection loses nothing. Going offline stops the task. The app asks for "Always" only after the
disclosure; the plugin's motion permission is removed.

**Tests.** `apps/rider/__tests__/app.test.js` (4 tests) drives the real screens against a fake API whose
responses were captured from the real API on the development database. **Not verified on a simulator or
device**: background location with the screen off, the Android foreground-service notification, request
vibration/sound with the app in the background and push delivery all need a device build (see §7).

