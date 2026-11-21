# MEDNEXORA Production Deployment Guide

This guide prepares the existing application for deployment. It does not mean the app has been deployed or that production infrastructure has been verified. The owner has purchased `mednexora.site`; DNS, Vercel assignment, HTTPS, email-domain verification, database and payment credentials still require separate owner-controlled setup and verification.

## 1. Recommended architecture

Use one public HTTPS origin for the site and API:

```text
https://<confirmed-domain>/       -> React/Vite static build
https://<confirmed-domain>/api/*  -> Node/Express service
                                      -> managed MongoDB over TLS
                                      -> persistent private PDF storage
```

This matches the frontend, which sends relative `/api` requests, and the backend, which does not enable general cross-origin credentialed requests. Configure the hosting proxy to send `/api/*` to Express before the frontend's SPA fallback. Send other application routes to `frontend/dist/index.html` so direct links and refreshes work.

The current app supports this layout. It does not include a platform-specific deployment file or serve the Vite build from Express. Use a static frontend host plus a Node host, or a host that supports both static files and a Node service. Put MongoDB on a managed service with TLS, a dedicated database user and a restricted network allowlist.

## 2. Runtime and build requirements

- Backend: Node.js 20.19 or newer; install from `backend/`; start with `npm start`.
- Frontend build: Node.js 20.19.x or 22.12 or newer (as required by the frontend package); install and build from `frontend/` with `npm ci` and `npm run build`.
- Publish `frontend/dist` as static files. The frontend package is not a production web server; `npm run preview` is for local preview only.
- PowerShell users can use `npm.cmd` if script execution policy blocks `npm.ps1`.

## 3. Environment variables

Set backend variables in the hosting provider's **server-side secret/configuration panel**. Do not commit `.env` files. The example files contain development defaults and must not be copied unchanged into production.

| Variable | Required and format | Scope / sensitive? |
|---|---|---|
| `NODE_ENV` | Required: exactly `production` | Backend runtime; not sensitive |
| `APP_ENV` | Must be explicitly set to `staging` or `production` when `NODE_ENV=production`; production-like runtime accepts only these values | Backend runtime; not sensitive |
| `PORT` | Host-provided port; defaults to `5000`; integer `1–65535` | Backend runtime; not sensitive |
| `MONGODB_URI` | Required in production; `mongodb://` or `mongodb+srv://` URI for a TLS-enabled database user | Backend runtime; **sensitive** (contains database credentials) |
| `SESSION_SECRET` | Required; unique random value of at least 32 bytes; do not use the example placeholder | Backend runtime; **sensitive** |
| `SESSION_MAX_AGE_DAYS` | Optional; integer `1–30`; defaults to `7` | Backend runtime; not sensitive |
| `APP_ORIGIN` | Required; exact public HTTPS origin, with no path, query or credentials | Backend runtime; not sensitive |
| `TRUST_PROXY` | Optional; defaults to `0`. Behind a proxy, use only the actual trusted proxy IPs/CIDRs or supported narrow range names | Backend runtime; not sensitive |
| `PRIVATE_STORAGE_DIR` | **Required in production**; absolute path to a mounted private storage directory outside frontend public/build directories | Backend runtime; path is not a secret, but reveals infrastructure details |
| `PRIVATE_STORAGE_ORIGIN` | Optional; HTTPS origin for the supported private-file service; references must use the supported `/private/` path | Backend runtime; generally not sensitive |
| `RAZORPAY_MODE` | Staging: required, exactly `test`. Production: required, exactly `live`; production rejects missing or `test` mode | Backend runtime; not sensitive |
| `RAZORPAY_KEY_ID` | Required when `APP_ENV=production`; live key ID with the expected `rzp_live_` prefix. Optional in staging; if configured there, it must use `rzp_test_` | Backend runtime; public identifier, but keep it out of frontend configuration |
| `RAZORPAY_KEY_SECRET` | Required when `APP_ENV=production`; optional in staging while payments are disabled | Backend runtime; **sensitive** |
| `RAZORPAY_WEBHOOK_SECRET` | Required when `APP_ENV=production` because webhook processing is enabled; optional in staging while webhooks are disabled | Backend runtime; **sensitive** |
| `PUBLIC_SITE_URL` | Production: `https://mednexora.site` after Vercel domain assignment and HTTPS verification. Staging: its staging Vercel origin. HTTPS origin only, no path/query/credentials | Frontend build time; not sensitive; consumed by build/config scripts, not exposed as a client `VITE_*` variable |
| `API_PROXY_TARGET` | Optional development-only Vite proxy origin; defaults to `http://127.0.0.1:5000` | Frontend development environment; not used by production runtime or bundle |
| `MEDNEXORA_DEPLOYMENT_TARGET` | Vercel only: explicitly `production` or `staging`; choose per project/environment | Vercel build configuration; not sensitive |
| `MEDNEXORA_STAGING_API_ORIGIN` | Required by staging Vercel config; exact approved staging Railway HTTPS origin | Vercel staging build configuration; not sensitive |
| `VERCEL_PROJECT_PRODUCTION_URL` | Vercel system variable; config checks it against the expected project domain | Vercel-provided; not a secret |
| `PASSWORD_RESET_EMAIL_ENABLED` | Optional, defaults `false`; keep false until email-domain verification and controlled test approval | Backend; not sensitive |
| `REGISTRATION_EMAIL_VERIFICATION_ENABLED` | Optional, defaults `false`; keep false until controlled staging email test is approved | Backend; not sensitive |
| `RESEND_API_KEY` | Required only when either email feature is enabled; use the provider-issued key, never a placeholder | Backend only; **sensitive** |
| `PASSWORD_RESET_FROM_EMAIL` | Required only when either email feature is enabled; exact sender address at the domain verified by Resend | Backend only; not sensitive |
| `PASSWORD_RESET_OTP_PEPPER` | Required only when password-reset email is enabled; unique random secret, at least 32 bytes | Backend only; **sensitive** |
| `REGISTRATION_OTP_PEPPER` | Required only when registration email verification is enabled; unique random secret, at least 32 bytes and different from the reset pepper | Backend only; **sensitive** |
| `PUBLIC_BETA_REGISTRATION_ENABLED` | Keep `false` until owner approves public registration and all launch gates | Backend; not sensitive |
| `PUBLIC_BETA_PAID_PURCHASES_ENABLED` | Keep `false` until owner approves commercial activation and live-payment readiness | Backend; not sensitive |
| `STAGING_RESTRICTED_REGISTRATION_ENABLED` | Keep `false` for initial staging; may be enabled only for a separately approved, invitation-restricted email test | Backend staging only; not sensitive |
| `PUBLIC_ABOUT_PAGE_APPROVED` | Keep `false` until the owner has reviewed and approved About Us | Backend; not sensitive |
| `PUBLIC_CONTACT_PAGE_APPROVED` | Keep `false` until the owner has reviewed and approved Contact Us | Backend; not sensitive |
| `PUBLIC_FAQ_PAGE_APPROVED` | Keep `false` until the owner has reviewed and approved FAQ | Backend; not sensitive |
| `PUBLIC_PRIVACY_POLICY_APPROVED` | Keep `false` until the owner has reviewed and approved the Privacy Policy | Backend; not sensitive |
| `PUBLIC_TERMS_PAGE_APPROVED` | Keep `false` until the owner has reviewed and approved Terms | Backend; not sensitive |
| `PUBLIC_REFUND_POLICY_APPROVED` | Keep `false` until the owner has reviewed and approved Refund and Cancellation Policy | Backend; not sensitive |

Use a cryptographically random session secret; for example, generate one with Node's `crypto.randomBytes(32)`. Do not paste it into chat, source code, or a frontend environment variable. Store Razorpay values only in backend runtime configuration. The backend checks deployment lane, required credentials, key ID prefix, HTTPS origin, session-secret length and proxy syntax before startup.

### Railway staging without a Razorpay account

Use a separate staging service and a separate staging MongoDB database. Set `NODE_ENV=production` so production-runtime protections remain enabled (Secure cookies, HTTPS requirements, mounted private storage and production error handling), and set `APP_ENV=staging` to select the restricted staging payment lane. Set `RAZORPAY_MODE=test` explicitly. Staging rejects live mode and live-prefixed key IDs; it never falls back to live credentials.

For the initial non-payment deployment, leave `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` unset. Payment checkout and verification remain unavailable without the API key pair, and webhooks require both that API key pair and the webhook secret. Do not add placeholder credentials. If test payments are configured later, use only a complete Razorpay test key pair (`rzp_test_` key ID) and a test webhook secret, all in Railway backend variables. Captured access still requires the existing server-side signature and captured-payment checks.

Also set the actual staging `MONGODB_URI`, unique `SESSION_SECRET`, frontend HTTPS `APP_ORIGIN`, absolute mounted `PRIVATE_STORAGE_DIR`, and provider-assigned `PORT`. Configure `TRUST_PROXY` only for a reviewed, trusted proxy value; do not set it to `true` or `*`. Never point staging at the production database or reuse production payment credentials.

For Railway, configure these values in the backend service's Variables panel (supply actual staging-specific values privately):

```text
NODE_ENV=production
APP_ENV=staging
RAZORPAY_MODE=test
MONGODB_URI=<staging MongoDB Atlas URI>
SESSION_SECRET=<unique random secret, at least 32 bytes>
APP_ORIGIN=<staging frontend HTTPS origin>
PRIVATE_STORAGE_DIR=<absolute path on a mounted persistent volume>
PORT=<Railway-provided port>
```

Do not set the three Razorpay credential variables until test credentials exist. Leave them unset rather than entering placeholders. Railway may provide `PORT`; the application reads that value.

`PRIVATE_STORAGE_DIR` must now be explicitly set to an absolute path in production. This prevents the app from silently choosing its development fallback. The application can validate the path and ensure it is outside frontend static directories, but it cannot determine whether a hosting provider actually backs that path with durable storage; verify the mounted volume in the host dashboard.

### Set the production site origin for the frontend build

Provide the real domain that you own and have configured. Do not use the example placeholder literally. The value must be the origin only, for example `https://<your-confirmed-domain>`.

PowerShell build example (replace the value with your actual domain):

```powershell
cd frontend
$env:PUBLIC_SITE_URL = "https://<your-confirmed-domain>"
npm.cmd ci
npm.cmd run build
```

The build generates `dist/sitemap.xml` and adds its URL to `dist/robots.txt` only when a valid HTTPS origin is provided. Without it, the build succeeds but omits the sitemap. The current sitemap lists static public routes; it does not enumerate dynamic product, course or examination detail routes. Route-specific titles/canonical/Open Graph values are currently applied client-side after the SPA loads.

## 4. MongoDB setup and startup index checks

1. Create a production database and a dedicated application database user. Restrict that user's privileges to the application database. Enable TLS and allow network access only from the backend host.
2. Take a recoverable backup before the first production startup. Confirm that the backup can be restored into a separate database.
3. Review the current database index catalog and migration notes before starting the API. The app connects to MongoDB before it listens, checks the primary-exam index, checks for legacy order reservations, and calls `Model.init()` to initialize declared indexes.
4. `ensurePrimaryExamIndex` may drop an obsolete index on `isPrimary`; Mongoose then initializes the declared unique partial index. Startup can fail if existing examination data conflicts with the unique rule. The production collection has not been inspected as part of this guide.
5. If legacy active orders lack reservation metadata, startup stops. From `backend/`, run the reservation backfill **without** `--apply` first. Review conflicts. The apply form updates reservation metadata on existing order records; take a backup and obtain approval before using it.
6. From `backend/`, the StudyMaterial text-index command without `--apply` inspects indexes and metadata. If the live database still has the recognized legacy text index, its apply form replaces that index but does not change documents. Back up and review the inspection output before applying it.

Inspection commands (they still connect to the selected database; verify `MONGODB_URI` before running):

```sh
cd backend
npm run payments:reservations:backfill
npm run db:study-material-text-index
```

Only after reviewing the dry-run reports, resolving conflicts and approving any required database changes:

```sh
npm run payments:reservations:backfill -- --apply
npm run db:study-material-text-index -- --apply
```

Do not run an apply command automatically in a deployment hook. Do not run these commands against production until the target database, backup and maintenance window are confirmed.

## 5. Persistent private PDF storage

The default local directory is `backend/private-files/`. Uploaded PDFs are written there with UUID filenames and restrictive file permissions. They are not served from `frontend/public` or `frontend/dist`; student download requests go through an authenticated backend endpoint that checks publication and the student's active free entitlement or verified purchase.

For a single backend instance, mount a durable, access-controlled volume and set `PRIVATE_STORAGE_DIR` to its absolute mount path. Ensure the backend process can read and write it, and do not mount it into the static frontend host. A local disk may survive a process restart on a persistent VM, but an ephemeral container or redeployment may erase it. For multiple backend instances, use shared durable storage or the supported private-file service; instance-local disks do not share files.

Back up private PDFs separately from MongoDB and keep the file backup and database backup from a compatible time. Test a restore into a non-production environment. No existing files were moved or deleted during preparation.

## 6. Deploy the backend

1. Set backend environment variables in the host's secret/configuration panel. For a production deployment, use `NODE_ENV=production`, `APP_ENV=production`, a verified HTTPS `APP_ORIGIN`, the target `MONGODB_URI`, unique `SESSION_SECRET`, explicit `PRIVATE_STORAGE_DIR`, `RAZORPAY_MODE=live`, and the three required live Razorpay values. For pre-payment staging, follow the staging section above.
2. Configure the host's trusted proxy addresses in `TRUST_PROXY` if TLS terminates before Node. The proxy must set/replace forwarded protocol and host headers. Do not set blanket trust.
3. Install and start from `backend/`:

   ```sh
   npm ci
   npm start
   ```

4. Wait for the host readiness check at `GET /api/health` to return `200`. It returns `503` until MongoDB is ready. Startup does not begin listening until database/index checks finish.
5. If no administrator exists, provision one only after confirming the backend points at the intended production database. Use the trusted `npm run admin:create` CLI; it creates a database record and must not be run against an unintended database.

The backend uses MongoDB for sessions. Student and administrator sessions use distinct cookie names. Production cookies are `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`. Write endpoints check the configured application origin. The API has safe generic responses for unexpected errors, but host logs should still be access-controlled and monitored.

## 7. Deploy the frontend and configure routing

1. Configure the build environment's `PUBLIC_SITE_URL` to the confirmed public HTTPS origin.
2. From `frontend/`, install and build:

   ```sh
   npm ci
   npm run build
   ```

3. Publish only `frontend/dist` as the static site.
4. Configure the edge/reverse proxy to route `/api/*` to the backend first. Route frontend page URLs to `index.html` so direct visits and refreshes on `/login`, `/courses`, `/study-material`, `/admin/login`, and other SPA routes work. Do not route private storage paths directly to a public static origin.
5. Configure HTTPS and security headers at the static host/CDN. The active Vercel configuration sets CSP, frame denial, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and disables API rewrite caching. The current CSP allows the exact checkout/font/video origins used by the app. Its `img-src https:` source is intentionally scheme-wide because the current admin/catalogue supports HTTPS image URLs without a host allowlist. Review this constraint in a real browser before production; CSP has only been exercised by configuration tests, not a deployed browser.

The current API uses same-origin relative `/api` requests. Hosting the frontend and backend on unrelated origins without a same-origin proxy is not supported by the current configuration.

## 8. Custom domain, HTTPS and sender-domain preparation

The purchased domain is `mednexora.site`. The current production Vercel config pins the production API to the production Railway origin, pins the Vercel project identity to `mednexora-8ams.vercel.app`, and sets `https://mednexora.site` as the expected production canonical origin. Staging remains pinned to `mednexora-shk6.vercel.app` and its staging Railway API. Do not attach the public domain to the staging project.

### Vercel domain setup (owner action; do not guess DNS values)

The code is prepared for the apex canonical URL `https://mednexora.site`; `www.mednexora.site` should redirect to the apex. Vercel supports either redirect direction, although its documentation recommends `www` as primary for CDN control. The apex choice here follows the current project configuration; changing to `www` would require a reviewed code/config update as well as a hosting redirect change. See [Vercel custom-domain setup](https://vercel.com/docs/domains/set-up-custom-domain) and [domain redirects](https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting).

1. In the existing **production** Vercel project, open **Settings → Domains**. Confirm this is the project serving `mednexora-8ams.vercel.app`, connected to the intended repository and production branch.
2. Add `mednexora.site` and `www.mednexora.site` to that production project only. Do not add either to the staging Vercel project.
3. For each hostname, read the exact verification/DNS records shown by the Vercel dashboard. Enter those values at the domain registrar's DNS panel exactly as provided; do not substitute remembered or generic A/CNAME/TXT values.
4. Set the `www.mednexora.site` domain's redirect target to `mednexora.site`. Wait for Vercel to report domain verification and provisioned TLS for both names.
5. Check that `https://www.mednexora.site` redirects to `https://mednexora.site`, the apex serves the production deployment, and HTTP is upgraded to HTTPS.
6. Only after those checks, set production frontend build variable `PUBLIC_SITE_URL=https://mednexora.site` and backend `APP_ORIGIN=https://mednexora.site`. Keep Vercel production project identity at `mednexora-8ams.vercel.app`; it is a separate Vercel system/project value, not the canonical public URL.
7. Confirm the production Vercel rewrite still targets the production Railway backend and staging remains on the staging backend. Do not configure a staging custom domain as part of this procedure.
8. Rebuild and inspect `sitemap.xml`, `robots.txt`, page canonical and Open Graph URLs. The build script emits only `/`, `/target-exams`, `/study-material`, and `/courses`; it does not enumerate dynamic product/course/exam pages. Route metadata is applied client-side, so verify it with a browser/crawler that executes the SPA. Do not submit a sitemap until the canonical domain is verified and public content is ready.

Adding a custom domain can make the currently assigned production deployment reachable at that hostname; it does not deploy new code, but it changes public routing. Before adding it, confirm the owner accepts that exposure, the deployment is the intended production release, unpublished content remains hidden, legal-page approval gates are unchanged, and public registration/purchases are still disabled.

### Resend sender-domain plan (owner action; sending remains disabled)

Resend requires an owned domain to be added and verified before it will send. Resend recommends using a dedicated sending subdomain to isolate transactional-email reputation. A reasonable candidate is `mail.mednexora.site`, but the owner must choose it and add it in the Resend dashboard; it has not been verified here.

1. In Resend, add the chosen sending domain (candidate `mail.mednexora.site`) and select the intended sending region/settings.
2. Copy the exact DNS records displayed by Resend into the registrar: its SPF-related sender/return-path record(s), DKIM record(s), and any verification records. Do not use values from examples or this repository.
3. Choose and publish a DMARC policy at `_dmarc.mednexora.site` (or the chosen sender-domain alignment required by the provider). Start with a monitoring policy only if the owner has a mailbox or reporting destination and can review reports; tighten policy only after confirming all legitimate senders are aligned. Do not add an invented `rua` mailbox or enforcement commitment.
4. Wait for DNS propagation, then use Resend's dashboard to verify the domain and SPF/DKIM status. Domain verification is not established by DNS records merely being entered.
5. A candidate sender is `no-reply@mail.mednexora.site`; use it only if the owner approves the address and Resend accepts the exact sender format. The backend's `PASSWORD_RESET_FROM_EMAIL` is shared by password-reset and registration verification email.
6. Keep `PASSWORD_RESET_EMAIL_ENABLED=false`, `REGISTRATION_EMAIL_VERIFICATION_ENABLED=false`, and `STAGING_RESTRICTED_REGISTRATION_ENABLED=false` until separately approved. Do not enter Resend credentials or send mail during this preparation.
7. After a separately approved controlled test, use a test mailbox to verify reset and registration OTP arrival, expiry, single use, cooldown, resend limits, provider-failure behavior, and that no OTP or secret appears in logs. Public registration must remain closed unless independently approved; paid-purchase gate remains closed.

Password-reset and registration-verification requests persist encrypted delivery jobs in MongoDB with majority acknowledgement before returning the generic `202` response. The outbox stores recipient and one-time message payloads as AES-256-GCM ciphertext; HKDF derives separate purpose-scoped encryption keys from the backend-only OTP peppers. OTPs and invitation tokens are not stored as plaintext in the outbox, and delivery challenges remain unusable until the provider accepts delivery and the activation state is confirmed.

Each API instance polls the shared outbox. Jobs are atomically claimed with a 60-second lease and a random fencing token; stale workers cannot update jobs after another worker takes over. Retries use bounded exponential backoff, stop after eight attempts or challenge expiry, and terminal jobs receive a delayed TTL-cleanup date. A process restart does not discard queued jobs: another worker can claim queued jobs immediately or reclaim a processing job after its lease expires. Do not delete pending/processing rows, rotate OTP peppers while matching jobs are queued, or manually activate a challenge. For recovery, inspect only outbox counts by status, attempts, expiry and oldest queued time; correct the provider/database issue and allow retries. The request response is generic and does not promise delivery. Delivery is at-least-once: if a provider accepts a message but its acknowledgement is lost, a retry may send the same OTP again. The existing challenge identity and activation checks ensure that a delayed job cannot activate a superseded, consumed or expired challenge. If no code arrives, request a new one after the backend cooldown; do not infer account existence from delivery.

Resend documents that the domain must be verified before sending and recommends sending from a subdomain; exact records are generated for each domain in its dashboard. See [Resend Verified Domains](https://resend.com/docs/dashboard/domains/introduction).

## 9. Razorpay live configuration later

Payment behavior was not changed or exercised as part of deployment preparation. The production environment validator refuses to start unless `RAZORPAY_MODE=live`, the live key ID, API secret and webhook secret are set. Keep API and webhook secrets only in backend runtime configuration. Do not use the test-mode values from `backend/.env.example` in production.

After the payment operator has activated the Razorpay account, configure the live credentials and the webhook URL at `https://mednexora.site/api/payments/webhook` using the production webhook secret. The current handler processes `payment.captured`, `payment.failed`, `refund.created`, `refund.processed` and `refund.failed`; subscribe to these events if refund reconciliation is required. Do not perform a real payment or refund as part of this guide; authorize any controlled live transaction separately.

## 10. Production smoke test

After deployment, perform these checks without exposing credentials:

1. Confirm the site and `/api/health` use HTTPS; health must return `200`.
2. Open the homepage and directly refresh public and protected SPA routes. Confirm each loads the application and does not return a host 404.
3. Verify `/api/*` requests reach Express and that an unexpected API failure returns a generic message, not a stack trace or database error.
4. Use an owner-approved test student/admin account to check sign-in, sign-out and role separation. Do not create accounts unless approved for the target database.
5. Verify that an unauthenticated request cannot download a private PDF and that a student without entitlement is denied. Use a staging/test resource and account for authorized download checks.
6. Confirm a draft resource remains hidden from the student catalogue and a published free resource works as intended.
7. Verify the mounted volume survives a host restart using a non-production test file. Do not restart a production service during active use merely to test storage.
8. Confirm the generated sitemap uses the actual domain and `robots.txt` references it.
9. Avoid real Razorpay payments/refunds unless the owner separately authorizes a controlled production verification.

## 11. Backups and rollback

- Enable managed MongoDB point-in-time recovery or scheduled snapshots. Also keep encrypted, access-controlled backups outside the database provider when required by the recovery plan.
- Back up the private PDF volume. Database records contain references to those files, so coordinate backup times and test restoring both into an isolated environment.
- Retain the prior frontend build artifact and backend release artifact. A code rollback should restore the previous application version without automatically reversing database/index changes.
- Before any migration, capture a database backup and record the current index catalog. If a migration has changed records or indexes, use a reviewed forward fix or restore plan; do not assume an old binary can safely reverse it.
- Document who can access backups and periodically test recovery. A backup that has not been restored in a test is not a verified recovery path.

### Manual backup/restore verification checklist

1. Before a planned release or data/index change, record the intended environment/database identity and obtain an owner-approved maintenance window. Do not copy a production URI into a shell transcript or report.
2. Create a managed snapshot/point-in-time restore point for MongoDB and a separate encrypted archive of the private-file volume. Restrict access to the operator who performs the restore.
3. Restore both backups into a separate isolated non-production database and storage volume. Never overwrite the source database or mount the production file volume into a test service.
4. Point an isolated test application only at the restored targets. Verify application startup/index checks, representative record counts and relationships, login with disposable test accounts, and retrieval of a private file using an authorized test entitlement.
5. Verify the restore is internally consistent: private-file references resolve, access checks still deny unauthenticated/unowned downloads, and payment/order records are read-only during this check. Do not send payment or email.
6. Record snapshot timestamps, restored target names, checks performed and operator. Keep the backup until the owner accepts the restore test. Do not treat snapshot creation alone as proof of recovery.

## 12. Current verification limits

Local verification for this release candidate: backend 228/228; isolated MongoDB integration 12/12; focused authentication/OTP/payment tests 137/137; frontend Node tests 31/31; Vitest 72/72; Vite production bundle build passed to a new temporary output directory so the existing `frontend/dist` was not overwritten; npm audit reported zero advisories in both dependency trees; `git diff --check` passed. The sitemap was intentionally omitted because the public domain has not been verified. These results do not verify a live domain, hosting proxy, MongoDB deployment, durable volume, live Razorpay account, or actual production transaction.

## 13. Refund accounting and product-level access revocation

Financial refunds remain order-level records in `PaymentRefund`; a refund amount is never divided across line items or bundle resources automatically. A processed partial monetary refund changes the verified refunded total and leaves paid access intact while the review state is `pending`. An administrator may explicitly keep access (`keep-access`) or revoke access for selected product IDs. A selected-product revocation is recorded in the separate `ProductAccessRevocation` collection before the denormalized `PurchasedAccess` row is changed. Its unique `order + product` index makes retries idempotent. The record captures the order, student, product, administrator, reason/source, time, and optional verified refund reference; it does not contain payment credentials or an inferred allocation.

The shared student access service checks the student's active entitlement, the exact linked verified order, product membership in that order's entitlement snapshot, full-refund state, and the durable product-revocation record. A stale active entitlement cannot restore access after a product revocation or full-order refund. If entitlement cleanup fails, access is denied immediately by the authoritative order/revocation record; retry the same admin review to repair the stale access row. Unselected products remain usable when their own order and entitlement checks pass. A full-order refund denies every paid product in the order. Free access records do not require a paid order.

Legacy partial-refund policy: `pending` means a verified partial monetary refund alone has not revoked access; `keep-access` records an explicit order-level keep decision; `product-specific` means per-product revocation records decide access; missing or unknown partial-review state fails closed. A legacy `revoke-access` order state remains an explicit order-wide denial and can be retried to finish cleanup. No backfill infers product allocation from old refund amounts.

The current Admin Orders screen does not select products. The protected `POST /api/admin/orders/:orderId/refund-review` API accepts `{ decision: "revoke-access", productIds: ["..."] }` for multi-product orders. Omitting `productIds` is accepted only when the order resolves to exactly one product, preserving the existing single-product screen. Multi-product revocation therefore requires a future product-selector UI; until then, administrators must not use an order-wide workaround. An optional `refundId` must be the exact provider refund ID for a processed, verified refund on the same order; it is recorded as context only and does not allocate money to that product.

The new model's indexes are initialized through the existing `Model.init()` startup path. There is no destructive migration or backfill. Deploying code that manages this collection will create it and its declared indexes if absent; review any startup index error before proceeding and do not drop indexes or edit records as an automatic workaround.
