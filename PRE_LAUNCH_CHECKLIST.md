# MEDNEXORA Pre-Launch Checklist

`[LOCAL]` means it can be checked in the development/staging workspace. `[PRODUCTION]` requires the actual hosting account or production infrastructure. `[OWNER]` requires owner confirmation. Do not mark a production check complete based only on a passing code test.

## Domain

- [ ] [OWNER] Select and confirm the public domain; no domain is configured by this project.
- [ ] [PRODUCTION] Point DNS to the chosen hosting provider.
- [ ] [PRODUCTION] Provision HTTPS and verify HTTP redirects to HTTPS.
- [ ] [PRODUCTION] Set frontend `PUBLIC_SITE_URL` and backend `APP_ORIGIN` to the exact confirmed origin.
- [ ] [PRODUCTION] Rebuild and verify canonical URLs, sitemap locations and `robots.txt` on the deployed domain.

## Hosting

- [ ] [PRODUCTION] Choose a Node.js host supporting Node 20.19+ for the backend and Node 20.19.x or 22.12+ for the frontend build, plus static hosting or an equivalent combined service.
- [ ] [PRODUCTION] Configure same-origin `/api/*` proxying to Express before SPA fallback.
- [ ] [PRODUCTION] Configure SPA fallback to `index.html` for direct route visits and refreshes.
- [ ] [PRODUCTION] Configure `PORT`, HTTPS termination and the exact trusted proxy settings.
- [ ] [PRODUCTION] Configure static-host CSP and other security headers.
- [ ] [LOCAL] Confirm package-lock files are present and release install uses `npm ci`.

## Database

- [ ] [PRODUCTION] Provision managed MongoDB with TLS, a dedicated least-privilege user and network allowlist.
- [ ] [PRODUCTION] Store `MONGODB_URI` in the host's backend secret store.
- [ ] [PRODUCTION] Back up the database and test restore to a separate database.
- [ ] [PRODUCTION] Inspect exam indexes and duplicate `isPrimary` records before first startup; startup can replace an obsolete index and initialize the declared unique partial index.
- [ ] [PRODUCTION] Run the reservation backfill dry run if migrating existing orders; review conflicts before any approved `--apply` run.
- [ ] [PRODUCTION] Run the StudyMaterial text-index inspection command; apply only the reviewed index migration if the live index is legacy.
- [ ] [PRODUCTION] Confirm startup index initialization completes without error.

## Backend

- [ ] [PRODUCTION] Set `NODE_ENV=production`.
- [ ] [PRODUCTION] Set a unique `SESSION_SECRET` with at least 32 bytes.
- [ ] [PRODUCTION] Set exact HTTPS `APP_ORIGIN`.
- [ ] [PRODUCTION] Set live Razorpay mode and the required backend-only credentials after the payment operator confirms readiness.
- [ ] [PRODUCTION] Set an explicit absolute `PRIVATE_STORAGE_DIR` and verify it is a mounted persistent volume outside frontend static files.
- [ ] [PRODUCTION] Start with `npm start` and verify `GET /api/health` returns `200`.
- [ ] [PRODUCTION] Confirm operational logs do not include passwords, cookies, credentials or private file contents.
- [ ] [OWNER] Provision an administrator through the trusted CLI only after confirming the target database; do not use public student registration.

## Frontend

- [x] [LOCAL] Previous release check: production frontend build passed; build omitted sitemap because the real `PUBLIC_SITE_URL` was not supplied.
- [ ] [PRODUCTION] Set `PUBLIC_SITE_URL` to the confirmed HTTPS origin and rebuild.
- [ ] [PRODUCTION] Deploy only `frontend/dist`.
- [ ] [PRODUCTION] Verify browser requests use same-origin `/api` and no localhost API address appears in the production bundle.
- [ ] [PRODUCTION] Refresh `/login`, `/study-material`, `/courses`, `/admin/login` and other direct routes.
- [ ] [PRODUCTION] Verify production titles, canonical URLs, Open Graph tags and robots output.

## Private file storage

- [ ] [PRODUCTION] Mount durable, access-controlled storage at `PRIVATE_STORAGE_DIR`.
- [ ] [PRODUCTION] Confirm uploaded PDFs are not served by the static frontend host or a public storage URL.
- [ ] [PRODUCTION] Confirm file permissions allow the backend to read/write and deny public access.
- [ ] [PRODUCTION] Back up private PDFs and coordinate file backups with MongoDB backups.
- [ ] [PRODUCTION] Test restoring files and database references together in an isolated environment.
- [ ] [PRODUCTION] For multiple backend instances, configure shared durable storage or the supported private-file service.

## Razorpay

- [ ] [OWNER] Complete Razorpay account activation and live-mode requirements separately.
- [ ] [PRODUCTION] Set `RAZORPAY_MODE=live` and live credentials in the backend secret store only.
- [ ] [PRODUCTION] Configure webhook URL and secret; confirm supported event names with the current handler.
- [ ] [PRODUCTION] Verify test credentials are not present in the production environment.
- [ ] [OWNER] Do not run a live payment or refund without explicit authorization and a documented reconciliation plan.

## Legal pages

- [ ] [OWNER] Confirm a monitored student-support contact channel.
- [ ] [OWNER] Replace Privacy Policy placeholders with actual collection, use, sharing, retention and request-handling details.
- [ ] [OWNER] Replace Terms placeholders with approved account, content, purchase and access terms.
- [ ] [OWNER] Set the actual Refund and Cancellation rules, exceptions and process; no timeframe or promise is currently supplied.
- [ ] [OWNER] Confirm public business identity/contact details only if they should be disclosed.
- [ ] [OWNER] Review legal pages before public launch. They are currently drafts and marked `noindex` by the client app.

## Security

- [x] [LOCAL] Production config rejects missing/test Razorpay mode, weak session secret, non-HTTPS origin and unsafe proxy syntax in automated tests.
- [x] [LOCAL] Private PDF authorization, ownership and unpublished-content protections have automated backend coverage.
- [ ] [PRODUCTION] Confirm `.env` files are not committed; Git history was not available in the current workspace for inspection.
- [ ] [PRODUCTION] Verify only trusted proxy networks are accepted and forwarded headers are overwritten at the edge.
- [ ] [PRODUCTION] Confirm static-host CSP, HSTS, no-sniff and frame restrictions are active.
- [ ] [PRODUCTION] Review host access logs, error reporting and rate limits across all API instances.

## Student registration and login

- [x] [LOCAL] Registration, login, logout, protected routes and session tests passed in the latest local suite.
- [ ] [PRODUCTION] Verify registration/login over HTTPS with an owner-approved test account.
- [ ] [PRODUCTION] Verify logout expires the session and protected pages/API data are not available afterward.

## Admin login

- [x] [LOCAL] Separate admin authentication and server-side role enforcement tests passed in the latest local suite.
- [ ] [PRODUCTION] Confirm an administrator is provisioned in the intended production database through the secure CLI.
- [ ] [PRODUCTION] Verify student credentials cannot access admin APIs and admin logout ends the admin session.

## Product purchase and download

- [x] [LOCAL] Purchase entitlement, private download, refund and webhook logic has automated coverage; this is not a live-payment verification.
- [ ] [PRODUCTION] Verify published resources, price display, free access and library visibility with approved test records.
- [ ] [PRODUCTION] Confirm unauthorized PDF downloads are denied and an entitled account can retrieve the file.
- [ ] [PRODUCTION] Confirm paid access is granted only after provider verification; do not use a real payment without owner approval.

## Mock test and result

- [x] [LOCAL] Scoring, negative marks, answer privacy, timer expiry, resume and saved-attempt tests passed in the latest local suite.
- [ ] [PRODUCTION] Verify a configured test can be started, resumed and reviewed with an approved test student.
- [ ] [PRODUCTION] Confirm answer keys are not visible before permitted result review.

## Mobile responsiveness

- [x] [LOCAL] Responsive styles cover mobile, tablet and desktop breakpoints; frontend tests/build passed.
- [ ] [PRODUCTION] Manually inspect 375px, 430px, 768px, 1366px and 1920px after deployment, including navigation, tables and forms.
- [ ] [PRODUCTION] Check browser console and network requests on the deployed site.

## Backup and recovery

- [ ] [PRODUCTION] Enable scheduled MongoDB backups or point-in-time recovery.
- [ ] [PRODUCTION] Enable encrypted private-file backups with restricted access.
- [ ] [PRODUCTION] Test full restore of MongoDB and private files in a non-production environment.
- [ ] [PRODUCTION] Keep prior frontend/backend release artifacts for code rollback.
- [ ] [PRODUCTION] Document who can trigger rollback and how to handle database/index changes made after the release.

## Local automated verification

- [x] [LOCAL] Backend suite: 126 tests passed in the latest recorded run.
- [x] [LOCAL] Frontend suite: 17 Node tests and 50 component tests passed in the latest recorded run.
- [x] [LOCAL] Production frontend build passed; configure `PUBLIC_SITE_URL` to generate the production sitemap.
