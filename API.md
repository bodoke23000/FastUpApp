# Fast Up API

All `/api/` responses use JSON except document and QR downloads. Static files and `/healthz`, `/readyz`, `/api/config` are public. The deployment must supply HTTPS for networked use.

## Authentication

`POST /api/login` with `{email,password}` sets an HttpOnly, SameSite=Strict session cookie and returns `{user,csrf}`. Send the cookie on subsequent requests. Every authenticated POST must also send `Content-Type: application/json` and `X-CSRF-Token` with the returned CSRF token. Browser origins are checked against `PUBLIC_ORIGIN`.

`GET /api/me` returns the current account profile and CSRF token. `POST /api/logout` invalidates the session. Account changes revoke existing sessions for that account. Sessions expire after twelve hours.

## Snapshot and actions

`GET /api/state?site=PLANT_ID` returns only the requested plant and fields permitted to the user's current role. Attachment metadata is included; file content is not included in the normal snapshot. Technicians can read plant maintenance history, with cost fields redacted, and can modify only assigned work. The main technician screen lists their own assignments. Operators receive their own fault reports.

`POST /api/actions` accepts:

```json
{
  "type": "intervention.add",
  "siteId": "plant-1",
  "operationId": "a-stable-unique-operation-id",
  "expectedVersion": 1,
  "occurredAt": "2026-10-30T12:00:00Z",
  "payload": {
    "orderId": "ot-248",
    "diagnosis": "Rodamiento desgastado",
    "activity": "Reemplazo y prueba",
    "startedAt": "2026-10-30T10:00:00Z",
    "endedAt": "2026-10-30T11:00:00Z",
    "hours": 1
  }
}
```

Use the actual server version of the subject record. Send ISO timestamps with timezone offsets or `Z`. The browser converts local date-time inputs before submission.

An identical retry with the same operation ID returns the original result with `replayed:true`. Reusing an ID for different content is rejected. A version conflict returns HTTP 409 and a current-record snapshot where appropriate. Failed authorized-plant submissions are retained as conflicts; they never bypass role checks.

The implementation reference for payload validation and transitions is `public/domain.js` (re-exported by `server/domain.js`). Supported action families:

| Family | Actions |
| --- | --- |
| Plant policy | `site.policy` |
| Assets | `asset.create`, `asset.update`, `asset.retire`, `reading.add`, `exposure.add` |
| Faults | `request.create`, `request.triage` |
| Orders | `order.create`, `order.assign`, `order.update`, `order.transition`, `order.clearance`, `order.test` |
| Execution | `intervention.add`, `intervention.correct`, `order.check`, `order.handover`, `handover.ack` |
| Materials | `part.create`, `stock.move`, `part.reserve`, `reservation.release`, `expense.add` |
| Procedures and PM | `template.create`, `plan.create`, `plan.update`, `plan.generate` |
| Downtime | `downtime.open`, `downtime.close` |
| Files | `document.add` |
| Resources | `resource.create`, `resource.update` |
| Imports | `import.preview`, `import.commit`, `import.reverse`, `history.preview`, `history.commit`, `history.reverse` |
| Exceptions | `notice.ack`, `conflict.resolve` |

Changes are atomic. Standard PostgreSQL serializes domain mutations with an advisory transaction lock. Database uniqueness constraints protect asset and part codes within a plant.

`POST /api/action-status` accepts `{actions:[...]}` (up to 200 exact wire actions) and returns `{accepted:[operationId],collisions:[operationId]}`. Receipts are scoped to the authenticated user and authorized plants. The offline journal uses this endpoint before replay, including recovery after a committed action whose response was lost. Receipt history is intentionally retained with backups.

Authenticated requests may send `X-Workspace-User`. If it differs from the session account ID, the server rejects the request with 401. The app uses this guard to prevent one tab synchronizing another account's unlocked local workspace after a cookie change.

## Other endpoints

| Endpoint | Access and purpose |
| --- | --- |
| `GET /api/reports?site=&from=&to=&assetId=&workType=&equipmentType=` | Supervisor/management/admin; period indicators and definitions |
| `GET /api/audit?site=` | Supervisor/management/admin; last 1000 append-only events |
| `POST /api/users` | Admin; create/update role, plants, availability, credentials, costing profile |
| `POST /api/sites` | Admin; create plant and grant the creating administrator access |
| `POST /api/import-file` | Admin; parse base64 XLSX into rows, followed by explicit staged import actions |
| `GET /api/document?site=&id=` | Download an authorized attachment |
| `GET /api/qr?site=&asset=` | Generate an authenticated asset QR label |
| `GET /api/export?site=` | Admin; plant records, file content, user profiles, and recent audit export |
| `GET /api/integrations?site=` | Admin; webhook configuration state and delivery results |
| `GET /api/health?site=` | Admin; database mode, uptime, record counts, pending events |

The plant export is a portability document, not a full recovery backup. Use the encrypted snapshot tool for complete audit/receipt/account recovery.

## External integration delivery

The webhook adapter posts signed events to a configured HTTPS endpoint. Verify HMAC-SHA256 over the exact body with `WEBHOOK_SECRET`; the signature is in `X-FastUp-Signature`. Deduplicate `X-FastUp-Event`/event IDs. Delivery is at least once, with persistent retries and a maximum one-day retry interval.

No vendor-specific ERP, corporate identity provider, sensor gateway, or predictive service is connected by default. Credentials and mapping must be configured in the deployment environment, never committed to source control.
