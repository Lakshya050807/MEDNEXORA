# MEDNEXORA staging deployment runbook

This runbook covers the existing staging services only. It does not authorize a deployment, change hosting settings, or enable public registration or purchases. The current worktree is uncommitted; review and publish an approved release commit before asking either host to deploy it.

The repository currently pins staging to these assigned service origins:

- Frontend: `https://mednexora-shk6.vercel.app`
- Backend: `https://mednexora-staging-api-staging.up.railway.app`

These are repository configuration values, not a live verification that the domains are still assigned. Confirm both in their dashboards before deployment. A purchased custom domain is not required for this staging plan.

## 1. What is and is not enabled initially

Keep these settings closed for the first deployment:

```text
PUBLIC_BETA_REGISTRATION_ENABLED=false
PUBLIC_BETA_PAID_PURCHASES_ENABLED=false
STAGING_RESTRICTED_REGISTRATION_ENABLED=false
REGISTRATION_EMAIL_VERIFICATION_ENABLED=false
PASSWORD_RESET_EMAIL_ENABLED=false
```

This allows the backend and frontend to deploy without sending email. Existing student and admin accounts can still sign in. New account registration, forgot-password email delivery, admin-issued registration invitations, and new paid checkout stay unavailable. Existing free access flows remain governed by their existing backend authorization.

## 2. Staging environment variable checklist

Set backend values only in the **Railway staging API service Variables panel**. Do not paste backend variables into Vercel, source files, chat, or build logs. Do not bulk-import `backend/.env.example`: it includes local-development values and placeholders.

### Railway runtime, database, and sessions

| Variable | Staging value / rule | Secret? | Initial state |
|---|---|---:|---|
| `NODE_ENV` | Exactly `production`; enables secure-cookie, HTTPS, storage, and production error-handling checks | No | Required |
| `APP_ENV` | Exactly `staging`; keeps the Razorpay lane separate from production | No | Required |
| `PORT` | Let Railway inject its assigned port; do not hardcode a local port | No | Host-provided |
| `MONGODB_URI` | URI for the **staging-only** Atlas database and application user; never reuse production | Yes | Required |
| `SESSION_SECRET` | Unique random value, at least 32 bytes; generate/store privately and do not reuse production | Yes | Required |
| `SESSION_MAX_AGE_DAYS` | Optional integer 1–30; defaults to `7` | No | Optional |
| `APP_ORIGIN` | Exactly `https://mednexora-shk6.vercel.app` (origin only) | No | Required |
| `TRUST_PROXY` | `1` for Railway's single ingress proxy, only if that is the deployed topology and Railway replaces forwarded headers | No | Set after topology check |
| `PRIVATE_STORAGE_DIR` | Absolute path on a persistent Railway volume. Suggested setup: mount a Railway volume at `/data`, then use `/data/private-files` | No | Required |
| `PRIVATE_STORAGE_ORIGIN` | Optional HTTPS private-file service origin; leave unset when not using that service | No | Unset |

`TRUST_PROXY=1` means the app trusts one proxy hop. Confirm Railway terminates HTTPS and controls/replaces the forwarded protocol header before relying on Secure cookies. Do not use `true`, `*`, or broad proxy trust.

### Launch gates and policy approval flags

Set each value explicitly in Railway staging:

| Variable | Value | Secret? | Initial state |
|---|---|---:|---|
| `PUBLIC_BETA_REGISTRATION_ENABLED` | `false` | No | Required, closed |
| `PUBLIC_BETA_PAID_PURCHASES_ENABLED` | `false` | No | Required, closed |
| `PUBLIC_ABOUT_PAGE_APPROVED` | `false` | No | Keep closed |
| `PUBLIC_CONTACT_PAGE_APPROVED` | `false` | No | Keep closed |
| `PUBLIC_FAQ_PAGE_APPROVED` | `false` | No | Keep closed |
| `PUBLIC_PRIVACY_POLICY_APPROVED` | `false` | No | Keep closed |
| `PUBLIC_TERMS_PAGE_APPROVED` | `false` | No | Keep closed |
| `PUBLIC_REFUND_POLICY_APPROVED` | `false` | No | Keep closed |

Staging startup rejects either public gate being `true`; do not change that safeguard for this deployment.

### Password reset, registration OTP, invitations, and Resend

| Variable | Purpose / required format when enabled | Secret? | Initial state |
|---|---|---:|---|
| `PASSWORD_RESET_EMAIL_ENABLED` | Enables password-reset email OTP | No | `false` |
| `REGISTRATION_EMAIL_VERIFICATION_ENABLED` | Enables registration OTP verification; does not by itself open public registration | No | `false` |
| `STAGING_RESTRICTED_REGISTRATION_ENABLED` | Enables the admin-issued, invitation-only staging path; must remain independent of public registration | No | `false` |
| `STAGING_REGISTRATION_INVITATION_TTL_MINUTES` | Integer 5–1440; defaults to `120` | No | Optional/default |
| `RESEND_API_KEY` | Valid Resend API key beginning `re_`; required if either email feature is enabled | Yes | Unset |
| `PASSWORD_RESET_FROM_EMAIL` | Valid sender address from a Resend-verified domain; required if either email feature is enabled | No | Unset |
| `PASSWORD_RESET_OTP_PEPPER` | Unique random secret of at least 32 bytes; required only when password-reset email is enabled | Yes | Unset |
| `REGISTRATION_OTP_PEPPER` | Unique random secret of at least 32 bytes; required only when registration email verification is enabled; must differ from the reset pepper if both features are enabled | Yes | Unset |

The app shares the Resend API key and sender address between these email features. With both feature flags false, these credentials and peppers are not required and no email is sent.

### Razorpay test lane

| Variable | Purpose / rule | Secret? | Initial state |
|---|---|---:|---|
| `RAZORPAY_MODE` | Must be exactly `test` when `APP_ENV=staging` | No | Required |
| `RAZORPAY_KEY_ID` | If later configured, must be a test key with the `rzp_test_` prefix | Public identifier; keep backend-side | Unset |
| `RAZORPAY_KEY_SECRET` | Test API secret; never put in Vercel | Yes | Unset |
| `RAZORPAY_WEBHOOK_SECRET` | Test webhook signing secret; never put in Vercel | Yes | Unset |

With the paid-purchases gate closed and credentials absent, new checkout/payment operations remain unavailable. Do not add placeholder credentials or live keys. Do not configure a webhook until a test account and test webhook are intentionally set up.

### Vercel frontend variables

Set these only in the **staging Vercel project's Production environment** for the staging project's production branch:

| Variable | Exact staging value | Secret? |
|---|---|---:|
| `MEDNEXORA_DEPLOYMENT_TARGET` | `staging` | No |
| `MEDNEXORA_STAGING_API_ORIGIN` | `https://mednexora-staging-api-staging.up.railway.app` | No |
| `PUBLIC_SITE_URL` | `https://mednexora-shk6.vercel.app` | No |

Vercel supplies `VERCEL_ENV` and `VERCEL_PROJECT_PRODUCTION_URL` automatically. Do not create or override those system variables. The config requires the project production domain to equal `mednexora-shk6.vercel.app`; it fails closed if the deployment target or origins do not match. Do not create `VITE_*` variables for MongoDB, sessions, Resend, or Razorpay credentials. The frontend uses relative `/api` requests; `API_PROXY_TARGET` is for local Vite development only.

## 3. Check the staging MongoDB server version safely

Do not connect to production. Confirm you selected the Atlas cluster referenced privately by the **staging service's** `MONGODB_URI`, without copying the URI into a terminal, document, or chat. In MongoDB Atlas, open that cluster's overview/details and read its MongoDB server version. Record only the version number and confirm the staging service points to that cluster.

If the dashboard version is ambiguous, an owner can run the following read-only probe from the backend folder using the Railway CLI. It fetches the selected staging service variables into a one-off local Node process; `--no-local` prevents local `.env` overrides. The script imports only Mongoose, disables auto-indexing, runs `buildInfo`, prints only the version, and disconnects. Select the staging service and environment explicitly; never substitute production values.

```powershell
cd backend
railway run --no-local --service "<staging API service name>" --environment "<staging environment name>" -- node --input-type=module -e 'import mongoose from "mongoose"; try { await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false }); const info = await mongoose.connection.db.admin().command({ buildInfo: 1 }); console.log(info.version); } catch (error) { console.error("MongoDB version probe failed (" + (error?.name || "Error") + ")."); process.exitCode = 1; } finally { await mongoose.disconnect().catch(() => {}); }'
```

The command performs no insert, update, delete, or index operation. Railway's CLI can run a local command with selected service/environment variables; `--no-local` skips local overrides ([Railway CLI `run`](https://docs.railway.com/cli/run)). If using this probe, verify the CLI selection carefully and do not enable verbose output.

The invitation replacement uses MongoDB aggregation-pipeline update stages (`$set`, `$map`, `$cond`, `$mergeObjects`, `$concatArrays`, `$slice`, `$literal`, and `$$REMOVE`). MongoDB supports update pipelines starting in 4.2, but this project's Mongoose 9 compatibility table lists MongoDB server 6.x, 7.x, and 8.x. Confirm the actual staging server falls in the driver's supported range before deployment; do not infer the Railway/Atlas version from local tests. References: [MongoDB updates with aggregation pipelines](https://www.mongodb.com/docs/manual/tutorial/update-documents-with-aggregation-pipeline/) and [Mongoose MongoDB server compatibility](https://mongoosejs.com/docs/compatibility.html).

## 4. Review startup database effects before deployment

The backend connects to MongoDB before listening, then performs checks and initializes declared indexes with `Model.init()`.

- It checks the existing `isPrimary` exam index. If the expected partial unique index is absent, the helper can drop another index on `isPrimary` before Mongoose creates the expected one. Duplicate primary-exam data can prevent the replacement unique index from building.
- It stops startup if existing pending, failed, or paid orders lack `reservationProductIds`. Do not run the `--apply` backfill during deployment; review its dry-run output and obtain approval first if staging startup reports this condition.
- The registration challenge model creates a unique normalized-email index, a non-unique invitation ID index, and a TTL cleanup index. The shared rate-limit collection creates a unique `(scope, ipHash, windowStart)` index and TTL cleanup index. Index creation can fail if existing records conflict with a unique index.
- TTL deletion is asynchronous. Registration expiry is enforced by application queries and does not depend on immediate TTL cleanup.

Before a deployment that reuses staging data, have the owner perform read-only checks for duplicate emails/challenge rows, current index definitions, and legacy order reservation fields. Do not reset the database or run migration scripts as a deployment hook. The deployment process itself can create indexes and the primary-exam helper can replace an obsolete index; approve these startup effects in advance.

## 5. Railway setup

1. In Railway, select the existing MEDNEXORA **staging** project/environment and the API service whose assigned host is `mednexora-staging-api-staging.up.railway.app`.
2. Confirm its source is the MEDNEXORA GitHub repository, branch `staging-env-fix`, and Root Directory `backend`. The current local worktree has uncommitted changes, so it is not deployable from GitHub until the owner reviews and publishes an approved commit. Do not deploy the dirty worktree.
3. Attach a persistent Railway volume at `/data`; set `PRIVATE_STORAGE_DIR=/data/private-files` in the service Variables panel.
4. Set the Railway variables from the checklist above. Enter secret values directly in Railway; never put them in a shell command. Use a staging-only Atlas URI and a unique session secret. Keep all launch/email/payment controls in their closed initial state.
5. In service settings, configure Root Directory `backend`, Build Command `npm ci --omit=dev`, and Start Command `npm start`. Do not set the start/build command to `npm test` or `npm run test:registration-mongodb`.
6. Set the health check path to `/api/health`. Confirm the deployment is healthy and the endpoint returns HTTP 200 before testing student/admin workflows.

The backend requires Node `>=20.19.0`. `npm start` runs only `node src/server.js`; it does not run tests. `mongodb-memory-server` is a development dependency used only by the integration test file. `npm ci --omit=dev` excludes it and its MongoDB binary downloader from the runtime installation. The backend's normal `npm test` includes the real-Mongo integration test and should run in CI/development with dev dependencies, not as Railway startup.

## 6. Vercel setup

1. In Vercel, select the existing staging frontend project. Confirm the connected repository is MEDNEXORA, Root Directory is `frontend`, and the production branch is `staging-env-fix`.
2. Confirm the assigned project production domain is `mednexora-shk6.vercel.app`. A custom domain is not needed.
3. Set the three Vercel Production environment variables listed above. Do not set backend secrets in Vercel. Do not manually set Vercel's system variables.
4. Keep the Framework Preset as Vite. The active `frontend/vercel.mjs` sets install command `npm ci`, build command `npm run build`, and output `dist`. It routes `/api/:path*` to the staging Railway API before the React SPA fallback and disables rewrite caching. `frontend/vercel.static-reference.json` is an inert reference file, not the active Vercel config. Vercel supports programmatic `.mjs` configuration; only one recognized project configuration file should be active ([Vercel programmatic configuration](https://vercel.com/docs/project-configuration/vercel-ts)).
5. Deploy only after an approved commit is available on the configured branch. Verify the deployment log confirms `vercel.mjs` loaded, then check `/`, `/login`, a nested React route, and `/api/health` on the assigned staging domain.

Vercel's `VERCEL_ENV` and `VERCEL_PROJECT_PRODUCTION_URL` are system-provided values; the latter is the project's production domain without a scheme ([Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)). If the config rejects the project identity or target, stop and correct project/environment selection. Do not add a second rewrite or change the production target.

## 7. First-deployment smoke test (registration remains disabled)

1. Confirm Railway `/api/health` returns `200` and the browser's same-origin `/api/health` is served through Vercel's rewrite.
2. Load and refresh the homepage, `/login`, `/forgot-password`, a nested course route, and `/admin/login`.
3. Confirm student and admin sign-in with already-provisioned staging accounts, session persistence, profile access, logout, and role separation.
4. Confirm public registration and paid checkout report unavailable/closed. Do not create a student through the public registration page.
5. With an existing approved staging student account, check catalogue access, free enrollment/resource claiming, and private-file denial/authorization. Do not use real student records.
6. Confirm no email was sent and no test/live payment was initiated. Keep draft content and launch flags as they are.

With Resend disabled, the team can verify deployment, routes, existing login, admin access, catalogue reads, and free access for an existing staging test account. It cannot verify delivery, OTP receipt, new student registration, or password-reset email delivery.

## 8. Later controlled email test (separate approval)

Only after the owner authorizes a restricted staging test and a sender domain is verified with Resend:

1. Set `RESEND_API_KEY`, `PASSWORD_RESET_FROM_EMAIL`, and a unique `REGISTRATION_OTP_PEPPER` in the Railway staging Variables panel.
2. Set `REGISTRATION_EMAIL_VERIFICATION_ENABLED=true` and `STAGING_RESTRICTED_REGISTRATION_ENABLED=true`. Keep `PUBLIC_BETA_REGISTRATION_ENABLED=false` and `PUBLIC_BETA_PAID_PURCHASES_ENABLED=false`.
3. Confirm a staging administrator can issue an invitation only to the approved test address. Complete OTP verification and registration only for that test address; verify the challenge is single-use.
4. For a separate password-reset test, enable `PASSWORD_RESET_EMAIL_ENABLED=true` and add a different `PASSWORD_RESET_OTP_PEPPER`; use only an approved staging test account.
5. After testing, revoke unused invitations and set both email feature flags and the restricted invitation gate back to `false`. Remove or rotate test-only email credentials/peppers according to the owner's secret-management procedure. Do not broaden either public launch gate.

## 9. Release and rollback guardrails

- The current branch contains uncommitted and untracked changes. Review the complete diff before staging an approved, explicitly scoped commit; never deploy directly from this worktree.
- Keep `main`, production Railway, production Vercel, production MongoDB, and live Razorpay untouched.
- Do not run scripts named `admin:create`, `course:setup-flagship`, migration/backfill commands, or tests against a Railway-injected MongoDB URI.
- Preserve a previous staging deployment artifact for rollback. A code rollback does not reverse index changes or undo persistent volume contents.
- No deployment, remote database connection, email, payment, or hosting-variable update was performed while preparing this runbook.
