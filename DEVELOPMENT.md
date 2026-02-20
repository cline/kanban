# Development

## Requirements

- Node.js 20+
- npm 10+

## Install

```bash
npm run install:all
```

## Hot reload workflow

Run two terminals:

1. Runtime server (API + PTY agent runtime):

```bash
npm run dev
```

- Runs on `http://127.0.0.1:8484`

2. Web UI (Vite HMR):

```bash
npm run web:dev
```

- Runs on `http://127.0.0.1:4173`
- `/api/*` requests from Vite are proxied to `http://127.0.0.1:8484`

Use `http://127.0.0.1:4173` while developing UI so changes hot reload.

## Build and run packaged CLI

```bash
npm run build
node dist/cli.js
```

This mode serves built web assets from `dist/web-ui` and does not hot reload the web UI.

## Run `kanbanana` from any directory

Create a global npm link from this repo:

```bash
npm run build
npm link
```

Verify:

```bash
which kanbanana
kanbanana --version
```

Then run from any project directory:

```bash
cd /path/to/your/project
kanbanana
```

After local code changes, run `npm run build` again before using the linked command.

Remove the global link:

```bash
npm unlink -g kanbanana
```

## Useful checks

```bash
npm run lint
npm run typecheck
npm --prefix web-ui run typecheck
npm --prefix web-ui run e2e
```
