# Agent Productivity Dashboard

Source for the existing [Agent Productivity Dashboard](https://agent-productivity-dashboard.vercel.app/). This repository root is the Vercel project `agent-productivity-dashboard`.

## Configuration

`.env.example` shows the only Ozonetel API key to add: **`OZONETEL_API_KEY`**. The app also needs the corresponding `OZONETEL_USERNAME`. Put actual values in Vercel's project environment settings; never commit them. For local development, copy `.env.example` to ignored `.env.local` and fill in your values. Optional filters and the dashboard password are listed in the example file.

The report's historical call fallback reads `https://sunrooof-agent-calls-20260923.vercel.app/api/calls`, a separate deployed service. That service's code is not part of this dashboard repository.

## Deploy from Git

This repository is connected to the existing Vercel project `agent-productivity-dashboard`, using repository root `/` and production branch `main`. Pushes to `main` deploy to the existing project, which retains its URL and configured environment variables.
