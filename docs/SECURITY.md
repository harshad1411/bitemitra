# Security & privacy

Status: **Phase 1 implements** authentication (phone/email OTP, admin password), sessions, RBAC, validation, log redaction, rate limiting and secure headers. Payment security: Phase 7. Hardening/pen-test: Phase 10. Decisions: OD-13, OD-24, D-20..D-25.

Covers MASTER_SPEC §48, §49, §50, §52.

## 1. Authentication

Provider-based (OD-13, D-20): each login method is an `auth_identities` row. Methods are enabled per app
by the setting `auth.methods`:

| Provider | Phase 1 status |
|---|---|
| `PHONE_OTP` | **implemented**; SMS sent through `SmsProvider` — **console provider only** until a DLT provider is chosen (Q-6) |
| `EMAIL_OTP` | **implemented**; `EmailProvider` — **console provider only** (Q-6) |
| `GOOGLE`, `APPLE` | **slots only**: configuration + routes exist, return `AUTH_METHOD_UNAVAILABLE`; ID-token verification needs client ids (Q-6b) |
| `PASSWORD` | **implemented for admin** (argon2id) with lockout |

Defaults: customer, restaurant and rider apps → phone OTP (email OTP available, off); admin → password.
**Admin 2FA is deferred** (CH-8, Q-15): Admin must not be exposed to the public internet until it ships.

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
| Card numbers / CVV | never received or stored (provider SDK) |
| Bank account numbers, KYC document numbers | AES-256-GCM application encryption, key via env/KMS, `last4` for display, access audit-logged |
| OTPs, refresh tokens, passwords | hashes only |
| Customer phone/address | masked for riders/restaurants (first name + masked number; call bridge); full values only to roles with `customers.pii` |
| Rider live location | visible to the customer only during an active delivery |

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
