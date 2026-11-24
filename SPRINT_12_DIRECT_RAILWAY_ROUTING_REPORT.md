# MEDNEXORA — Sprint 12 Direct Railway Routing Report

## Summary

The staging Vercel API-origin validator now accepts only the direct staging Railway public origin:

`https://mednexora-staging-api-staging.up.railway.app`

The former Cloudflare Tunnel hostname `https://staging-api.mednexora.site` is rejected. There is no tunnel fallback. Production remains pinned to `https://mednexora-production-f06e.up.railway.app`; a production config build also fails closed if the staging-only `MEDNEXORA_STAGING_API_ORIGIN` variable is present.

This is source and local-test verification only. No Vercel, Railway, Cloudflare, DNS, database, production system, or hosted endpoint was accessed. The direct Railway origin's current health and the active Vercel variable remain unverified.

## Implementation

- `frontend/vercel-config.mjs` now compares the normalized staging origin directly against the one approved Railway origin. The tunnel-origin export and acceptance path are gone.
- The `/api/:path*` rewrite remains before the SPA fallback. Existing API rewrite cache disabling, security headers, and staging `noindex` behavior are preserved by this routing change.
- Production API routing continues to use its fixed production constant. A staging-origin variable supplied to a production build is rejected instead of ignored.
- `frontend/test/vercel-config.test.js` verifies direct staging acceptance, Tunnel and production origin rejection for staging, the production-pinned destination, and rejection of a staging-only origin variable in production.
- Current staging deployment instructions now describe direct Railway routing. Cloudflare Tunnel setup documents are marked historical/future-only. Historical Sprint 10/11 reports were retained as snapshots; this report supersedes their former source-allowlist findings.

## Vercel environment-scope note

The source validates `VERCEL_ENV`, `MEDNEXORA_DEPLOYMENT_TARGET`, project identity, site identity, and the origin. It does not require staging to use Vercel Preview rather than the staging project's Production environment. The local test fixture itself uses `VERCEL_ENV=production` with `MEDNEXORA_DEPLOYMENT_TARGET=staging` for the separate staging Vercel project. Earlier repository documents differed on Preview versus Production scope. This change does not select or change a Vercel scope. The owner must inspect which existing scope is consumed by the active staging deployment and keep the variables there; do not move them as part of this routing change.

## Files changed for Sprint 12

Routing source and tests:

- `frontend/vercel-config.mjs`
- `frontend/test/vercel-config.test.js`

Current deployment and owner instructions aligned with direct Railway routing:

- `MEDNEXORA_STAGING_DEPLOYMENT_RUNBOOK.md`
- `STAGING_CONFIGURATION_MATRIX.md`
- `STAGING_SMOKE_TEST_RUNBOOK.md`
- `SPRINT_4_BLOCKERS.md`
- `SPRINT_4_DEPLOYMENT_PLAN.md`
- `SPRINT_4_SECURITY_REVIEW.md`
- `SPRINT_4_STAGING_INTEGRATION_REPORT.md`
- `SPRINT_5_OWNER_VERIFICATION_GUIDE.md`
- `SPRINT_5_READINESS_SUMMARY.md`
- `CLOUDFLARE_STAGING_TUNNEL_RUNBOOK.md`
- `CLOUDFLARE_STAGING_INGRESS_ASSESSMENT.md`
- `SPRINT_12_DIRECT_RAILWAY_ROUTING_REPORT.md` (this report)

These files already had local worktree modifications before Sprint 12. Their complete diffs include earlier user work; the list above identifies files touched for this Sprint 12 change and does not imply that every line in each file was newly authored here. No unrelated implementation files were intentionally changed for this routing update.

## Verification

Command run from `frontend`:

```powershell
node --test test/vercel-config.test.js
```

Result: **12 passed, 0 failed**. Coverage includes the exact direct Railway destination, rejection of the former Tunnel origin, rejection of production/staging cross-routing, required target/project/site identity, API rewrite ordering, cache disabling, and production routing pinning.

`git diff --check`: **passed**. Git emitted non-fatal line-ending normalization warnings for existing modified files; there were no whitespace errors.

The full frontend suite and production build were not run for this focused config change. No Playwright or hosted deployment test was run.

## Remaining owner verification

Before relying on the route, inspect the existing staging Vercel project without changing its environment scope. Confirm the active staging deployment's effective `MEDNEXORA_DEPLOYMENT_TARGET=staging`, `MEDNEXORA_STAGING_API_ORIGIN=https://mednexora-staging-api-staging.up.railway.app`, `PUBLIC_SITE_URL=https://mednexora-shk6.vercel.app`, project identity, branch, and commit. Then perform an owner-approved read-only `GET /api/health` through the staging Vercel domain and correlate it with staging Railway logs. The result must identify the staging service. Do not infer hosted health from these local tests.

Do not disable the Railway public API domain as part of this change: the current rewrite targets that public host. Keep all registration, paid-purchase, restricted-registration, and email gates closed, and keep Razorpay in test mode. This task made no environment-variable or launch-gate changes.

## Git and release state

Before this report was added, the repository was on branch `staging-env-fix` at HEAD `0149e89698d4f348fd916d8e0b127df2549ab7fe`, with 63 modified tracked files, 45 untracked entries, and no staged changes. The report adds one untracked file. No stage, commit, push, deployment, external configuration change, or production access occurred.

**Verdict:** Local source routing and regression tests are ready for owner review. Hosted staging routing is **not verified**; do not claim the API connection is healthy until the owner completes the read-only check above.
