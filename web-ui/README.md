# Kanban Web UI

This package contains the Kanban frontend served by the runtime.

## Stack

- React + TypeScript + Vite
- Palantir Blueprint v6 (`@blueprintjs/core`, `@blueprintjs/icons`, `@blueprintjs/select`)
- Atlassian pragmatic drag-and-drop
- Vitest
- Playwright

## Telemetry

PostHog telemetry is enabled in official release builds published from this repository.
For local builds, forks, and source builds, telemetry is off unless you set a PostHog key.

1. Copy `web-ui/.env.example` to `web-ui/.env.local`.
2. Set `POSTHOG_KEY` to your PostHog project key.
3. Keep `POSTHOG_HOST` set to `https://data.cline.bot` unless you need a different ingestion host.

When `POSTHOG_KEY` is empty or unset, the app does not initialize PostHog.

Current behavior:
- Session replay is disabled.
- Autocapture is disabled. This means PostHog does not automatically capture clicks, form edits, or other raw DOM interactions.
- Pageview events are enabled for active user metrics.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run typecheck`
- `npm run test`
- `npm run e2e`
