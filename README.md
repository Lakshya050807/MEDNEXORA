# MEDNEXORA — Government Competitive Exam Preparation

Configurable study resources, courses and practice for Government Competitive Examinations. Exam settings and resource mappings are configurable; no syllabus, exam date or pattern is seeded as verified content.

## Project structure

- `frontend/` — React + Vite user interface
- `backend/` — Express API

The backend uses MongoDB for student accounts, exam configuration, subjects, topics, study resources, course metadata, question banks, mock tests, orders and purchased-access records. Authentication uses server-side sessions. Razorpay checkout and verified order access use the existing order and purchased-access records.

The API is intentionally same-origin in production: serve the frontend and route `/api/*` through the same HTTPS host to Express. It does not enable permissive cross-origin credentialed requests.

## Run the frontend

In one terminal:

```sh
cd frontend
npm install
npm run dev
```

Vite prints the local URL, usually `http://localhost:5173`.

Frontend API calls use relative `/api` paths. `frontend/.env.example` documents the optional `API_PROXY_TARGET` used by Vite in development; no API key or secret belongs in a `VITE_*` variable. In PowerShell, use `npm.cmd` if the machine's execution policy blocks `npm.ps1`.

## Run the backend

In another terminal:

```sh
cd backend
copy .env.example .env
npm install
```

Before starting, set `SESSION_SECRET` in `backend/.env` to a unique random value of at least 32 bytes. For example, run this from `backend/` and paste the output into the file:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Start MongoDB, then run the API in the backend terminal:

```sh
npm run dev
```

The API listens on `http://localhost:5000` by default. Vite proxies `/api` requests to it. Check its health with:

```sh
curl http://localhost:5000/api/health
```

On macOS/Linux, replace `copy .env.example .env` with `cp .env.example .env`.

## Environment, data setup and deployment

- Use Node.js 20.19 or newer. Install frontend and backend dependencies from their own folders. Build the frontend with `npm run build` in `frontend/`; run the API with `npm start` in `backend/`.
- Before deploying the checkout reservation index, stop the API and run a dry run from `backend/` with `npm run payments:reservations:backfill`. It checks legacy pending orders for overlapping student/resource reservations and reports whether any conflict needs reconciliation. If there are no conflicts, apply the non-destructive backfill with `npm run payments:reservations:backfill -- --apply`, then start the API. Startup refuses to serve checkout until active legacy orders have reservation snapshots. The migration updates only existing Order reservation metadata; it does not touch products, students, payments or entitlements.
- Configure `MONGODB_URI` with a dedicated database user, TLS, and a restricted network allowlist. Keep MongoDB credentials in the hosting provider's secret store. The API creates declared indexes at startup with each Mongoose model's `init()`; there is no general migration runner. Review existing data and take a backup before deploying schema/index changes. To set the B.Sc. Nursing entrance exam configuration as the primary target without adding syllabus, dates, questions or pattern claims, run `npm run exam:configure-primary` once from `backend/`. A new record stays in draft until an administrator publishes it.
- StudyMaterial full-text index migration: stop the API and any setup scripts, take a database backup, then from `backend/` run `npm run db:study-material-text-index` to inspect all collection indexes and summarize existing `language` and `textIndexLanguage` metadata. This command is inspection-only. Review the report, then run `npm run db:study-material-text-index -- --apply` to replace only the recognized StudyMaterial text index on `title`, `description` and `keywords`; it refuses unexpected index layouts or existing `textIndexLanguage` values. The migration changes no documents and does not drop other indexes or collections. Restart the API only after it succeeds, because startup initializes model indexes. The new index uses `default_language: 'none'` and `language_override: 'textIndexLanguage'`; `StudyMaterial.language` remains ordinary display metadata.
- To create the first flagship course structure, run `npm run course:setup-flagship` from `backend/`. This idempotent command creates a draft exam configuration, Physics, Chemistry and Biology subjects, and the draft “B.Sc. Nursing Entrance Preparation” course. It does not set a price, thumbnail, duration, lessons, official syllabus or publication status on existing records. Review the created draft from the admin workspace before adding verified content and publishing.
- Create a separate administrator from a trusted backend terminal with `npm run admin:create` (PowerShell: `npm.cmd run admin:create`). The command connects to the configured MongoDB database, creates a new account with the admin role, and prompts for full name, email, password and password confirmation. Password input is hidden; do not pass credentials as command-line arguments. It refuses duplicate emails and does not change student accounts. Sign in at `/admin/login`.
- The legacy `npm run admin:promote -- student@example.com` command remains available only when intentionally converting an existing student account. It is not needed to create a separate administrator.
- In production set `NODE_ENV=production`, a unique `SESSION_SECRET` of at least 32 bytes, an HTTPS `APP_ORIGIN` matching the browser origin, a MongoDB connection string, and `PORT` if required by the host. Production cookies are Secure, HttpOnly and SameSite=Lax. Keep `.env` files out of source control.
- Leave `TRUST_PROXY=0` unless Express is behind a reverse proxy. If it is, list only the proxy IPs/CIDRs (or a narrow built-in range such as `loopback`) as a comma-separated value, and configure that proxy to replace untrusted forwarded headers. `TRUST_PROXY=true` and wildcard trust are rejected. In-process API rate limits are per API process; production with multiple instances must enforce shared limits at the gateway/WAF.
- Deploy `frontend/dist` to a static host and route `/api` to the Node service over HTTPS. Configure the host's security headers for the static frontend too, including a restrictive CSP that allows only the checkout script/frame from Razorpay and frames from the configured video providers. The API sets `nosniff`, frame-denial and referrer-policy headers, and HSTS in production. `/api/health` is a readiness check and returns 503 when the MongoDB connection is not ready.
- Admins can upload PDFs with `POST /api/admin/uploads/pdf` from the admin product editor. Uploads require the `application/pdf` content type, a `%PDF-` file signature and are limited to 50 MB. Files are stored outside public static folders under `PRIVATE_STORAGE_DIR` (default: `backend/private-files/`). Use a persistent, access-controlled volume in production; it must not be exposed by the frontend host. The returned private reference is attached when the admin saves the product. Existing private file-service references under `/private/` on `PRIVATE_STORAGE_ORIGIN` remain supported.
- Course playback supports configured provider IDs for the providers accepted by the course schema (currently YouTube and Vimeo). The application stores provider IDs, not streaming credentials. Configure the relevant provider's privacy/embed settings. Private or signed playback is not implemented; paid playback remains unavailable unless a supported secured playback configuration is added.
- Payments stay disabled without credentials. Use Razorpay test-mode keys and a test webhook secret for checkout testing; never use live credentials for QA. Switch to live mode only after the deployment owner has separately configured and reviewed capture, webhook, HTTPS and reconciliation settings.

Deployment checklist: verify the frontend build; start the API against the target MongoDB and confirm `/api/health`; confirm an admin is provisioned; set and rotate environment secrets; configure HTTPS and same-origin `/api` proxying; verify the private file host and `/private/` path policy; configure course provider privacy; set Razorpay test credentials/webhook only when needed; configure edge rate limits for all API replicas; and run the backend test suite against the release commit.

## Student authentication

- `POST /api/auth/register` — create a student account
- `POST /api/auth/login` — start a student session
- `POST /api/auth/logout` — end the current session
- `GET /api/auth/me` — retrieve the current student's safe profile
- `GET /api/student/dashboard` — protected student dashboard data
- `POST /api/student/resources/:productId/access` — claim an eligible published free PDF or practice resource into this student's library without checkout
- `GET /api/student/resources/:productId/download` — download a resource after the student's free entitlement or verified paid purchase is checked

Sessions are stored in MongoDB and sent in an HttpOnly, SameSite=Lax cookie. Production deployments must use HTTPS, set `NODE_ENV=production`, configure `APP_ORIGIN` to the frontend origin, and set `TRUST_PROXY` only when the app is behind a correctly configured trusted proxy. Do not commit `.env` files.

## Government Competitive Exam catalogue API

Public catalogue reads expose published configured examinations and their published resources. Existing examination records remain in the database and are handled like any other configured exam:

- `GET /api/exams` — published examination configurations
- `GET /api/exams/:idOrSlug` — one published exam with its published subject, chapter and topic outline
- `GET /api/subjects?examId=<id>` — published subjects for an exam, or all published subjects
- `GET /api/chapters?subjectId=<id>` — published chapters for a published subject
- `GET /api/topics?subjectId=<id>` — published topics for a subject
- `GET /api/products` — published resources with `q`, `examId`, `subjectId`, `chapterId`, `topicId`, `resourceType`, `category`, `free`, price, sort and pagination filters
- `GET /api/products/:idOrSlug` — one published resource

Amounts are stored as integer paise. Public resources distinguish original practice papers from verified previous-year papers. A previous-year paper cannot be published without source, verification and legal-availability records. Public product responses omit private `contentUrl` values.

The admin workspace is at `/admin`, with the separate sign-in screen at `/admin/login`. Admin sessions are created only by `POST /api/admin/login` for an existing account whose database role is already `admin`; student registration still always creates a student role. There is no public admin registration. Create a separate administrator using the trusted `npm run admin:create` CLI from `backend/`, or use the legacy promotion command only when you explicitly intend to change an existing student's role.

Admin API routes are protected by a fresh database role check on each request:

- `GET /api/admin/me` and `GET /api/admin/overview` — admin profile and live database metrics
- `GET /api/admin/products`, `/exams`, `/subjects`, `/chapters`, `/topics`, `/courses`, `/question-banks`, `/mock-tests` — search/filter/sort and paginated management lists
- `GET /api/admin/orders` — paginated order records with student and purchase snapshots
- `POST` and `PATCH` routes under `/api/admin` for exams, subjects, chapters, topics, products, courses, question banks and mock tests; delete routes reject referenced or purchased study resources
- `POST /api/admin/uploads/pdf` — authenticated admin-only `application/pdf` upload (50 MB maximum); its reference remains private and can be attached to a product
- `POST /api/admin/login` — administrator-only session login

The dashboard's verified revenue sums only orders with status `paid` and a `paymentVerifiedAt` timestamp. Study materials reuse `StudyMaterial` and expose configurable category, detailed description, difficulty and language metadata; prices remain integer paise. Admin PDF references are write-only and omitted from public catalogue responses. Free PDF claims are tied to the authenticated student and cannot be used to access another account's library. Paid downloads require the corresponding active entitlement and a verified paid order.

The current secure preview is an administrator-authored text excerpt (`preview.title` and `preview.excerpt`); it is the only preview content returned before access. The existing PDF storage has no page extraction or page-limited streaming, so the full source PDF is never opened in a browser preview. To offer page images safely, add a separate admin-uploaded preview asset pipeline that accepts pre-rendered image pages, stores them privately, limits the configured page set server-side and serves only those images through a dedicated preview endpoint. Do not point a PDF viewer at the original paid file or rely on client-side page controls.

The exam config has an `isPrimary` flag protected by a unique partial index; only one exam can be primary. The `exam:configure-primary` command configures the general B.Sc. Nursing entrance target with no region restriction while preserving existing syllabus and other details. The flagship course setup creates a separate draft exam record. Administrators can publish or unpublish an examination directly. Subjects require a published examination; chapters, topics and study materials retain their existing examination/subject hierarchy checks. Legacy source metadata, if present on an examination record, is ignored and hidden; no records are rewritten. A course product cannot be published without published course metadata. Draft products may have an unset price; a price is required before publication. A published bundle must contain other published resources. Course modules may reference a chapter belonging to the module's selected subject, and chapter records in use cannot be deleted.

## Cart and Razorpay checkout

The frontend cart stores product IDs only. Checkout requires a student session and the backend rechecks that every product is published, recalculates listed price and discount from MongoDB, and creates the provider order with server-side credentials. Order statuses remain pending until a signed checkout response is checked against Razorpay's payment API or a signed webhook confirms capture. Failed or pending payments do not grant purchased access.

Configure `backend/.env` with Razorpay **test-mode** values before starting the backend:

```dotenv
RAZORPAY_MODE=test
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

The public key ID is returned only to the checkout page; key secret and webhook secret stay on the server. Keep all credentials out of source control. In the Razorpay Dashboard, configure automatic payment capture; this app does not capture authorized payments itself and will keep them pending until captured. Configure a webhook for `POST https://<your-api-host>/api/payments/webhook` and subscribe to `payment.captured`, `payment.failed`, `refund.created`, `refund.processed` and `refund.failed` if refund reconciliation is required. Use the same webhook secret in `RAZORPAY_WEBHOOK_SECRET`. For local webhook testing, expose the API through a secure development tunnel and configure its URL in Razorpay Test Mode. Test-mode key IDs start with `rzp_test_`; the backend rejects live key IDs outside production. Do not switch `RAZORPAY_MODE=live` outside `NODE_ENV=production`.

Student payment endpoints:

- `POST /api/payments/orders` — create or resume a pending checkout from product IDs and an idempotency key; the client cannot set prices.
- `POST /api/payments/orders/:orderId/verify` — verify the Razorpay checkout signature and fetch the payment state server-side.
- `POST /api/payments/orders/:orderId/reconcile` — check the provider state for a pending or failed checkout.
- `GET /api/payments/orders` and `GET /api/payments/orders/:orderId` — authenticated order history and receipt.
- `POST /api/payments/webhook` — webhook signature verification against the exact raw body, event deduplication and safe retry processing.

Checkout reservations are enforced by a unique MongoDB multikey index on `{ student, reservationProductIds }` for active Order reservations. Each bundle reserves its root resource and every nested resource. Repeating checkout from another tab or with a new idempotency key for the same cart reuses the existing provider order; overlapping carts are rejected. Failed payment attempts keep that same Razorpay Order reserved and retryable. Access is granted before the reservation changes to settled. A short setup reservation can expire only before Razorpay has issued an Order. Razorpay Orders do not support provider-side expiry/cancellation, so an issued provider order is never released based only on a local timer; this avoids a late capture racing with a new reservation. A same-cart retry resumes it. If an issued order must be abandoned permanently, support must first reconcile its provider state; no automatic cleanup can safely assert that it is no longer payable.

Razorpay payment IDs and signature inputs are verified using the order reference stored by the server; paid access is granted only for a captured payment whose amount and currency match the pending order. Webhook records store event identifiers and payload hashes, not card data. Free-only carts do not create a payment. In development, checkout remains unavailable until test credentials are configured. Production startup requires explicit live mode, live API credentials and the webhook secret.

## Backend tests

From `backend/`, run `npm test`. Auth, admin and catalogue API tests use an isolated in-memory session store and model fakes; schema validation tests do not require a running MongoDB instance.

