# Security & privacy

Status: **Phase 1 implements** authentication (phone/email OTP, admin password), sessions, RBAC, validation, log redaction, rate limiting and secure headers. **Phase 2 adds** application-layer encryption of bank account numbers with four-eyes verification (D-35), private KYC documents (D-36) and restaurant-partner authorisation re-checked on every request (D-42). **Phase 5 adds** order authorisation (customers see only their orders, restaurants only their own and never customer contact details or platform margins — D-67), realtime sockets authenticated with the same token and session checks as HTTP and joined only to rooms the user may see (D-62), and double-order protection (idempotency key + unique `(customerId, idempotencyKey)`). **Phase 6 adds** rider approval separate from sign-in (OD-13), rider document protection, single-winner assignment (database rule), the delivery code and rider/customer privacy (table below). **Phase 7 adds** payment and refund security, **Phase 8** append-only ledgers and recorded (never automatic) payouts; **Phase 9** support privacy and audited exports; **Phase 10** hardening: per-user rate limits, secret scanning, admin CSP/HSTS, token-protected metrics, private file storage (table below). Hardening still open: admin two-factor sign-in (Q-15, before production), an external penetration test.  Hardening/pen-test: Phase 10. Decisions: OD-13, OD-24, D-20..D-25.

Covers MASTER_SPEC §48, §49, §50, §52.

## 1. Authentication

Provider-based (OD-13, D-20): each login method is an `auth_identities` row. Methods are enabled per app
by the setting `auth.methods`:

| Provider | Phase 1 status |
|---|---|
| `PHONE_OTP` | **implemented**; SMS through `SmsProvider`: console (development) or **MSG91** with a DLT template (D-104; tested against a fake MSG91 only until the owner's account exists) |
| `EMAIL_OTP` | **implemented**; `EmailProvider`: console (development) or **SMTP** (D-105) |
| `GOOGLE`, `APPLE` | **slots only**: configuration + routes exist, return `AUTH_METHOD_UNAVAILABLE`; ID-token verification needs client ids (Q-6b) |
| `PASSWORD` | **implemented for admin** (argon2id) with lockout |

Defaults: customer, restaurant and rider apps → phone OTP (email OTP available, off); admin → password.
**Admin two-step sign-in** (OD-43, D-106): after the password, a 6-digit code goes by SMS if the admin has a
phone number, otherwise by email. It is required in staging and production (`ADMIN_2FA`; the API will not
start with it off there) and can be off in development and tests.

Authentication never implies approval: restaurant/rider features additionally require an approved
membership/profile ([RBAC.md §4](RBAC.md#4-non-admin-actors)).

**OTP**: 6 digits from a CSPRNG; stored as HMAC-SHA256 with a server pepper; 5-minute expiry; max 5
verify attempts per challenge; resend cooldown 30 s; per-phone (5/hour) and per-IP limits; constant-time
compare; generic error messages (no user enumeration). A dev-only console SMS adapter is refused at
startup in staging/production.

**Tokens**: access token = signed JWT (EdDSA or HS256 with rotated keys), 15-minute lifetime, claims
`sub`, `app`, `sid`, `perm` version. Refresh token = opaque 256-bit random, stored as SHA-256, 30-day
sliding expiry, **rotated on every use**; reuse of a rotated token revokes the whole session family
(theft detection). Mobile stores refresh tokens in Keychain/Keystore (`expo-secure-store`). Admin
keeps the access token in memory and the refresh token in an httpOnly, `SameSite=Strict` cookie (Secure
outside local development) scoped to `/api/v1/admin/auth`, served same-origin through the Next.js proxy;
refresh additionally requires the `x-app-id: ADMIN` header, which cross-site forms cannot send (D-22).

**Brute force**: progressive delays and account lock (`admin_users.lockedUntil`) after repeated
failures; alerts on spikes.

## 2. Authorisation

See [RBAC.md](RBAC.md). Object-level checks on every resource (IDOR protection), deny by default.

## 3. Input & output

- zod validation on every body/query/param (unknown keys rejected); size limits.
- SQL via Prisma or tagged `$queryRaw` templates only — string-built SQL is banned by lint.
- XSS: admin renders text with React escaping; CMS rich text is Markdown rendered through a sanitiser; no `dangerouslySetInnerHTML` without sanitising (lint rule).
- Uploads: MIME sniffing, size limits, images re-encoded by the media worker (strips EXIF/GPS), private buckets with signed URLs for documents.
- Secure headers via helmet (HSTS, CSP for admin, frame-ancestors none, nosniff, referrer policy).

## 4. Sensitive data

| Data | Protection |
|---|---|
| Card numbers / CVV | never received or stored: the customer pays on the gateway's own checkout inside Jamzo's payment page (D-84) |
| Payment confirmation | only the server decides: signed webhooks (HMAC-SHA256 over the raw body, stored before processing, duplicates ignored) or the server asking the gateway; the app's "verify" only asks the server to check (§24, D-85) |
| Payment page | signed link valid 30 minutes; strict content security policy (nonce scripts, only Razorpay's checkout allowed); returns only to the Jamzo app's own schemes (no open redirect); shows the amount and order number only |
| Gateway keys | `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` only in the server environment; the page gets the public key id only; live keys refused outside production, test keys refused in production (D-82) |
| Support | customers see only their own tickets and never internal notes or agent names; agents see the customer's phone only with `customers.pii` (D-93) |
| Exports and search | orders CSV and audit CSV exports are audited; phones are masked unless `customers.pii`; searching orders by a customer's phone number needs `customers.pii` (D-94, D-97) |
| Rate limits | signed-in requests count per user, anonymous per IP (carrier-grade NAT in India, D-100); sign-in codes have their own per-number and per-IP limits; monitoring endpoints exempt |
| Secrets | `pnpm check:secrets` in CI refuses committed private keys, live gateway keys, cloud and API tokens and `.env` files; production secrets live only in `deploy/.env.production` on the server |
| Admin site | HSTS, frame denial, CSP limited to the site's own origin (production) |
| Files | Spaces: public renditions only; KYC and partner documents under `private/` are never public (D-98) |
| Ledgers | entries are append-only (a database trigger refuses edits and deletes; corrections are new entries), posted once per idempotency key; balances re-checked against entries in Finance → Checks (D-88) |
| Payouts | Jamzo never moves money: Finance pays outside Jamzo and records the reference; approval and payout recorded in the audit log; restaurants see only their own prices and deductions (D-89) |
| Refunds | money moves only through refund rows: idempotency key, database rule refunded ≤ captured, the order locked while checking what is left, maker-checker above `refunds.approval`, every action audit-logged (D-86) |
| Bank account numbers | AES-256-GCM application encryption (`FIELD_ENCRYPTION_KEY`, key id in the ciphertext), `last4` only in API responses and audit logs; no Phase 2 endpoint decrypts; a different admin must verify new details (D-35) |
| KYC document files | private storage keys (`private/…`), never served by the public media route, downloaded only by admins with `restaurants.view`, every view audit-logged (D-36). Document *numbers* (FSSAI, PAN, GSTIN) are stored in clear text — they are public-registry identifiers, not secrets |
| OTPs, refresh tokens, passwords | hashes only |
| Customer phone/address | masked for riders/restaurants (first name + masked number; call bridge); full values only to roles with `customers.pii`. Admin customer screens are masked by default; revealing a customer's phone/addresses is a separate request, audit-logged (D-57) |
| Rider live location | visible to the customer only during an active delivery, rounded to about 100 m (D-79); breadcrumbs kept for admins/support |
| Rider documents | private storage, viewed only by admins with `riders.view`, every view audit-logged; document numbers encrypted with the field cipher, only the last 4 shown; Aadhaar numbers not collected (D-73) |
| Rider ↔ customer | the rider sees the customer's first name and delivery address, never the phone; the customer sees the rider's first name and vehicle, never the phone; calls via support until masked calling (Q-21) |
| Delivery code | derived from the order id with a server secret (HMAC), never stored; 5 wrong tries flag the order for operations (D-76) |
| Maps key | `GOOGLE_MAPS_API_KEY` only in the server environment; never in an app or the admin site (D-81) |

## 5. Logging (§50)

pino JSON logs with `requestId` and domain ids. A redaction list (`authorization`, `cookie`,
`password`, `otp`, `refreshToken`, `accountNumber`, `pan`, `aadhaar`, webhook secrets…) is applied at
the logger, and tests assert redaction. Logs never contain full phone numbers (masked helper).

## 6. Secrets & environments (§52)

Secrets only in environment variables / a secrets manager; `.env.example` documents every variable
with safe placeholders; `.env*` git-ignored. Payment adapters refuse live keys outside production and
test keys in production. Separate databases, buckets, push credentials and payment accounts per
environment (development, test, staging, production).

## 7. Privacy (§49)

- **Account deletion**: customer/rider self-service request → 30-day grace → PII scrubbed in place (name, phone, email, addresses), sessions/devices removed; orders, invoices and ledgers retained with the anonymised reference (legal retention).
- **Address deletion**: soft delete; orders keep their own address copy.
- **Data export**: async job produces a JSON/CSV archive of the user's data, delivered via signed URL.
- **Consent records** (`consent_records`) for terms, privacy policy and marketing channels, versioned.
- **Notification preferences** per channel and topic; transactional messages always sent.
- Compliance target: India's DPDP Act 2023 obligations — to be confirmed with counsel (**⚠ [Q-12](DECISIONS.md#5-questions)**).

## 8. Supply chain & operations

Lockfile committed; `pnpm audit` + Dependabot in CI; only pinned GitHub Actions; least-privilege cloud
IAM; database backups with point-in-time recovery and restore drills (Phase 10); dependency
install scripts allow-listed (`pnpm-workspace.yaml` `allowBuilds`).
