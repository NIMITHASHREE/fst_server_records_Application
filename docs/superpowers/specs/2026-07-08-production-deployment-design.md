# Production Deployment Design

## Goal

Prepare and deploy the FST records application with the React client on Vercel, the Express API on a $12/month AWS Lightsail Ubuntu instance, and MongoDB Atlas M0 as the database.

## Architecture

The client remains a standalone Vite SPA in `NIMITHASHREE/fst_client`. Vercel builds it with `npm run build`, serves `dist`, and injects `VITE_API_URL` at build time. A rewrite sends client-side routes to `index.html`.

The API remains a standalone Express application in `NIMITHASHREE/fst_server_records_Application`. On Lightsail, Node.js runs the API as an unprivileged `systemd` service bound to localhost. Caddy terminates HTTPS and proxies a free `sslip.io` hostname derived from the instance's static IP to Node. MongoDB data lives in an Atlas M0 cluster rather than on the instance.

## Application Hardening

- Fail startup when `MONGO_URI`, `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, or `CLIENT_ORIGINS` is missing or unsafe.
- Allow only configured Vercel/local development origins through CORS.
- Add security headers, request rate limits, JSON/body limits, consistent 404 and error responses, and graceful shutdown.
- Keep generated Excel files in memory. Keep temporary roster uploads only for parsing and always remove them.
- Preserve class PDFs on the Lightsail disk under a configurable upload directory. Document that the user must create snapshots/backups because instance-local uploads are not independently durable.
- Validate identifiers and payloads at route boundaries, prevent cross-class student/attendance references, and avoid destructive delete-then-insert updates where validation can fail.
- Remove production debug data and insecure credential fallbacks.

## Client Configuration

- Use one API client configured from `VITE_API_URL` for faculty and admin requests.
- Repair all current ESLint errors and unstable hook dependencies.
- Add a Vercel SPA rewrite and an environment example.
- Retain the existing UI and route structure; visual redesign is outside this deployment scope.

## Testing and Verification

- Add Node's built-in test runner for isolated configuration, validation, and application behavior tests.
- Test new backend behavior before implementing each change.
- Run backend tests, client lint, client build, production dependency audits, and secret scans before committing or pushing.
- Smoke-test deployed health and CORS behavior when AWS/Vercel credentials and resources are available.

## Operations

- Default to the $12 Lightsail plan. Recommend $24 only if measured memory pressure, sustained CPU load, or traffic requires it.
- Document Atlas creation, database user, network access, Lightsail static IP/firewall, Caddy hostname, service environment, Vercel project variables, deployment, backups, logs, updates, and rollback.
- Never commit credentials, tokens, connection strings, private keys, or generated production environment files.

## External Prerequisites

The user must own or authorize the AWS, MongoDB Atlas, Vercel, and GitHub accounts. Resource purchase, billing acceptance, MFA, CAPTCHA, email verification, and secret entry may require the user even when CLI deployment is otherwise automated.
