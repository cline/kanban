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

1. Runtime server (API + ACP runtime):

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

## Useful checks

```bash
npm run lint
npm run typecheck
npm --prefix web-ui run typecheck
npm --prefix web-ui run e2e
```
