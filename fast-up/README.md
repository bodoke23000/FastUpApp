# Fast Up

JavaScript industrial maintenance application with a responsive Spanish interface, Node.js API, PostgreSQL persistence, encrypted device-local work, and executable acceptance tests.

This is a working first release for local evaluation and a plant pilot. It is not a claim of certified safety compliance, independently audited security, or completed deployment into a customer's production infrastructure.

## Run the local application

If downloaded as a ZIP from GitHub, right-click the ZIP and choose **Extract All** first. Open the extracted `FastUpApp-main` folder and run the launcher from there. It must be beside `package.json`, `scripts`, `server` and `public`. Opening a launcher inside Windows' ZIP preview extracts only that file to a temporary folder; the application cannot run from that preview.

Requires Node.js 24 or newer. From this directory:

```sh
npm ci
npm run demo
```

On Windows, double-click **`Start-FastUp.cmd`**. It finds Node.js (including the Codex-bundled runtime when present), installs missing dependencies from the official npm registry, and starts the local evaluation server. Node.js 24 is required. The optional `Start-FastUp.ps1` also launches an already installed evaluation instance. Open **http://localhost:3030**.

The demo supplies its own local settings and does not require `.env` or `.env.example`. The example file is an optional configuration template for other startup/deployment modes. If an older GitHub download reports `.env.example: not found`, replace `scripts/launch.js` with the current version or download the current complete source package.

Evaluation accounts share the password `FastUp-Demo-2026!`:

| Email | Role |
| --- | --- |
| supervisor@fastup.local | Supervisor |
| technician@fastup.local | Technician Carlos |
| tech2@fastup.local | Technician Ana |
| operator@fastup.local | Production operator |
| warehouse@fastup.local | Warehouse |
| manager@fastup.local | Maintenance management |
| admin@fastup.local | Administrator |

The first login asks you to create a **local encryption passphrase**. It encrypts this browser's cached records and pending changes. Keep it: the application cannot recover it. You can cancel to inspect the online interface, but recording changes requires an unlocked local copy. Production accounts are created separately; demonstration accounts are never enabled in production mode.

The demo uses **PGlite**, an embedded PostgreSQL engine, so it does not need Docker. Data persists in `data/`. Standard server PostgreSQL uses the same SQL migration and domain logic through the `pg` driver.

### If port 3030 is already in use

The launcher checks before installing dependencies or opening a database. If Fast Up is already running (including an older release), it prints `http://localhost:3030` and exits without starting another copy. Open that address and keep the original server terminal open.

To run a different extracted copy, stop the original Fast Up terminal with **Ctrl+C**, then launch the desired copy. If another program occupies the port, the launcher explains the conflict and leaves that program and its data alone. Startup reserves the address before database initialization, which also protects against two simultaneous launches.

## Use standard PostgreSQL

Copy `.env.example` to `.env`. Change:

```dotenv
DATABASE_MODE=postgres
DATABASE_URL=postgresql://fastup:YOUR_PASSWORD@localhost:5432/fastup
DEMO_MODE=false
BOOTSTRAP_EMAIL=admin@your-company.example
BOOTSTRAP_PASSWORD=at-least-14-unique-characters
PUBLIC_ORIGIN=http://localhost:3030
```

Then `npm start`. The initial administrator is created only when the account table is empty. No demo records are seeded. Remove the bootstrap password from the deployment environment after initialization.

Alternatively, use the supplied `compose.yaml` with `POSTGRES_PASSWORD`, `BOOTSTRAP_EMAIL`, and `BOOTSTRAP_PASSWORD` set in the environment, then `docker compose up --build -d`. PostgreSQL has a persistent named volume and is not exposed on a host port. The web application binds to host loopback by default.

For phone/tablet access beyond localhost, deploy behind **HTTPS**, set `PUBLIC_ORIGIN`, enable `COOKIE_SECURE=true`, and expose only the web reverse proxy to the intended network. Service workers and WebCrypto require a secure context; ordinary HTTP on a LAN address is insufficient. A responsive layout does not bypass that requirement.

No hosted PostgreSQL service or cloud account was provisioned. Docker access was unavailable during development; the `pg` connection mode and Compose deployment must be checked against the target PostgreSQL server before a production release.

## Implemented workflows

- Role-specific navigation and server-side permissions for administrator, supervisor, technician, operator, warehouse, and management. Users can belong to multiple plants. Administrators manage availability, skills, shifts, costing rates, and account activation.
- Asset hierarchy, unique codes, manufacturer/model/serial information, relocation, QR labels, meter readings, meter replacement accumulation, retirement, and preserved maintenance history.
- Short fault reports; accept into a new order, reject with a reason, or link multiple reports to one existing open order on the same asset.
- Direct, corrective, preventive, inspection, and improvement work; planning dates, due dates, priority, estimated hours, assignment, reassignment, and version-controlled edits.
- State transitions, waiting-for-parts reasons, clearance references, successful/failed tests, cancellation, supervisor reopening, closure validation, and historical audit.
- Per-technician intervention logs with diagnosis, work, cause, failure code, occurrence timestamps, actual hours, and historical costing rates. Overlapping entries for the same technician are rejected.
- Versioned task snapshots, checklists, numeric measurement limits, pass/fail/not-applicable checks, and linked corrective follow-up orders for failed inspections.
- Shift handover with equipment condition, unfinished work, precautions, next technician, and acknowledgement.
- Parts catalog, warehouse locations, receipts, stock corrections, reservations, releases, issues, partial returns, and historical cost reconciliation against original issues. Negative stock and conflicting stock updates are rejected.
- Preventive plans based on time and/or cumulative usage, fixed or floating intervals, configurable generation horizon, suspension, manual generation, and optional automated generation.
- Planned/unplanned downtime recorded independently of work orders, with explicit return-to-service verification and overlap prevention.
- Reporting by period: backlog, overdue work, labor, historical known costs, preventive completion, asset downtime, failures, MTBF when runtime coverage is complete, and mean restoration duration. CSV export and print-to-PDF are available. Full plant export includes attachment content.
- Photo/document attachments up to 5 MB, attached to the order; file permissions follow record access.
- XLSX/CSV staging for assets, parts, and historical interventions, per-row validation, explicit skipping of invalid rows, duplicate protection, batch provenance, and reversal while dependency checks permit it.
- Persistent in-app alerts, acknowledgement, overdue/fault-review escalation, and resource-expiry notices. The server evaluates automation every minute while running.
- Tool custodianship, contractor records, calibration follow-up, and warranty follow-up through the resources register.
- Encrypted offline snapshots and outbox, restart recovery, manual/reconnect synchronization, idempotency receipts, optimistic version checks, preserved rejected operations, and human conflict resolution. Encrypted pending-work export/recovery is available.
- Append-only database audit events, session authentication, salted scrypt password hashes, CSRF/origin checks, parameterized SQL, role-filtered responses, health endpoints, encrypted backups, and restore tooling.
- Outbound signed webhooks with durable event IDs, retry backoff, and visible delivery status for ERP/BI integration work.

## Operating rules

Suggested priority combines production impact, urgency, and asset criticality. Safety impact, stopped production, or immediate urgency suggests high priority; a critical asset alone does not automatically make every issue urgent. A manual override requires a recorded reason. Plant personnel must validate this initial matrix against their operating policy.

Work follows `Registrada → Asignada → En proceso → En prueba → Finalizada`. Execution can move to/from `En espera de repuesto`. Failed testing returns to execution. Supervisors can cancel and reopen with a reason. Assigned technicians can work on their own orders. A required clearance blocks starting work until a supervisor records its reference and conditions.

Closing requires a complete intervention, resolved required task results, and successful testing. It releases unused reservations. Closing a work order **does not** return an asset to service; downtime must be closed separately.

Preventive plans keep at most one open order per plan. Fixed plans advance the original milestone and consolidate overdue intervals into an overdue order, avoiding a flood of missed occurrences. Floating plans advance from completion; an authorized cancellation is treated as a documented skipped service and advances from cancellation/current meter. These are explicit first-release policies; a plant needing several concurrent occurrences or a different skipped-service rule should change these policies before rollout.

Report date inputs select UTC days; displayed timestamps use the plant's configured timezone. End boundaries are exclusive. Labor hours aggregate individual people. Downtime aggregates asset events. Mean restoration includes waiting time and uses unplanned events restored during the selected period. MTBF requires verified runtime records covering the entire period and at least one failure. Missing historic labor rates remain unknown rather than using today's rate. Currency totals remain separate.

## Offline operation and recovery (1.1)

1. Log in online on the device and prepare/unlock its encrypted copy.
2. Open the records needed for field work. The application caches the permitted structured snapshot and the application shell.
3. Every domain change is encrypted in IndexedDB before transmission or acknowledgement. The local view updates immediately and shows a pending indicator until server confirmation. Unsaved non-password form drafts are also encrypted as you type.
4. Reconnect and select **Sincronizar ahora**, or keep the application open for automatic reconnect synchronization.
5. A server rejection remains visible locally and is retained as a server conflict when the user's plant access permits it. Review current data, then resend or record an explicit resolution. Later changes on the same subject remain blocked until the conflict is reviewed.

The application does not rely on background browser synchronization while closed. Device storage can be erased by the user or lost with the device; prepare copies before disconnection and synchronize promptly. Offline data for each user is protected by a separate passphrase. Account revocation is enforced by the server when reconnecting; instantaneous remote revocation of an already unlocked disconnected device requires device-management controls outside this application.

Offline domain work includes assets, fault reports, orders, assignment, interventions, checklists, parts catalogs and movements, reservations, procedures, plans, resources, readings and site policy. New records retain stable IDs through restart and synchronization, so dependent work can reference them. Reports can be calculated from the local copy and are labeled provisional. Account/permission changes, plant creation, import processing, automatic plan generation and server health checks require a connection. Existing documents can be explicitly saved for offline use; newly attached files are preserved with the queue. Files are not all downloaded automatically.

Warehouse issues and returns may also be recorded provisionally offline. Cached quantities are not a stock guarantee. The server reconciles version and availability when synchronizing; competing issues of a scarce part produce a visible retained conflict. Receipts and stock adjustments are provisional until the server validates and confirms them. Physical discrepancies must be resolved by warehouse personnel.

## Backups and restore

Set `BACKUP_PASSPHRASE` to a strong unique passphrase of at least 14 characters, then:

```sh
npm run backup
```

The encrypted, authenticated logical snapshot includes accounts, records, embedded attachments, audit events, synchronization receipts, and integration events. Keep the passphrase separately from the backup. Sessions are deliberately excluded.

Restore into a **fresh empty database**:

```sh
npm run restore -- /absolute/path/to/backup.json.enc
```

The script refuses to overwrite an existing populated database. For standard PostgreSQL operations, also establish native physical/logical backup, retention, off-host copies, monitoring, and a tested recovery procedure. RPO depends on backup frequency; RTO depends on dataset, infrastructure, and restore validation. The project supplies the tools and a restore test, not an already operating backup service.

After recovery, authenticate devices again, reconcile the backup cutoff with surviving records, and synchronize pending outboxes. Restored operation receipts prevent replay of operations included in the backup. Transactions that postdate the recovered backup require reconciliation against other surviving records.

## Integrations

Optional environment settings:

```dotenv
WEBHOOK_URL=https://your-controlled-endpoint.example/fast-up
WEBHOOK_SECRET=at-least-24-random-characters
```

Every delivery has an event ID and `X-FastUp-Event` header. Verify `X-FastUp-Signature` as an HMAC-SHA256 of the exact request body. Receivers must deduplicate by event ID. Failed events remain in the outbox with exponential retry backoff. Attachment bytes and passwords are not included in event payloads.

External ERP, BI, email/push delivery, SSO/MFA, sensor gateways, predictive models, digital twins, and scheduling optimization require their actual providers, configuration, credentials, and further integration work. They are not represented as functioning external services in this release. This application provides API access, event delivery, source records, and relevant resource registers; it does not simulate those services or claim full Maximo/SAP feature parity.

## Verification

```sh
npm run refresh-shell
npm run check
npm test
```

The scenario suite covers the previously discussed acceptance cases, PostgreSQL transaction rollback, concurrent stock edits, idempotency, permissions, append-only audit, XLSX parsing, encrypted device persistence, and backup restore. A 50-submission seeded-data concurrency test checks integrity and reports observed latency. It is not a production-size capacity certification or a guarantee across untested networks/devices.

The 1.1 redesign includes phone, tablet and desktop CSS layouts. Browser inspection of this redesign was blocked by the saved browser permission policy in the development session, including after the user approved access; these layouts and service-worker installation remain visually unverified. See `VALIDATION.md` for the exact scope tested. Physical iOS/Android installation, long outages, shared-device policies, production PostgreSQL deployment, accessibility assistive technology, and plant-specific safety procedures need validation in the target environment.

## Implementation notes

The frontend uses JavaScript modules, semantic HTML, CSS, native dialogs, IndexedDB, WebCrypto, and a service worker. No frontend build service is required. The Node HTTP API and offline journal call the same domain layer in `public/domain.js`; the server remains authoritative.  PostgreSQL uses parameterized queries and schema migrations.

Records use a typed JSONB repository with unique asset/part indexes, transactional domain validation, version checks, and an append-only audit table. Mutations currently acquire a global PostgreSQL advisory transaction lock. This favors correctness for a first plant pilot and makes concurrency deterministic, but serializes writes across plants. Large inventories, many sites, or sustained high write rates require repository partitioning, targeted queries, and per-record locking with a production-size load test. Backup and export tools should be evaluated against the expected attachment volume.

Production rollout also requires your hosting configuration, TLS, log retention, backup scheduling/monitoring, device policy, notification ownership, and acceptance by plant users. The provided resource register tracks calibration and warranty follow-up; it does not constitute a full calibration laboratory, contract-management platform, or warranty-claims service.

## GitHub

See [GITHUB.md](GITHUB.md) for source-upload commands and the included CI workflow. Local data and secrets are excluded from the release package.
