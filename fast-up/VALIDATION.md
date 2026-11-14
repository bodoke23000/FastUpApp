# Fast Up 1.1 validation record

Date: 13 November 2026.

## Results

- JavaScript syntax checks: passed.
- Automated suite after the downloaded-launch fixes: **72 passed, 0 failed, 1 skipped** (73 tests registered) on both Node 24.22.1 and Node 26.13.1 on Windows. The Node 26 HTTP run required execution outside the development sandbox because its local TCP connections were blocked inside it.
- Production dependency audit: **0 known vulnerabilities** reported by the official npm audit endpoint during this session.
- Local database: PGlite 0.3.14, an embedded PostgreSQL runtime.
- Running evaluation: `http://localhost:3030`; its config endpoint returned version `1.1.0`.
- The original requirements DOCX was not edited. SHA-256: `8C4215241D620ED369201A16CCE0F32D8D52542A80376C5AC9E8B9AD954B777F`.

## Automated admin walkthrough

Duplicate-launch regression: six startup tests verify a free port, current and older running releases, an unrelated program, simultaneous launch protection before database initialization, and releasing the address after initialization fails. The real launcher was also run against the already-running local 1.1.0 instance: it reported the existing app and exited with code 0 without starting a second copy. The full HTTP admin walkthrough now exercises the reserved-address startup path.

Downloaded-launch regressions execute the actual Windows batch launcher with temporary fixtures: a ZIP-preview-like folder containing only the launcher reports extraction instructions before attempting Node; an extracted path with spaces launches without an environment template; child failure exit codes survive the terminal pause. A separate real child-process test verifies the demo starts without `.env.example` and overrides inherited production database, origin, cookie and webhook settings. The PowerShell launcher was parsed successfully for syntax; its interactive execution was not tested.

`test/admin-walkthrough.test.js` exercises the real HTTP server, shared domain engine, encrypted device store and synchronization journal with disposable data. It is an integration walkthrough, not a browser simulation.

| Phase | Verified behavior |
| --- | --- |
| Online | Admin login and account binding; permitted snapshots, audit, reports, health and integration endpoints; essential shell files; asset registration including equipment type; order creation, assignment, clearance before execution, part registration and receipt. |
| Offline | Intervention, part consumption and evidence stay local; provisional stock/order views update; work and successful testing are required before closure. |
| Restart | Lock and reopen the AES-GCM workspace through a fresh storage module; queued changes, attachment bytes, prepared file and unfinished draft recover. IndexedDB is emulated by fake-indexeddb in this test. |
| Reconnect | Lose a response after server commit; reconcile receipts in the same session; finish exactly once; verify closure, one intervention, correct stock, downloadable evidence, report totals and audit. |

Additional journal tests cover dependent offline asset/order creation, stable IDs, storage failure before acknowledgement, optimistic versions, retained conflicts, blocked dependent work, cross-tab overwrite prevention and corrected creation IDs propagating to queued work.

The existing suite checks role/plant boundaries, CSRF/origin enforcement, SQL rollback, idempotency collisions, immutable audit, stock/returns/reservations, preventive rules, inspection limits/follow-up, clearance, closure/reopening, independent downtime, historical import/reversal, runtime metrics, costing, backup/restore and XLSX. Equipment-type report filtering is covered.

The fifty-submission integrity fixture retained all records and unique codes. Observed p95 completion: **368 ms** on the small seeded dataset. This does not certify production-size capacity or search latency.

## Verification still outstanding

**Browser walkthrough and visual checks are blocked.** The browser gate repeatedly rejected `http://localhost:3031` because a saved permission or managed policy denied access, including after the user approved access and reported changing the setting. No alternative or indirect browser access was attempted. The redesigned desktop/tablet/phone layouts, actual browser IndexedDB, service-worker installation, offline reload, file picker, print/download UI and keyboard interaction remain unverified in a real browser during this redesign.

The external PostgreSQL driver test is included and configured in GitHub CI, but was skipped locally because no test database URL was supplied and Docker's engine was unavailable. CI has not run on GitHub. Docker deployment was not exercised. No repository was created or pushed and no cloud deployment was performed.

Physical Android/iOS devices, long outages, browser eviction/storage limits, shared-device policies, assistive technology, production-size load, real webhook delivery, TLS hosting and plant procedures require target-environment acceptance. A finite passing suite cannot establish that the app will never fail.

## Operational boundaries

- Account/permission changes, new plants, import processing, plan generation and server diagnostics require connectivity. The UI disables them offline and explains why.
- Offline work and stock remain provisional until server confirmation. Conflicts remain visible and are not silently discarded.
- Existing attachments need explicit offline preparation. New attachment bytes stay in the encrypted queue until confirmed.
- Each device must first open the app online and prepare its encrypted workspace and shell. Background synchronization after closing is not promised.
- Local data, credentials and backups are excluded from the source ZIP. Back up operational data separately before moving/deploying the application.
