# Requirements coverage — Fast Up 1.1

This mapping uses the existing requirements document without amending it. Verification scope and outstanding acceptance work are in `VALIDATION.md`.

| Requirement | Implementation |
| --- | --- |
| RF01 — Asset record | Unique plant code, name, location/hierarchy, equipment type, brand/model/serial, criticality, status, usage meter and retirement history. |
| RF02 — Search | Asset code, name, location, type, brand and serial; order search/status filters; global search routes to matching assets or orders. |
| RF03 — Fault to order | Intake, review, reasoned rejection, creation/linking to existing work on the same asset; suggested priority and recorded overrides. |
| RF04 — Assignment | Available technicians, specialties, workload planning, multiple technicians/lead, reassignment, assigned-work enforcement. |
| RF05 — Intervention | Diagnosis, activity, cause/failure code, responsible person, dates, hours, time correction and historical costing. |
| RF06 — Parts | Stock, receipts, reservations, consumption, partial returns, adjustments, historical costs and transaction/version checks. Offline quantities are provisional. |
| RF07 — Attachments | Asset/order files up to 5 MB, protected download, offline capture and explicit encrypted preparation of existing files. |
| RF08 — History | Orders, interventions, documents, readings, independent planned/unplanned stops and verified return to service. |
| RF09 — Preventive work | Calendar/accumulated usage, fixed/floating intervals, suspension, controlled generation and alerts. |
| RF10 — Lifecycle | Registered, assigned, executing, waiting for parts, testing, closed/cancelled; prerequisites, clearance, failed tests and supervisor reopening. |
| RF11 — Reports | Period, asset, equipment-type and work-type filters; labor/material/other costs, failures, repair/restoration, downtime, qualified MTBF, CSV and print/PDF. |
| RF12 — Historical Excel | XLSX/CSV staging, row validation, historic dates/author/order reference, explicit skipping, duplicates, provenance and dependency-safe reversal. |
| Offline continuity | Encrypted workspace, durable-before-send journal, provisional views, drafts, attachment bytes, receipts, restart/reconnect recovery and conflict review. |
| Roles/audit/security | Role/plant authorization, scrypt, session cookies, CSRF/origin checks, workspace-account binding, immutable audit and backups. HTTPS is a deployment requirement. |
| Device support | Desktop/tablet layout, mobile navigation, touch forms and compact order cards. Real browser/device acceptance for this redesign remains outstanding. |
| Performance | Fifty concurrent seeded submissions tested for integrity. Production-size p95 search, fifty active users and technician interaction time require representative acceptance measurements. |

The reference-led UI adds Inicio, grouped Mantenimiento with Preventivo/Correctivo/Por condición, Inventario, Reportes, Usuarios y permisos, Configuración, search, notifications and persistent connection/sync status. Condition maintenance uses actual inspection procedures, limits, measurements and linked corrective work. External sensor feeds or predictive models are not represented as connected services.
