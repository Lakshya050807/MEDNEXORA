# MEDNEXORA Production Deployment Guide

This guide prepares the existing application for deployment. It does not mean the app has been deployed or that production infrastructure has been verified. No production domain, database or payment credentials are included here.

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
| `APP_ENV` | Set `staging` for staging or `production` for public production. If omitted with `NODE_ENV=production`, defaults to `production` for backwards-compatible strictness. Production-like runtime accepts only these two values | Backend runtime; not sensitive |
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
| `PUBLIC_SITE_URL` | Required for sitemap output; confirmed HTTPS site origin only, no path/query/credentials | Frontend build time; not sensitive; consumed by the Node build script, not exposed as a client `VITE_*` variable |
| `API_PROXY_TARGET` | Optional development-only Vite proxy origin; defaults to `http://127.0.0.1:5000` | Frontend development environment; not used by production runtime or bundle |

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
5. Configure HTTPS and security headers at the static host/CDN. The API sets `X-Content-Type-Options`, frame denial, `Referrer-Policy`, and production HSTS. The static host should set an appropriate CSP and the corresponding security headers; allow only the scripts, fonts, checkout and video providers the app actually uses.

The current API uses same-origin relative `/api` requests. Hosting the frontend and backend on unrelated origins without a same-origin proxy is not supported by the current configuration.

## 8. Domain and HTTPS later

After choosing a domain, configure its DNS records with the hosting provider and provision a valid TLS certificate. Then:

1. Set frontend `PUBLIC_SITE_URL` to the final HTTPS origin and rebuild.
2. Set backend `APP_ORIGIN` to the exact browser origin. Do not include `/api` or another path.
3. Confirm the proxy preserves the browser's HTTPS origin and trusts only known proxy addresses in `TRUST_PROXY`.
4. Confirm the certificate, redirects, cookies and `/api/health` over HTTPS before opening registration.

No domain has been selected or configured by this preparation.

## 9. Razorpay live configuration later

Payment behavior was not changed or exercised as part of deployment preparation. The production environment validator refuses to start unless `RAZORPAY_MODE=live`, the live key ID, API secret and webhook secret are set. Keep API and webhook secrets only in backend runtime configuration. Do not use the test-mode values from `backend/.env.example` in production.

After the payment operator has activated the Razorpay account, configure the live credentials and the webhook URL at `https://<confirmed-domain>/api/payments/webhook` using the production webhook secret. The current handler processes `payment.captured`, `payment.failed`, `refund.created`, `refund.processed` and `refund.failed`; subscribe to these events if refund reconciliation is required. Do not perform a real payment or refund as part of this guide; authorize any controlled live transaction separately.

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

## 12. Current verification limits

The backend and frontend automated suites and frontend production build have passed in the local workspace. That does not verify a live domain, hosting proxy, production MongoDB, durable volume, live Razorpay account, or actual production transaction. The production database indexes and migrations have not been inspected or changed here.
