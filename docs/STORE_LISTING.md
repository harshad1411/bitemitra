# Play Store listing — ready to paste

Prepared 2026-10-20 (OD-53) so publishing takes minutes once the owner has a Google Play developer account.
Everything here describes what the apps really do (see DECISIONS.md and docs/legal). Check the [[…]] items and the
current Play Console wording before submitting; Google changes its forms from time to time.

Common to all three apps:

| Field | Value |
|---|---|
| Developer name | JAMZO |
| Developer email | support@jamzo.in |
| Website | https://jamzo.in |
| Privacy policy | https://jamzo.in/privacy |
| Account deletion page (Play asks for a web link too) | https://jamzo.in/privacy (section "Your rights" explains in-app deletion; support@jamzo.in for help) |
| Category | Food & Drink (customer) · Business (partner apps) |
| Contains ads | No |
| In-app purchases | No (food is paid for through the order, not as a Play purchase) |
| Target audience | 18 and over |
| Countries | India |

Graphics: the icon is `assets/brand/jamzo-logo-kit/4-app-icons/png/play-store-icon-512.png`. The feature graphic
(1024 × 500) and phone screenshots (at least 2, up to 8) are taken from the apps once they run on a real phone.

## 1. Jamzo (customer) — package `in.jamzo.customer`

**Short description (≤ 80 characters)**
Order food from Unjha's favourite restaurants. See the full bill before you pay.

**Full description**
Jamzo brings food from your favourite restaurants in Unjha to your door.

• Find restaurants that deliver to you — set your address on the map or search for your street, society or a
  landmark.
• Browse menus with photos, ratings from real customers and clear veg / non-veg marks.
• See every rupee of the bill before you order: item prices, delivery fee and any charges.
• Pay cash on delivery (online payment coming soon).
• Follow your order live: accepted, being prepared, on the way, delivered.
• Order again in one tap, and save your favourite restaurants.
• Rate the food and the delivery, and get help from Jamzo support inside the app.

Your phone number is never shown to the restaurant or the delivery partner. You can delete your account in the app
at any time.

## 2. Jamzo Restaurant Partner — package `in.jamzo.restaurant`

**Short description**
Take Jamzo orders, manage your menu and see your sales and payouts.

**Full description**
The Jamzo Restaurant Partner app is for restaurants listed on Jamzo in Unjha.

• New orders arrive with a loud alert; accept with your preparation time or decline with a reason.
• Mark dishes sold out, pause orders when you are busy, and set your opening status.
• See today's sales, ratings and comments from customers.
• Follow each settlement: what was sold, Jamzo's commission and what is paid to your bank.

Sign-in is with the mobile number registered for your restaurant. Restaurants are approved by Jamzo before they go
live.

## 3. Jamzo Delivery Partner — package `in.jamzo.rider`

**Short description**
Deliver with Jamzo in Unjha: choose when you work, see your pay before you accept.

**Full description**
Earn by delivering food with Jamzo in Unjha.

• Apply in the app with your details, vehicle and documents; Jamzo verifies them before you start.
• Go online when you want to work. You see the pickup, drop area and your pay before you accept a request.
• Step-by-step trips: reach the restaurant, pick up, deliver with the customer's code.
• Tips are 100% yours. See your earnings, cash in hand and payouts at any time.

While you are online, the app uses your location — also in the background — to send you nearby requests and to
show customers where their order is. Location is not collected when you are offline.

**Background location declaration (Play asks for it):** the app collects location in the background only while the
delivery partner is online or on a trip, to offer nearby delivery requests and to show the customer the order's
position (rounded to about 100 m). A prominent disclosure is shown before going online (D-74). A short video of
this flow is required by Google — record it on a phone after testing.

## Data safety form (answers for all three apps)

| Question | Answer |
|---|---|
| Data collected | Name, phone number, email (optional); approximate and precise location (customer: while using the app; delivery partner: also in the background while online); purchase history (orders); photos and documents (delivery partners and restaurants, for verification); app interactions and crash logs; device IDs (push notification token) |
| Shared with third parties | Payments are processed by Razorpay (when online payment is on); SMS by MSG91; email by Brevo/Zoho; hosting by DigitalOcean. These are service providers, which Play treats as "not shared" when they process data on Jamzo's behalf — [[confirm in the current form]] |
| Encrypted in transit | Yes (HTTPS) |
| Users can request deletion | Yes — in the app, and by email to support@jamzo.in |
| Data sold | No |

## Before the first release

- [ ] Google Play developer account in JAMZO's name (one-time fee — show the owner the current price first).
- [ ] Production builds (`eas build --profile production`): app bundles with the store package names; Play App
      Signing adds a new SHA-1 that must be added to the Android Maps key.
- [ ] Screenshots and the feature graphic from real phones.
- [ ] Internal testing track first, then closed testing (Play requires testers for new personal accounts), then
      production.
