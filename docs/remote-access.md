# Remote Access and Always-On Kanban

This guide covers an advanced pattern: running Kanban on another machine and connecting to it remotely.

This can be useful if you want tasks to keep running when your laptop is closed, if your development machine is a remote server, or if you prefer to keep long-running agent work on a more powerful box.

The key idea is simple: the Kanban app runs on the server, but you open it from your own browser. As long as the Kanban process keeps running on the server, tasks can continue even while you disconnect.

## The most important thing to understand first

When you run Kanban on a server, the **server becomes the real working machine**.

That means all of these things need to exist on the server:

- the project repository
- Git
- Node.js
- the agent setup you want to use
- any environment variables, credentials, or provider access the agent needs

If you use Cline, its provider setup lives on the server. If you use Claude Code or Codex, those CLIs must be installed and authenticated on the server.

Your browser is only the control surface. The actual work happens where Kanban is running.

## The safest remote pattern: SSH tunneling

The simplest and safest remote setup is to leave Kanban bound to localhost on the server and tunnel into it over SSH.

Start by SSHing into the server and launching Kanban from your project directory:

```bash
cd /path/to/your/project
npx kanban --no-open
```

By default, Kanban binds to `127.0.0.1:3484`, which is exactly what you want for this pattern. It means the app is only reachable locally on the server unless you deliberately tunnel to it.

Then, from your own machine, create an SSH tunnel:

```bash
ssh -L 3484:127.0.0.1:3484 your-user@your-server
```

After that, open this in your local browser:

```text
http://127.0.0.1:3484
```

From your point of view, it looks like Kanban is local. In reality, your browser traffic is being forwarded securely to the server over SSH.

This is the best starting point for most people because it does not require exposing Kanban directly to a network and does not require setting up a reverse proxy just to get going.

## If port 3484 is already in use

If the server is already using that port, launch Kanban on another one:

```bash
npx kanban --port auto --no-open
```

Kanban will print the actual port it chose. Then match that port in your tunnel command.

For example, if Kanban starts on port `3491`, use:

```bash
ssh -L 3491:127.0.0.1:3491 your-user@your-server
```

and open `http://127.0.0.1:3491` in your browser.

## Keeping Kanban running after you disconnect

If you want tasks to continue after you close your terminal or shut your laptop, Kanban itself is not enough by magic — the **server-side process must keep running**.

The easiest practical options are:

- run Kanban inside `tmux` or `screen`
- run it under a process manager or service manager such as `systemd`

For many people, `tmux` is the simplest place to start. You SSH into the server, launch Kanban in a `tmux` session, detach, and then reconnect later.

The important rule is this: if the Kanban process is still alive on the server, tasks can keep working. If that process stops, task activity stops with it.

## Reconnecting later

When you come back later, you do not need to restart everything from scratch.

If the Kanban process is still running on the server, you only need to re-establish your tunnel and reopen the local URL in your browser. The board state and running tasks should reconnect to the live runtime.

That is what makes this pattern useful for long-running work. You can leave, come back later, and resume watching or reviewing without treating your laptop as the machine that must stay awake the whole time.

## Running Kanban behind a web proxy

It is also possible to make Kanban reachable through a reverse proxy instead of an SSH tunnel, but this should be treated as a more advanced deployment pattern.

In that setup, you typically run Kanban like this on the server:

```bash
npx kanban --host 0.0.0.0 --no-open
```

Then you place a web proxy such as Nginx, Caddy, or another gateway in front of it.

This pattern can be convenient, but there is a critical security point:

> Kanban does not provide its own built-in login, password prompt, or session protection.

So if you put it behind a proxy, **the proxy must be the thing that provides access control**. In practice, that usually means some combination of:

- authentication
- session protection
- TLS/HTTPS
- restricting who can reach the service at all

You should not expose a raw Kanban instance directly to the public internet and assume it is safe by default.

## Which remote method should most people use?

For most users, the answer is: start with **SSH tunneling**.

It is simpler, easier to reason about, and safer because Kanban can stay bound to localhost on the server. A reverse proxy can be a good fit later if you already know you need a more permanent shared access pattern and you are comfortable managing authentication and network security separately.

## Remote setup checklist

If something feels strange in a remote setup, the usual cause is that the server is missing something your laptop has.

Check these on the server itself:

- the repository is present in the expected path
- Git works there
- Node.js works there
- your chosen agent is ready there
- the Kanban process is still running there

If those are true, remote access is usually just a matter of whether your SSH tunnel or proxy is forwarding traffic correctly.

## A good mental model

The easiest way to avoid confusion is to remember one sentence:

> Your browser may be local, but the coding work happens wherever Kanban is running.

Once that clicks, the remote pattern becomes much less mysterious. The server is the worker. Your browser is the window into that worker.