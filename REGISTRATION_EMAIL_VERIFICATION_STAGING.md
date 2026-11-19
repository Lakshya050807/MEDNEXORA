# MEDNEXORA Registration Email OTP — Restricted Staging Preparation

This note documents restricted, admin-invited registration testing on the isolated staging service. It does not change Railway settings, enable public registration, or send email by itself.

## Behavior

1. Restricted access is separately controlled by `STAGING_RESTRICTED_REGISTRATION_ENABLED`, which defaults to `false` and is accepted only with `APP_ENV=staging`.
2. An authenticated administrator issues an invitation for one normalized email. The random invitation token is returned once, while only its SHA-256 digest is stored. Its lifetime is configured in minutes and cannot exceed 24 hours.
3. The invited student enters the email and invitation token on `/register`, requests an OTP, receives the six-digit code through the existing Resend adapter, and verifies it. OTP and proof digests remain HMAC-protected.
4. Final registration requires both the valid invitation and the existing one-use OTP verification proof. The backend atomically consumes both on the challenge document before creating the student account.
5. Invitations are single-use, email-bound, revocable, and invalidated when a newer invitation is issued for the same address. Revoke/issue operations invalidate outstanding verification state.

`PUBLIC_BETA_REGISTRATION_ENABLED` and `PUBLIC_BETA_PAID_PURCHASES_ENABLED` must remain `false`. Restricted invitations do not alter `/api/launch/status`, which continues reporting public registration and paid purchases as disabled. If the restricted flag is off, its admin routes return not-found and registration remains closed. The feature is never valid outside staging. Login, password reset, admin sessions, free access, paid-purchase gates, payment verification and refund handling are separate.

## Railway staging variables

Apply configuration only to the staging Railway service MEDNEXORA-STAGING-API. Do not copy staging variables to production.

| Variable | Value | Secret? |
| --- | --- | --- |
| REGISTRATION_EMAIL_VERIFICATION_ENABLED | false until an owner explicitly authorizes a live staging email test | No |
| STAGING_RESTRICTED_REGISTRATION_ENABLED | false until an owner explicitly authorizes restricted staging testing | No |
| STAGING_REGISTRATION_INVITATION_TTL_MINUTES | 120 by default; integer from 5 through 1440 | No |
| REGISTRATION_OTP_PEPPER | A newly generated, unique random secret of at least 32 bytes; do not reuse PASSWORD_RESET_OTP_PEPPER | Yes |
| RESEND_API_KEY | Existing Resend API key, supplied directly in Railway | Yes |
| PASSWORD_RESET_FROM_EMAIL | A sender address at a domain verified and accepted by Resend | No, but keep it backend-only |
| PUBLIC_BETA_REGISTRATION_ENABLED | false | No |
| PUBLIC_BETA_PAID_PURCHASES_ENABLED | false | No |
| APP_ENV | staging | No |
| NODE_ENV | production | No |
| TRUST_PROXY | 1 for Railway's single trusted ingress proxy | No |

RESEND_API_KEY and PASSWORD_RESET_FROM_EMAIL are shared with the existing password-reset email provider. The registration pepper is purpose-specific and must be kept independent. Do not put any of these values in Vercel environment variables, VITE_* settings, source code, or this document. Do not send secrets in chat.

The sender's domain must be verified in Resend before an owner enables delivery. No domain, sender DNS records, or verified inbox is assumed here.

## MongoDB and deployment

- No destructive migration is required.
- On backend startup, Mongoose initializes the new RegistrationVerificationChallenge model before the server begins listening. It creates a unique normalized-email index and a TTL index on cleanupAt. Startup fails if index initialization fails.
- Existing user records are not rewritten. Historical users without emailVerified remain compatible; the schema treats them as verified. The registration controller explicitly sets emailVerified=true only after consuming the server proof.
- The existing Mongo-backed IP limiter is reused with separate registration scopes. It HMACs the IP selected by Express. TRUST_PROXY=1 is safe only when the service is behind exactly Railway's single ingress proxy; do not trust arbitrary forwarded headers or increase the hop count.
- No Vercel environment variable or frontend secret is needed. API calls use same-origin relative /api URLs.

The staging runtime still rejects `PUBLIC_BETA_REGISTRATION_ENABLED=true` and paid purchases. Restricted testing can be enabled only through its separate flag, only after the owner configures the registration email provider and secret, and only for invitations issued by an authenticated admin. The invitation code is not sent by email: share it with its exact invited recipient through a private channel. Email verification remains mandatory. Automated tests use a mock sender; live provider delivery has not been tested.

## Restricted staging invitation workflow

Only after reviewing this change and authorizing a staging email test, configure the staging Railway service `MEDNEXORA-STAGING-API` directly:

1. Keep `PUBLIC_BETA_REGISTRATION_ENABLED=false` and `PUBLIC_BETA_PAID_PURCHASES_ENABLED=false`.
2. Set `APP_ENV=staging` and `NODE_ENV=production` as already required by the deployment.
3. Set `STAGING_RESTRICTED_REGISTRATION_ENABLED=true` and `REGISTRATION_EMAIL_VERIFICATION_ENABLED=true`.
4. Set `STAGING_REGISTRATION_INVITATION_TTL_MINUTES` to an approved value from 5 to 1440 (default 120).
5. Configure `REGISTRATION_OTP_PEPPER`, `RESEND_API_KEY`, and `PASSWORD_RESET_FROM_EMAIL` directly in Railway. Use a unique registration pepper of at least 32 bytes, distinct from the password-reset pepper, and a verified sender domain. Do not place credentials in Vercel or the frontend.
6. Restart the staging backend. Startup rejects restricted mode outside staging or if email verification is not configured. No account is created by configuration alone.
7. Sign in to the existing Admin Dashboard and open **Settings → Student registration invitations**. Enter the exact test student's email and issue an invitation. Copy the returned one-time code immediately; the UI does not persist or redisplay it after leaving the page. Send it privately to that student.
8. The student opens `/register`, enters the same email and invitation code, requests the email OTP, enters that OTP, then completes the password form. The student is created only after both server-side checks pass.
9. The admin can see active, consumed, revoked, and expired invitation records in Settings. An unused active invite can be revoked there. Issuing a replacement revokes the previous active invitation and clears its outstanding OTP/proof.
10. Verify `/api/launch/status` still returns `registrationEnabled: false` and `paidPurchasesEnabled: false`. Do not use the public registration or paid-purchase gates for this test.

The invitation-management API is admin-only and is unavailable when restricted mode is disabled:

- `GET /api/admin/staging-registration-invitations`
- `POST /api/admin/staging-registration-invitations` with `{ "email": "..." }` (the one-time token is returned in this response only)
- `DELETE /api/admin/staging-registration-invitations/:invitationId` to revoke an unused invite

All responses are no-store. Write requests require the configured application Origin and share a Mongo-backed IP rate limit. Do not paste invitation tokens into public tickets, chat, URLs, logs, or screenshots.

## Disable restricted testing

To stop accepting restricted invitations, set `STAGING_RESTRICTED_REGISTRATION_ENABLED=false` in the staging Railway service and restart the backend. This is independent of the public registration gate, which must remain false. If email OTP is also to be disabled, turn off the restricted flag first, then set `REGISTRATION_EMAIL_VERIFICATION_ENABLED=false` and restart again. Existing student accounts and invitations are not automatically deleted; while the flag is off, invitation routes and registration remain unavailable. An unused invitation is invalidated when revoked or when it expires.

## Safe validation steps

### Local automated checks

Run from the project folders:

1. In backend, run npm.cmd test.
2. In frontend, run npm.cmd test.
3. In frontend, run npm.cmd run build.

Tests use mocked delivery and isolated model fixtures. They do not contact Resend, Razorpay, Railway, or production MongoDB.

### Before any live staging email test

1. Verify the sender domain in the Resend account and confirm PASSWORD_RESET_FROM_EMAIL is an accepted sender.
2. Create a distinct REGISTRATION_OTP_PEPPER locally with a cryptographic random generator; enter it directly in the staging Railway secret manager.
3. Add the Resend key and sender directly in Railway. Never copy secrets into Vercel.
4. Keep `PUBLIC_BETA_REGISTRATION_ENABLED=false` and `PUBLIC_BETA_PAID_PURCHASES_ENABLED=false`. The restricted path remains unavailable until its separate flag is explicitly enabled in staging.
5. Do not enable or test production registration without separate owner approval of the launch gate, policy approvals, verified sender setup, and a reviewed production change plan.

No hosting settings have been changed by this implementation. Do not enable the feature until the owner approves the staging-only test and confirms the sender/domain configuration.
