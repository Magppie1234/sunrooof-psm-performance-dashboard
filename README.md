# Agent Productivity Dashboard

Source for the existing [Agent Productivity Dashboard](https://agent-productivity-dashboard.vercel.app/). This repository root is the Vercel project `agent-productivity-dashboard`.

## Configuration

Copy `.env.example` to ignored `.env.local` for local development, or configure these server-side variables in Vercel:

- `PSM_INTEGRATION_URL`: HTTPS base URL of the existing shared Ozonetel backend.
- `PSM_INTEGRATION_KEY`: the report-client secret issued by that backend.
- `OZONETEL_USERNAME`: the CloudAgent account username matching the client's account.

Optional: `OZONETEL_AGENT_IDS` and `OZONETEL_MODE_TYPES` filter supported reports; `DASHBOARD_PASSWORD` enables the existing password gate. Never commit actual secrets. This dashboard does not need an Ozonetel API key or token; those remain in the separate backend.

## Shared backend and data freshness

All provider reads use `lib/integration-client.cjs` and the shared backend's `/api/integration/query`. This preserves centralized credentials, cached snapshots, queueing and rate limits across the dialer and other reports. Do not restore independent provider requests or change the shared backend as part of a dashboard release.

Logged-in agents come from the complete `getAgentLogins` snapshot, including agents with no calls. Incomplete, failed or more-than-two-minute-old login snapshots retain last-known states but do not provide a current logged-in count. The report normally receives call snapshots around every five minutes; refreshes may be deferred for provider budgets or higher-priority work. Browser polling does not guarantee fresh provider data.

The live table also shows Blended calls, connected calls and talk time. Each counted call is matched by agent ID and start timestamp to that agent's recorded mode at or before the call start. Later mode changes do not rewrite earlier calls. This is a subset across the existing call types; Today So Far counts calls once. Missing mode coverage displays an em dash instead of a false zero. The existing report-client secret reads the backend's `/api/integration/agent-modes` endpoint, which reads stored events and makes no provider requests. See `backend-extension/README.md` and its patch for the approved backend addition and deployment baseline.

“Showing last good data” means a saved snapshot is being shown while collection is delayed or queued. It must not be presented as current live data. The integration health endpoint checks connectivity/account alignment without spending provider quota. See `INVESTIGATION-2026-10-29.md` for the observed delay and verification limits.

The report's historical call fallback reads `https://sunrooof-agent-calls-20260923.vercel.app/api/calls`, a separate deployed service. That service's code is not part of this dashboard repository.

## Inbound call counts

Inbound totals count distinct **Call ID per agent per date**, including in live reports, historical reports, mode summaries, time slots, and summary CSVs. A call is connected once if any attempt was answered with positive talk time. Connection rate is connected calls divided by distinct calls. Manual and Progressive retain their existing attempt counts.

Routing retries remain visible in the detailed view and raw call CSVs, with Call ID and attempt UCID. Detail status filters select calls by their final connection outcome and retain those calls' attempts. Talk and wrap-up durations still sum the source attempts. Time slots assign an inbound call to its first attempt's start time. Records missing Call ID remain individual calls; phone numbers and UCIDs are never used to guess a shared call.

## Deploy from Git

This repository is connected to the existing Vercel project `agent-productivity-dashboard`, using repository root `/` and production branch `main`. Pushes to `main` deploy to the existing project, which retains its URL and configured environment variables.
