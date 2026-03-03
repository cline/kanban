# kanbanana

Kanbanana is a local orchestration board for coding agents. It runs an HTTP/WebSocket runtime and serves the bundled web UI for managing tasks, sessions, worktrees, and project state.

## Requirements

- Node.js 20+
- npm 10+

## Quick start

```bash
npm run install:all
npm run build
npm link
kanbanana --help
```

For local development:

```bash
npm run dev
```

## CLI

```bash
kanbanana [--port <number>] [--agent <id>] [--no-open] [--help] [--version]
```

- `--port <number>`: bind the local runtime server to a specific port (default: `8484`)
- `--agent <id>`: set the default agent (`claude`, `codex`, `gemini`, `opencode`, `cline`)
- `--no-open`: do not auto-open the browser
- `--help`: print usage
- `--version`: print version

After global install, you can also view the manual page:

```bash
man kanbanana
```

## Scripts

- `npm run build`: build runtime and bundled web UI into `dist`
- `npm run dev`: run CLI in watch mode
- `npm run web:dev`: run web UI dev server
- `npm run web:build`: build web UI
- `npm run typecheck`: typecheck runtime
- `npm run web:typecheck`: typecheck web UI
- `npm run test`: run runtime tests
- `npm run web:test`: run web UI tests
- `npm run check`: lint, typecheck, and test runtime package

## Tests

- `test/integration`: integration tests for runtime behavior and startup flows
- `test/runtime`: runtime unit tests
- `test/utilities`: shared test helpers

## PostHog telemetry config

The web UI reads PostHog settings at build time:

- `POSTHOG_KEY`
- `POSTHOG_HOST`

Local development:
- Set these in `web-ui/.env.local` (see `web-ui/.env.example`).
- If `POSTHOG_KEY` is missing, telemetry does not initialize.

Release builds:
- The publish workflow injects `POSTHOG_KEY` and `POSTHOG_HOST` from GitHub Secrets.
- `POSTHOG_HOST` is optional and defaults to `https://data.cline.bot`.

Result:
- Official releases have telemetry enabled.
- Forks and source builds have telemetry disabled unless a key is explicitly provided.
