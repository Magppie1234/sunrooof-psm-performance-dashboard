# Sunrooof report investigation — 29 October 2026

The previously deployed report polled four individual agents at a time. It now reads the full account-wide login snapshot through the existing shared backend. Tests cover zero-call agents, incomplete snapshots, failures and recovery. All 21 tests passed.

At 12:34:35 IST, production returned a complete snapshot with nine logged-in agents. Later, at 12:52:42 IST, an uncached production request returned HTTP 200 with Cache-Control: no-store and X-Vercel-Cache: MISS, but the login snapshot was from 12:45:11 IST and call records from 12:50:51 IST. The shared adapter reported pending=true and retained collected data. The current login count was correctly unavailable because the snapshot exceeded two minutes.

The integration health check returned configured=true, accountAligned=true and ok=true with zero provider requests. This verifies that the report connects to the shared backend; it does not prove that its provider jobs are completing promptly. Backend source/release documentation describes queued, budget-controlled report collection with dialer priority. These observations explain the banner, but do not establish which specific provider quota, worker or job caused this delay. Determining that requires inspecting the shared backend's private job/budget diagnostics.

No shared backend code, environment variables, rate limits, jobs or deployment were changed during this investigation. No direct Ozonetel bypass was added. The warning remains rather than mislabeling cached snapshots as live.

GitHub source was reconciled with production deployment dpl_FtA4pcTCawtYPUmvGxpLGLaskdx8, including its shared-integration baseline, complete-login fix, tests and corrected environment documentation. Existing credentials are excluded from the source backup.
