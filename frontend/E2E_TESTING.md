# Browser E2E tests

Run `npm.cmd run test:e2e` from `frontend` on Windows, or `npm run test:e2e` on macOS/Linux. The runner uses Playwright's project-local browser cache (`PLAYWRIGHT_BROWSERS_PATH=0`); install Chromium once with `npm.cmd exec playwright install chromium` while that variable is set to `0` (PowerShell: `$env:PLAYWRIGHT_BROWSERS_PATH='0'; npm.cmd exec playwright install chromium`).

The runner starts a temporary MongoDB instance bound to `127.0.0.1`, using only the `mednexora_e2e` database. It creates a disposable administrator fixture, starts the backend and Vite with a minimal test-only environment, runs Playwright, and stops all child processes and the database. The runner never reads `.env`, production variables, `MONGODB_URI` from the caller, or production credentials. It sets paid purchases off, Razorpay test mode without credentials, and registration on only for the disposable local app.

Browser-test content uses `E2E` labels and is created only in the disposable in-memory database. No fixture or account is written to a persistent database. If MongoDB Memory Server cannot download its local MongoDB binary, install/cache the binary before running the suite; do not substitute an Atlas URI.

The HTML report is written to `frontend/playwright-report/`. Failure screenshots, video, traces and attached browser diagnostics are written under `frontend/test-results/e2e/`. Open a retained trace with `npm exec playwright show-trace <trace.zip>`.
