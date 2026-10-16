# Agent Productivity Dashboard

Source for the existing [Agent Productivity Dashboard](https://agent-productivity-dashboard.vercel.app/). This repository root is the Vercel project `agent-productivity-dashboard`.

## Configuration

`.env.example` shows the only Ozonetel API key to add: **`OZONETEL_API_KEY`**. The app also needs the corresponding `OZONETEL_USERNAME`. Put actual values in Vercel's project environment settings; never commit them. For local development, copy `.env.example` to ignored `.env.local` and fill in your values. Optional filters and the dashboard password are listed in the example file.

The report's historical call fallback reads `https://sunrooof-agent-calls-20260923.vercel.app/api/calls`, a separate deployed service. That service's code is not part of this dashboard repository.

## Inbound call counts

Inbound totals count distinct **Call ID per agent per date**, including in live reports, historical reports, mode summaries, time slots, and summary CSVs. A call is connected once if any attempt was answered with positive talk time. Connection rate is connected calls divided by distinct calls. Manual and Progressive retain their existing attempt counts.

Routing retries remain visible in the detailed view and raw call CSVs, with Call ID and attempt UCID. Detail status filters select calls by their final connection outcome and retain those calls' attempts. Talk and wrap-up durations still sum the source attempts. Time slots assign an inbound call to its first attempt's start time. Records missing Call ID remain individual calls; phone numbers and UCIDs are never used to guess a shared call.

## Deploy from Git

This repository is connected to the existing Vercel project `agent-productivity-dashboard`, using repository root `/` and production branch `main`. Pushes to `main` deploy to the existing project, which retains its URL and configured environment variables.
