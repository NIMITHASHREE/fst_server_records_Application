# Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both repositories production-safe, verified, documented, pushed to `main`, and deployable to Vercel, Lightsail, and MongoDB Atlas.

**Architecture:** The Vite SPA reads one build-time API URL and deploys to Vercel. Express exposes a testable app, validates production configuration, connects to Atlas, runs under `systemd`, and is served through Caddy HTTPS on Lightsail.

**Tech Stack:** Node.js 22 LTS, Express 5, Mongoose 8, React 19, Vite 7, Node test runner, Vercel, Ubuntu Lightsail, Caddy, MongoDB Atlas M0.

## Global Constraints

- Work directly on `main` in both repositories as requested.
- Default to the $12 Lightsail plan; use $24 only when measured resource use warrants it.
- Do not commit credentials, tokens, connection strings, keys, or production `.env` files.
- Preserve the existing UI and public API shape unless fixing a security or correctness defect requires a change.
- Production browser traffic must use HTTPS end to end.

---

### Task 1: Testable Backend Bootstrap and Safe Configuration

**Files:**
- Create: `config/env.js`
- Create: `app.js`
- Create: `test/env.test.js`
- Create: `test/app.test.js`
- Modify: `server.js`
- Modify: `config/db.js`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `validateEnv(env)` returning normalized configuration or throwing a named configuration error.
- Produces: `createApp(config)` returning an Express application without opening a socket or database connection.
- Produces: `startServer()` that validates configuration, connects Atlas, listens, and shuts down cleanly.

- [ ] **Step 1: Write failing configuration tests**

Test that missing variables fail, a short/default secret fails, comma-separated origins normalize without trailing slashes, and valid configuration passes.

- [ ] **Step 2: Run the configuration test and verify RED**

Run: `node --test test/env.test.js`
Expected: failure because `config/env.js` does not exist.

- [ ] **Step 3: Implement `validateEnv` minimally**

Require `MONGO_URI`, `JWT_SECRET` of at least 32 characters, non-default `ADMIN_USERNAME`, non-default `ADMIN_PASSWORD` of at least 12 characters, and one or more valid HTTP(S) `CLIENT_ORIGINS`.

- [ ] **Step 4: Write and run failing app tests**

Test `GET /` health JSON, configured CORS acceptance/rejection, security headers, 404 JSON, and oversized JSON rejection.

- [ ] **Step 5: Extract `createApp` and production startup**

Add Helmet, an Express rate limiter, a 1 MiB JSON limit, strict CORS, centralized errors, signal handlers, and database connection before listening.

- [ ] **Step 6: Verify Task 1 GREEN**

Run: `npm test`
Expected: all Node tests pass with exit code 0.

### Task 2: Backend Security and Data Integrity

**Files:**
- Create: `middleware/validateObjectId.js`
- Create: `test/security.test.js`
- Modify: `routes/admin.js`
- Modify: `routes/students.js`
- Modify: `routes/attendance.js`
- Modify: `routes/classes.js`
- Modify: `models/Student.js`
- Modify: `models/AttendanceSession.js`

**Interfaces:**
- Produces: route parameter validation that returns 400 for malformed MongoDB identifiers.
- Produces: unique indexes for one roll number per class and one attendance session per class/date/type.
- Preserves: existing successful response bodies consumed by the React client.

- [ ] **Step 1: Add failing regression tests**

Cover insecure default admin credentials, malformed IDs, duplicate roll numbers, unvalidated component marks, cross-class absentee IDs, leaked Excel debug rows, and uploaded temporary-file cleanup on every exit path.

- [ ] **Step 2: Run security tests and verify RED**

Run: `node --test test/security.test.js`
Expected: assertions fail against current route behavior.

- [ ] **Step 3: Implement one security fix at a time**

Remove admin fallbacks and debug payloads; validate IDs, student fields, component ranges, periods, and referenced ownership; insert validated replacement rosters before removing old data or use a transaction when Atlas supports it; always clean temporary files in `finally`.

- [ ] **Step 4: Add database uniqueness constraints**

Use `{ classId: 1, rollNo: 1 }` unique for students and `{ classId: 1, date: 1, type: 1 }` unique for attendance sessions; translate duplicate-key errors into HTTP 409 responses.

- [ ] **Step 5: Verify Task 2 GREEN**

Run: `npm test`
Expected: all backend tests pass.

### Task 3: Production-Configured and Lint-Clean Client

**Files:**
- Create: `client/.env.example`
- Create: `client/vercel.json`
- Modify: `client/src/api/axios.js`
- Modify: `client/src/context/AdminAuthContext.jsx`
- Modify: `client/src/context/AuthContext.jsx`
- Modify: `client/src/context/useAdminAuth.js`
- Modify: `client/src/context/useAuth.js`
- Modify: lint-reported component and page files
- Modify: `client/README.md`

**Interfaces:**
- Produces: one Axios base URL from `import.meta.env.VITE_API_URL`, normalized without a trailing slash.
- Produces: `adminAPI` with the admin token and `API` with the faculty token.
- Produces: Vercel rewrite `{ "source": "/(.*)", "destination": "/index.html" }`.

- [ ] **Step 1: Capture current lint RED**

Run: `npm run lint`
Expected: the previously observed 14 errors and 1 warning.

- [ ] **Step 2: Replace hardcoded localhost URLs**

Read `VITE_API_URL`, fail clearly during production build when absent, and retain `http://localhost:5000/api` only in Vite development mode.

- [ ] **Step 3: Repair contexts and hook stability**

Keep context definitions in component-only files, expose hooks from the existing hook modules, initialize local-storage state lazily, and memoize the admin Axios instance so effects have stable dependencies.

- [ ] **Step 4: Repair remaining lint findings**

Remove unused catch bindings, unused values, and dead helpers while preserving displayed error messages and behavior.

- [ ] **Step 5: Add Vercel configuration and client documentation**

Document `VITE_API_URL=https://<static-ip-with-dashes>.sslip.io/api`, build command `npm run build`, and output directory `dist`.

- [ ] **Step 6: Verify client GREEN**

Run: `$env:VITE_API_URL='https://127-0-0-1.sslip.io/api'; npm run lint; npm run build`
Expected: lint and build both exit 0.

### Task 4: Reproducible Lightsail and Atlas Operations

**Files:**
- Create: `deploy/fst-api.service`
- Create: `deploy/Caddyfile.example`
- Create: `deploy/install-lightsail.sh`
- Create: `.env.example`
- Create: `README.md`

**Interfaces:**
- Produces: a `systemd` unit running `/usr/bin/node server.js` as an unprivileged service user from `/opt/fst-api`.
- Produces: Caddy reverse proxy from the free `sslip.io` HTTPS hostname to `127.0.0.1:5000`.
- Produces: exact Atlas, Lightsail, Vercel, backup, update, verification, and rollback instructions.

- [ ] **Step 1: Add deployment assets**

Pin Node 22 setup, install Caddy, create directories and service ownership, allow only SSH/HTTP/HTTPS at the Lightsail firewall, and keep port 5000 private.

- [ ] **Step 2: Add safe environment templates**

List variable names with non-secret examples and generation commands such as `openssl rand -hex 32`; never include a live credential.

- [ ] **Step 3: Document end-to-end deployment**

Include Atlas M0 creation, database user, Lightsail static IP allow-listing, `sslip.io` hostname derivation, service installation, Vercel import, smoke tests, snapshots, log viewing, updates, and rollback.

- [ ] **Step 4: Validate assets**

Run: `node --check server.js; node --check app.js; git grep -n -E '(mongodb\+srv://[^<]|BEGIN (RSA |OPENSSH )?PRIVATE KEY|JWT_SECRET=.{32})' -- . ':!package-lock.json'`
Expected: syntax checks exit 0 and secret scan prints no matches.

### Task 5: Final Verification, GitHub Push, and Deployment Attempt

**Files:**
- Modify: only files required by verification failures.

**Interfaces:**
- Consumes: verified backend and client commits on `main`.
- Produces: pushed GitHub branches and deployment URLs when authenticated accounts/resources are available.

- [ ] **Step 1: Run complete backend verification**

Run: `npm test; npm audit --omit=dev`
Expected: tests pass and audit has no high/critical production vulnerabilities.

- [ ] **Step 2: Run complete frontend verification**

Run: `$env:VITE_API_URL='https://127-0-0-1.sslip.io/api'; npm run lint; npm run build; npm audit --omit=dev`
Expected: lint/build pass and audit has no high/critical production vulnerabilities.

- [ ] **Step 3: Review repository state and commit separately**

Run in each repository: `git diff --check; git status --short; git diff --stat`
Expected: no whitespace errors, only intended files, and separate backend/client commits.

- [ ] **Step 4: Push both `main` branches**

Run in each repository: `git push origin main`
Expected: GitHub accepts both pushes, subject to account authorization and branch protection.

- [ ] **Step 5: Detect deployment credentials and deploy when available**

Check authenticated Vercel and AWS CLI state without printing secrets. If authenticated resources exist, create/configure them, deploy, and smoke-test HTTPS health, CORS, login rejection, and SPA deep links. If account creation, billing, MFA, CAPTCHA, email confirmation, or secret entry is required, stop at that exact boundary and give the user exact remaining commands/console fields.
