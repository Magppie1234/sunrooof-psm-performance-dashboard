# Blended agent-mode history extension

Approved by the user on 31 October 2026. The accompanying patch contains the complete backend change and its tests. It was applied to an isolated copy of the exact production source, not to the active dialer workspace.

Baseline: `dpl_DuxyaQ8rwYmQtxuN3vB5Z9EbkcHh` (328 source files verified against Vercel SHA-1 identifiers).

Released backend: `dpl_8RT12ED6s4cGN5U6QKoVnvntZVtW` at the existing Sunrooof dialer domain. Changes: new `cloud/agent_mode_history.py` and one route in `cloud/integration_routes.py`. Worker, token, rate-budget, queue and call-control source files remain byte-identical to the baseline. The normal worker deployment handover completed after two fresh workers were verified.

`GET /api/integration/agent-modes?date=YYYY-MM-DD` uses the existing report-client bearer secret. It requires the existing `cdr` scope, resolves the account from the authenticated identity, and returns only agentId, source timestamp, mode and action from stored events. It opens a read-only database transaction with an eight-second statement timeout. Dates are bounded to retained history, at most 20,000 events are returned, and oversized/unavailable results cannot become a partial complete report. Responses use `Cache-Control: no-store`.

No provider request, subscription change, environment change, migration, new secret or rate-limit change was introduced. Existing event gaps remain unknown. Do not infer historical mode from the current login snapshot.

Validation: 37 backend tests passed for the extension and existing shared-integration/report collection contracts. Staged health/database checks passed; unauthorized requests returned 401. The dashboard successfully consumed the endpoint with its existing report-client secret and classified all calls in the tested snapshot, including Pallavi and Mansi. After handover, two current workers were active and no new scheduler errors were reported.

Apply this patch only after reconciling it with the then-current backend source. Do not deploy an old backend baseline over newer dialer changes. This directory is excluded from dashboard deployment uploads.
