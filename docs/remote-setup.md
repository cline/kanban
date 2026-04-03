# Remote Runtime Setup

This guide explains how to run Kanban on a remote server and connect to it from a local machine, either through a browser or through the Kanban desktop app.

## Overview

Kanban is designed as a local-first tool — `npx kanban` starts a runtime server on `127.0.0.1:3484` and opens a browser tab. But you can also run the runtime on a remote machine (a dev server, a cloud VM, a headless CI box) and connect to it over the network.

The key changes for a remote deployment:

- Bind to a network-accessible address with `--host 0.0.0.0`
- Protect the server with an auth token
- Terminate TLS in front of Kanban with a reverse proxy (nginx, Caddy, etc.)

## 1. Install Kanban on the server

Kanban requires **Node.js 20+** and **npm 10+**.

```bash
# Install globally
npm install -g kanban

# Verify
kanban --version
```

Kanban also needs `git` on the server. It expects to be launched from (or pointed at) directories that contain git repositories. Ensure git is installed and accessible on `PATH`.

> **Note:** `node-pty` (used for terminal sessions) compiles a native addon during `npm install`. The server must have a working C/C++ toolchain (`gcc`/`g++` or `clang`, `make`, `python3`). On Debian/Ubuntu: `sudo apt install build-essential python3`.

## 2. Start with `--host 0.0.0.0`

By default, Kanban binds to `127.0.0.1`, which is only reachable from localhost. To accept connections from the network, bind to all interfaces:

```bash
kanban --host 0.0.0.0 --no-open
```

`--no-open` prevents the server from trying to launch a browser (there is no GUI on a headless server).

You can also specify a fixed port:

```bash
kanban --host 0.0.0.0 --port 3484 --no-open
```

Or let Kanban pick the first available port starting at 3484:

```bash
kanban --host 0.0.0.0 --port auto --no-open
```

### Environment variables

Instead of CLI flags, you can use environment variables:

| Variable | Purpose | Default |
| --- | --- | --- |
| `KANBAN_RUNTIME_HOST` | Host IP to bind to | `127.0.0.1` |
| `KANBAN_RUNTIME_PORT` | Port to bind to (integer 1–65535) | `3484` |

CLI flags take precedence over environment variables.

## 3. Generate an auth token

When Kanban is exposed on a network, you **must** protect it with an auth token. Without one, the runtime API is open to anyone who can reach the server.

Generate a token with the built-in command:

```bash
kanban token generate
```

This prints a 64-character cryptographically random hex string to stdout, for example:

```
a3f8c1d9e4b27065f891ab34cd56ef78a3f8c1d9e4b27065f891ab34cd56ef78
```

Save this token securely. You will need it when connecting from the desktop app.

### How auth works

When an auth token is configured:

- Every HTTP API request (`/api/*`) must include an `Authorization: Bearer <token>` header.
- Every WebSocket upgrade request must include the same `Authorization: Bearer <token>` header.
- Static asset requests (`/`, `/index.html`, JS/CSS bundles) are exempt from auth so the web UI can load.
- The `/api/health` endpoint is always unauthenticated and returns `{ "ok": true, "version": "..." }`.

When no auth token is configured (the default for local CLI mode), all requests are allowed.

Token validation uses constant-time comparison to prevent timing attacks.

## 4. Add a remote connection in the desktop app

The Kanban desktop app has a built-in **Connection** menu for switching between a local runtime and remote servers.

### Adding a connection

1. Open the Kanban desktop app.
2. In the menu bar, click **Connection** > **Add Remote Connection…**
3. Fill in the dialog:
   - **Label**: A name for this connection (e.g., "Dev Server")
   - **Server URL**: The full URL of the remote Kanban instance (e.g., `https://kanban.example.com`)
   - **Auth Token**: The token you generated with `kanban token generate`
4. Click **Connect**.

The app will immediately navigate to the remote server. The auth token is injected into every request as an `Authorization: Bearer <token>` header via Electron's network interceptor — it is never exposed to the page or stored in cookies.

### Switching connections

Open **Connection** in the menu bar. All saved connections are listed with a radio indicator showing the active one. Click any connection to switch to it.

- Switching from remote to local automatically starts the bundled local runtime.
- Switching from local to remote stops the local runtime child process.

### Removing a connection

When a remote connection is active, the Connection menu shows a **Remove** option for it. Removing a connection switches back to local automatically.

### Insecure connection warning

If you enter an `http://` URL pointing to a non-localhost host, the desktop app shows a warning:

> The connection uses unencrypted HTTP. Your auth token and data will be sent in plain text. Only use HTTP for localhost.

You can proceed, but this is strongly discouraged for anything other than localhost. Use HTTPS via a reverse proxy instead.

### Connection persistence

Saved connections are stored in a `connections.json` file in the Electron `userData` directory. The "Local" connection is always present and cannot be removed.

## 5. TLS / reverse proxy setup

Kanban does not terminate TLS itself. For HTTPS, you need a reverse proxy in front of the Kanban runtime.

### nginx

```nginx
server {
    listen 443 ssl;
    server_name kanban.example.com;

    ssl_certificate     /etc/letsencrypt/live/kanban.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/kanban.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3484;
        proxy_http_version 1.1;

        # WebSocket support (required for live updates and terminal I/O)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Disable buffering for real-time streaming
        proxy_buffering off;

        # Long-lived WebSocket connections need generous timeouts
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name kanban.example.com;
    return 301 https://$host$request_uri;
}
```

After placing the config in `/etc/nginx/sites-available/kanban` and symlinking to `sites-enabled`:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Caddy

Caddy handles TLS automatically with Let's Encrypt:

```caddyfile
kanban.example.com {
    reverse_proxy 127.0.0.1:3484
}
```

Caddy provisions a certificate, terminates TLS, and proxies all traffic (including WebSocket upgrades) to the Kanban runtime automatically.

Save this as `/etc/caddy/Caddyfile` and:

```bash
sudo systemctl reload caddy
```

### Important proxy requirements

Regardless of which reverse proxy you use, make sure:

1. **WebSocket upgrade is forwarded.** Kanban uses three WebSocket paths:
   - `/api/runtime/ws` — live state stream (board updates, runtime summaries)
   - `/api/terminal/io` — terminal I/O for agent sessions
   - `/api/terminal/control` — terminal resize and control signals

   If WebSocket connections fail, the board will not receive live updates and terminal sessions will not function.

2. **Proxy timeouts are generous.** Agent sessions can run for hours. Set read/send timeouts to at least 24 hours (`86400s`) or disable idle timeout entirely.

3. **Buffering is disabled.** The runtime streams data continuously. Buffering introduces latency and can break real-time terminal rendering.

4. **The `Authorization` header is forwarded.** If your proxy strips or rewrites authorization headers, the auth middleware will reject API requests.

### Running as a systemd service

To keep Kanban running on a server, create a systemd unit file:

```ini
# /etc/systemd/system/kanban.service
[Unit]
Description=Kanban — orchestration board for coding agents
After=network.target

[Service]
Type=simple
User=kanban
WorkingDirectory=/home/kanban
ExecStart=/usr/bin/env kanban --host 0.0.0.0 --port 3484 --no-open
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kanban
sudo journalctl -u kanban -f   # watch logs
```

## 6. Known limitations

### No built-in TLS

Kanban does not handle TLS termination. You must use a reverse proxy for HTTPS. Running without TLS on a public network exposes auth tokens and all data in plain text.

### No CLI flag for auth token

The `kanban` CLI does not currently accept an `--auth-token` flag. The auth token is an API-level option used by the desktop app's child process management and the programmatic `startRuntime()` function. For standalone remote deployments, rely on a reverse proxy for access control, or use the desktop app which handles token injection automatically.

### Single-user model

Kanban is designed as a single-user tool. There is no concept of user accounts, roles, or multi-tenancy. If multiple people connect to the same remote instance, they will all see and modify the same board state. The auth token is a shared secret, not a per-user credential.

### Terminal sessions are server-local

Agent sessions (PTY processes) run on the server where Kanban is installed. The terminal in the browser is a remote view into those processes. Terminal sessions are not transferable between servers.

### Git operations run on the server

All git operations (worktree creation, commits, PRs, branch switching) execute on the server's filesystem. The server needs:

- Appropriate git credentials (SSH keys or credential helpers) for push/pull operations
- Sufficient disk space for multiple worktrees (one per active task)
- Write access to the repository directories

### System directory picker is unavailable remotely

When connected to a remote server, the native OS file picker (used for adding projects) is not available. The desktop app detects this via the `isLocal` flag in the runtime snapshot and falls back to a server-side directory browser instead.

### Native Cline integration requires SDK setup on the server

If you use Cline as your agent, the Cline SDK packages run on the server. Provider settings, API keys, and OAuth tokens are stored server-side. You will need to configure Cline's provider settings through the Kanban settings UI after connecting.

### Firewall and network considerations

- The runtime port (default `3484`) must be reachable from your client machine.
- If using a reverse proxy, only the proxy port (typically `443`) needs to be exposed.
- WebSocket connections must not be blocked by intermediate firewalls or corporate proxies.

### No automatic reconnection in the browser

If the WebSocket connection drops (network interruption, server restart), the browser UI will show a disconnected state. Reload the page to reconnect.

## Quick-start checklist

```
[ ] Node.js 20+ and git installed on server
[ ] npm install -g kanban
[ ] kanban token generate → save the token
[ ] kanban --host 0.0.0.0 --port 3484 --no-open
[ ] Reverse proxy configured (nginx or Caddy) with TLS and WebSocket forwarding
[ ] Firewall allows traffic to the proxy port (443)
[ ] Desktop app: Connection > Add Remote Connection > enter URL and token
[ ] Verify: board loads, terminal sessions work, live updates stream
```
