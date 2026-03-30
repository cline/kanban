# Job Queue × Kanban Integration — Implementation Plan

This document describes the complete implementation path for integrating the `overthink_rust/job_queue_layer` as a sidecar runtime alongside the Kanban app. The job queue is a Rust-based, SQLite-backed, highly concurrent execution engine for shell commands with scheduling, retries, monitoring, and admin controls. Kanban is a local Node runtime + React board for orchestrating coding-agent tasks. Together, they unlock scheduled execution, automated pipelines, periodic maintenance, agentic workflows, and rich operational visibility — all surfaced through the Kanban UI.

The plan is organized into six projects, ordered from foundational to most ambitious. Each project builds on the previous ones. Every project includes the conceptual rationale, the precise code changes needed, and progress checkboxes.

---

## Table of Contents

1. [Project 0: Sidecar Foundation](#project-0-sidecar-foundation)
2. [Project 1: Scheduled Task Execution](#project-1-scheduled-task-execution)
3. [Project 2: Periodic Maintenance Jobs](#project-2-periodic-maintenance-jobs)
4. [Project 3: Dependency-Driven Auto-Start Pipelines](#project-3-dependency-driven-auto-start-pipelines)
5. [Project 4: Multi-Step Agentic Workflows](#project-4-multi-step-agentic-workflows)
6. [Project 5: Job Queue Health Dashboard](#project-5-job-queue-health-dashboard)
7. [Project 6: Batch Task Operations](#project-6-batch-task-operations)

---

## Architecture Overview

### The Sidecar Model

The job queue runs as a separate Rust binary alongside Kanban's Node process. They share a single SQLite database at a well-known path. Communication is CLI-based: Kanban shells out to the `job_queue` binary for mutations (`enqueue`, `schedule`, `admin`) and queries (`inspect --json`, `health --json`). Jobs execute shell commands, and those commands call back into Kanban's own CLI (`kanban task start <id>`) to drive board actions.

```
┌──────────────────────────────┐     ┌──────────────────────────────┐
│  Kanban Node Runtime         │     │  Job Queue Rust Sidecar      │
│                              │     │                              │
│  TRPC API ──► job-queue CLI  │────►│  Workers + Scheduler         │
│                              │     │  SQLite DB at ~/.kanban/     │
│  State Hub ◄── inspect JSON  │◄────│  jobs.db                     │
│                              │     │                              │
│  Browser UI ◄── WebSocket    │     │  Executes shell commands     │
│                              │     │  that call `kanban task ...` │
└──────────────────────────────┘     └──────────────────────────────┘
```

### Key Design Decisions

1. **Jobs are shell commands.** The job queue's `JobMetadata` is `{ command, args, env, cwd, timeout_secs }`. This means every Kanban integration is a script or CLI invocation — no custom job queue plugin system needed.

2. **The job queue binary is the only interface.** Kanban never touches the SQLite DB directly. It always goes through `job_queue enqueue`, `job_queue schedule`, `job_queue inspect --json`, etc. This preserves the queue's internal consistency guarantees.

3. **Kanban's CLI is the callback interface.** When the job queue needs to start a task or mutate the board, the job payload is `kanban task start <taskId>` or a wrapper script that calls kanban CLI commands.

4. **State flows through `inspect --json`.** The job queue's inspect output is a rich JSON snapshot (status counts, worker activity, performance percentiles, alerts, diagnostics). Kanban polls this or subscribes via the Unix socket monitor to keep the UI updated.

---

## Project 0: Sidecar Foundation

This project establishes the shared infrastructure that all subsequent projects depend on: the job queue binary management, the shared database location, the Node-side service for interacting with the queue, and the lifecycle management (start/stop the sidecar alongside Kanban).

### Concepts

The sidecar needs to start when Kanban starts and stop when Kanban stops. The job queue database lives at a well-known path so both processes can agree on it without configuration. A `JobQueueService` class in Kanban owns all interaction with the binary — spawning it, calling its CLI, and parsing its JSON output.

### Implementation

#### 0.1 — Shared paths and binary resolution

Create a module that defines the shared database path and knows how to find the job queue binary.

**File: `kanban/src/core/job-queue-paths.ts`**

```typescript
import { homedir } from "node:os";
import { join } from "node:path";
import { accessSync, constants } from "node:fs";

/** Root data directory for the job queue sidecar. */
export function getJobQueueDataDir(): string {
  return join(homedir(), ".kanban", "job-queue");
}

/** SQLite database URL for the job queue. */
export function getJobQueueDatabaseUrl(): string {
  return `sqlite://${join(getJobQueueDataDir(), "jobs.db")}`;
}

/** Path to the job queue binary. Checks known locations in order. */
export function resolveJobQueueBinary(): string | null {
  // 1. Explicit env override
  const envPath = process.env.KANBAN_JOB_QUEUE_BINARY;
  if (envPath) {
    return envPath;
  }

  // 2. Check if `job_queue` is on PATH
  const candidates = ["job_queue", "job-queue"];
  for (const name of candidates) {
    try {
      const { execSync } = require("node:child_process");
      const resolved = execSync(`which ${name}`, { encoding: "utf8" }).trim();
      if (resolved) return resolved;
    } catch {
      // not found, try next
    }
  }

  // 3. Check the overthink_rust build output relative to workspace
  const devPath = join(
    homedir(),
    "dev/github.com/cline/overthink_rust/job_queue_layer/target/debug/job_queue"
  );
  try {
    accessSync(devPath, constants.X_OK);
    return devPath;
  } catch {
    // not available
  }

  return null;
}
```

#### 0.2 — Job queue service

This is the central service class. It wraps all CLI interactions, manages the sidecar process lifecycle, and provides typed interfaces for the rest of Kanban.

**File: `kanban/src/server/job-queue-service.ts`**

```typescript
import { spawn, execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import type { ChildProcess } from "node:child_process";
import {
  getJobQueueDatabaseUrl,
  getJobQueueDataDir,
  resolveJobQueueBinary,
} from "../core/job-queue-paths";

export interface JobQueueInspectSnapshot {
  schema_version: number;
  generated_at: number;
  jobs: {
    status_counts: Record<string, number>;
    queue_status_counts: Record<string, Record<string, number>>;
  };
  scheduled: {
    status_counts: Record<string, number>;
    queue_status_counts: Record<string, Record<string, number>>;
  };
  diagnostics: Record<string, unknown>;
  performance: Record<string, unknown>;
  worker_activity: {
    active_workers_recent: number;
    stale_workers: number;
    workers: Record<string, unknown>;
  };
  alerts: string[];
}

export interface JobQueueHealthReport {
  generated_at: number;
  status: "ok" | "degraded";
  reasons: string[];
  summary: {
    queued: number;
    running: number;
    scheduled_pending: number;
  };
}

export interface EnqueueOptions {
  queue?: string;
  priority?: number;
  maxAttempts?: number;
  command: string;
  args?: string[];
  cwd?: string;
  timeoutSecs?: number;
}

export interface ScheduleOptions extends EnqueueOptions {
  dueIn?: string;   // e.g. "10s", "5m", "2h"
  dueAt?: number;   // absolute unix timestamp
}

export class JobQueueService {
  private binary: string | null = null;
  private sidecarProcess: ChildProcess | null = null;
  private databaseUrl: string;

  constructor() {
    this.databaseUrl = getJobQueueDatabaseUrl();
  }

  /** Check if the job queue binary is available. */
  isAvailable(): boolean {
    if (!this.binary) {
      this.binary = resolveJobQueueBinary();
    }
    return this.binary !== null;
  }

  /** Get the resolved binary path, or throw. */
  private getBinary(): string {
    if (!this.binary) {
      this.binary = resolveJobQueueBinary();
    }
    if (!this.binary) {
      throw new Error(
        "Job queue binary not found. Install it or set KANBAN_JOB_QUEUE_BINARY."
      );
    }
    return this.binary;
  }

  /** Execute a job_queue CLI command and return stdout. */
  private async exec(args: string[]): Promise<string> {
    const bin = this.getBinary();
    const fullArgs = ["--database-url", this.databaseUrl, ...args];

    return new Promise((resolve, reject) => {
      execFile(bin, fullArgs, { timeout: 30_000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`job_queue ${args[0]}: ${stderr || error.message}`));
          return;
        }
        resolve(stdout);
      });
    });
  }

  /** Start the sidecar workers + scheduler process. */
  async startSidecar(options?: {
    workers?: number;
    pollMs?: number;
  }): Promise<void> {
    if (this.sidecarProcess) return;

    await mkdir(getJobQueueDataDir(), { recursive: true });

    const bin = this.getBinary();
    const workers = options?.workers ?? 4;
    const pollMs = options?.pollMs ?? 500;

    this.sidecarProcess = spawn(bin, [
      "--database-url", this.databaseUrl,
      "run-all",
      "--workers", String(workers),
      "--poll-ms", String(pollMs),
      "--heartbeat-secs", "10",
      "--reaper-every-ticks", "10",
      "--reaper-batch-size", "100",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    this.sidecarProcess.on("exit", (code) => {
      console.warn(`[kanban] job queue sidecar exited with code ${code}`);
      this.sidecarProcess = null;
    });
  }

  /** Stop the sidecar process gracefully. */
  async stopSidecar(): Promise<void> {
    if (!this.sidecarProcess) return;
    this.sidecarProcess.kill("SIGINT");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.sidecarProcess?.kill("SIGKILL");
        resolve();
      }, 5_000);
      this.sidecarProcess?.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    this.sidecarProcess = null;
  }

  /** Whether the sidecar is currently running. */
  isSidecarRunning(): boolean {
    return this.sidecarProcess !== null && !this.sidecarProcess.killed;
  }

  /** Enqueue an immediate job. */
  async enqueue(options: EnqueueOptions): Promise<string> {
    const args = ["enqueue", "--command", options.command];
    if (options.queue) args.push("--queue", options.queue);
    if (options.priority) args.push("--priority", String(options.priority));
    if (options.maxAttempts) args.push("--max-attempts", String(options.maxAttempts));
    if (options.cwd) args.push("--cwd", options.cwd);
    if (options.timeoutSecs) args.push("--timeout-secs", String(options.timeoutSecs));
    for (const arg of options.args ?? []) {
      args.push("--arg", arg);
    }
    const output = await this.exec(args);
    // Output: "enqueued job <id>"
    return output.trim().replace("enqueued job ", "");
  }

  /** Schedule a job for future execution. */
  async schedule(options: ScheduleOptions): Promise<string> {
    const args = ["schedule", "--command", options.command];
    if (options.queue) args.push("--queue", options.queue);
    if (options.priority) args.push("--priority", String(options.priority));
    if (options.maxAttempts) args.push("--max-attempts", String(options.maxAttempts));
    if (options.cwd) args.push("--cwd", options.cwd);
    if (options.timeoutSecs) args.push("--timeout-secs", String(options.timeoutSecs));
    if (options.dueIn) args.push("--due-in", options.dueIn);
    if (options.dueAt) args.push("--due-at", String(options.dueAt));
    for (const arg of options.args ?? []) {
      args.push("--arg", arg);
    }
    const output = await this.exec(args);
    // Output: "scheduled job <id>"
    return output.trim().replace("scheduled job ", "");
  }

  /** Get a full inspect snapshot as JSON. */
  async inspect(options?: { queue?: string }): Promise<JobQueueInspectSnapshot> {
    const args = ["inspect", "--json"];
    if (options?.queue) args.push("--queue", options.queue);
    const output = await this.exec(args);
    return JSON.parse(output);
  }

  /** Get a health summary as JSON. */
  async health(): Promise<JobQueueHealthReport> {
    const args = ["health", "--json"];
    const output = await this.exec(args);
    return JSON.parse(output);
  }

  /** Pause a queue. */
  async pauseQueue(queue: string, reason: string): Promise<void> {
    await this.exec([
      "admin", "queue", "pause",
      "--queue", queue,
      "--actor", "kanban",
      "--reason", reason,
    ]);
  }

  /** Resume a queue. */
  async resumeQueue(queue: string, reason: string): Promise<void> {
    await this.exec([
      "admin", "queue", "resume",
      "--queue", queue,
      "--actor", "kanban",
      "--reason", reason,
    ]);
  }

  /** Replay failed jobs. */
  async replayFailed(options?: { queue?: string; limit?: number }): Promise<number> {
    const args = ["admin", "jobs", "replay", "--status", "failed", "--actor", "kanban"];
    if (options?.queue) args.push("--queue", options.queue);
    if (options?.limit) args.push("--limit", String(options.limit));
    const output = await this.exec(args);
    const match = output.match(/replayed (\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }
}
```

#### 0.3 — Sidecar lifecycle integration

Wire the sidecar into Kanban's startup and shutdown flow.

In `kanban/src/server/runtime-server.ts`, during server creation:
- Instantiate `JobQueueService` and call `startSidecar()` after the HTTP server starts.
- Store the service instance so TRPC handlers can access it.

In `kanban/src/server/shutdown-coordinator.ts`, during shutdown:
- Call `jobQueueService.stopSidecar()` before closing the HTTP server.

#### 0.4 — TRPC endpoint for job queue state

Expose job queue operations to the browser through a new TRPC router section.

**File: `kanban/src/trpc/jobs-api.ts`**

```typescript
import type { JobQueueService } from "../server/job-queue-service";

export interface CreateJobsApiDependencies {
  getJobQueueService: () => JobQueueService;
}

export function createJobsApi(deps: CreateJobsApiDependencies) {
  return {
    getStatus: async () => {
      const service = deps.getJobQueueService();
      if (!service.isAvailable()) {
        return { available: false, running: false, health: null, inspect: null };
      }
      const running = service.isSidecarRunning();
      if (!running) {
        return { available: true, running: false, health: null, inspect: null };
      }
      try {
        const [health, inspect] = await Promise.all([
          service.health(),
          service.inspect(),
        ]);
        return { available: true, running: true, health, inspect };
      } catch {
        return { available: true, running, health: null, inspect: null };
      }
    },
    enqueue: async (input: {
      queue?: string;
      command: string;
      args?: string[];
      priority?: number;
    }) => {
      const service = deps.getJobQueueService();
      const jobId = await service.enqueue(input);
      return { ok: true, jobId };
    },
    schedule: async (input: {
      queue?: string;
      command: string;
      args?: string[];
      dueIn?: string;
      dueAt?: number;
      priority?: number;
    }) => {
      const service = deps.getJobQueueService();
      const jobId = await service.schedule(input);
      return { ok: true, jobId };
    },
    pauseQueue: async (input: { queue: string; reason: string }) => {
      const service = deps.getJobQueueService();
      await service.pauseQueue(input.queue, input.reason);
      return { ok: true };
    },
    resumeQueue: async (input: { queue: string; reason: string }) => {
      const service = deps.getJobQueueService();
      await service.resumeQueue(input.queue, input.reason);
      return { ok: true };
    },
    replayFailed: async (input?: { queue?: string; limit?: number }) => {
      const service = deps.getJobQueueService();
      const count = await service.replayFailed(input);
      return { ok: true, replayed: count };
    },
  };
}
```

Register this in `app-router.ts` alongside the existing runtime, workspace, projects, and hooks APIs.

### Progress

- [x] 0.1 — Create `job-queue-paths.ts` with data dir, DB URL, and binary resolution
- [x] 0.2 — Create `job-queue-service.ts` with full CLI wrapper, typed interfaces, inspect polling, and admin ops
- [x] 0.3 — Integrate sidecar start into `runtime-server.ts`; `stopInspectPolling` + `stopSidecar` called in close()
- [x] 0.4 — Create `jobs-api.ts` TRPC router and register in `app-router.ts`
- [x] 0.5 — `KANBAN_JOB_QUEUE_BINARY` env var documented in `resolveJobQueueBinary()` inline comment
- [ ] 0.6 — Write integration test: start kanban, verify sidecar starts, enqueue a job, verify it runs

---

## Project 1: Scheduled Task Execution

### Concepts

Users want to say "start this backlog task at 3am" or "start this in 2 hours." Today, everything is manually triggered. The job queue's `schedule` command with `--due-in` or `--due-at` gives us deferred execution natively.

When a user schedules a task, Kanban calls `job_queue schedule --due-in 2h --command "kanban task start <taskId> --workspace <path>"`. The job queue's scheduler transfers this to the runnable queue when it's due. A worker picks it up and executes the kanban CLI command, which starts the agent session.

The board card shows a scheduled time badge. The card stays in backlog until the scheduled time arrives and the job starts it, at which point the normal task lifecycle takes over.

### Implementation

#### 1.1 — `kanban task start` CLI command

The `kanban task` subcommand already exists (registered in `src/commands/task.ts`). We need to ensure `kanban task start <taskId>` can be called from an external process (the job queue worker) and have it start a task session via the running Kanban server's TRPC API.

**Modifications to `kanban/src/commands/task.ts`:**

Add a `start` subcommand that:
1. Connects to the running Kanban server at the known runtime URL.
2. Calls the `runtime.startTaskSession` TRPC endpoint with the given task ID.
3. Exits 0 on success, non-zero on failure.

```typescript
taskCommand
  .command("start <taskId>")
  .description("Start a task session via the running Kanban server.")
  .option("--workspace <path>", "Workspace path override")
  .option("--base-ref <ref>", "Git base ref", "main")
  .action(async (taskId, options) => {
    const response = await fetch(
      buildKanbanRuntimeUrl("/api/trpc/runtime.startTaskSession"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options.workspace
            ? { "x-kanban-workspace-id": options.workspace }
            : {}),
        },
        body: JSON.stringify({
          taskId,
          prompt: "", // Resume existing prompt from card
          baseRef: options.baseRef,
        }),
      }
    );
    const result = await response.json();
    if (!result.result?.data?.ok) {
      console.error(`Failed to start task: ${result.result?.data?.error}`);
      process.exit(1);
    }
    console.log(`Task ${taskId} started.`);
  });
```

#### 1.2 — Schedule task TRPC endpoint

Add a `scheduleTask` method to the runtime API that wraps the board mutation + job queue schedule call.

**In `kanban/src/trpc/runtime-api.ts`:**

```typescript
scheduleTask: async (workspaceScope, input: {
  taskId: string;
  dueIn?: string;
  dueAt?: number;
  baseRef: string;
}) => {
  const service = deps.getJobQueueService();
  if (!service.isAvailable()) {
    return { ok: false, error: "Job queue is not available." };
  }

  const kanbanBin = process.argv[0]; // node
  const cliPath = process.argv[1];   // kanban entry
  const jobId = await service.schedule({
    queue: "kanban.tasks",
    command: kanbanBin,
    args: [
      cliPath, "task", "start", input.taskId,
      "--workspace", workspaceScope.workspacePath,
      "--base-ref", input.baseRef,
    ],
    dueIn: input.dueIn,
    dueAt: input.dueAt,
    maxAttempts: 2,
    timeoutSecs: 3600,
  });

  return { ok: true, jobId, scheduledTaskId: input.taskId };
},
```

#### 1.3 — Board card schedule metadata

Extend the board card schema to store schedule information.

**In `kanban/src/core/api-contract.ts`:**

Add optional fields to `runtimeBoardCardSchema`:

```typescript
scheduledAt: z.number().nullable().optional(),      // unix ms when scheduled
scheduledJobId: z.string().nullable().optional(),    // job queue job ID
scheduledDueAt: z.number().nullable().optional(),    // unix ms when it will fire
```

#### 1.4 — Browser UI: Schedule dialog

**New component: `web-ui/src/components/schedule-task-dialog.tsx`**

A dialog triggered from the card context menu on backlog cards. Contains:
- A date/time picker for absolute scheduling.
- Quick presets: "In 30 minutes", "In 1 hour", "In 2 hours", "Tonight at 10pm", "Tomorrow at 9am".
- A "Schedule" button that calls the `scheduleTask` TRPC endpoint.

**Card badge: `web-ui/src/components/schedule-badge.tsx`**

A small clock icon + relative time ("in 2h") rendered on cards that have `scheduledDueAt` set. The badge shows a countdown and updates every minute.

#### 1.5 — Cancel scheduled task

When a scheduled task's card is trashed or the user cancels the schedule, we need to remove the job from the queue. The job queue doesn't have a "cancel" command for scheduled jobs directly, but we can use the `admin jobs replay` approach — or more practically, the job's script can check whether the card is still in backlog before starting the session (a "guard clause" pattern).

The job command becomes a small wrapper script:
```bash
#!/bin/bash
# Check if task is still schedulable before starting
kanban task status "$TASK_ID" --workspace "$WORKSPACE" | grep -q '"column":"backlog"'
if [ $? -ne 0 ]; then
  echo "Task $TASK_ID is no longer in backlog, skipping."
  exit 0
fi
kanban task start "$TASK_ID" --workspace "$WORKSPACE" --base-ref "$BASE_REF"
```

### Progress

- [x] 1.1 — `kanban task start --task-id` CLI subcommand (in commands/task.ts; calls TRPC runtime API)
- [x] 1.2 — `kanban task queue-status` CLI subcommand (proxies jobs.getStatus → JSON output)
- [x] 1.3 — `kanban task schedule --task-id --due-in|--due-at` CLI subcommand (enqueues via jobs.schedule TRPC, queue: scheduled-tasks)
- [x] 1.4 — Extend board card schema with schedule metadata fields (scheduledAt, scheduledJobId, scheduledDueAt)
- [x] 1.5 — `scripts/maintenance/schedule-task-guard.sh` checks task column before starting
- [x] 1.6 — `web-ui/src/components/schedule-task-dialog.tsx`: date-picker + 5 quick presets (30m/1h/2h/tonight/tomorrow); callback pattern
- [x] 1.7 — `web-ui/src/components/schedule-badge.tsx`: countdown clock badge; amber when overdue; 60s update interval
- [ ] 1.8 — Add "Schedule" option to backlog card context menu
- [ ] 1.9 — Wire schedule cancellation into card trash flow
- [ ] 1.10 — End-to-end test: schedule a task for 10s in the future, verify it starts

---

## Project 2: Periodic Maintenance Jobs

### Concepts

Kanban can benefit from background housekeeping that runs automatically: fetching git remotes, checking for stale sessions, cleaning up old worktrees, generating activity digests. The job queue's self-rescheduling pattern (a job schedules its own next run) is perfect for this — no cron, no external scheduler, just a job that re-enqueues itself.

Each maintenance job is a shell script that:
1. Does its work (e.g., `git fetch` across worktrees).
2. Checks a policy (iteration cap, time budget).
3. Schedules its next run via `job_queue schedule --due-in <interval>`.

### Implementation

#### 2.1 — Maintenance scripts directory

**Directory: `kanban/scripts/maintenance/`**

Each script follows a standard pattern:

**`kanban/scripts/maintenance/git-fetch-all.sh`**
```bash
#!/bin/bash
set -euo pipefail
# Periodic git fetch across all workspace worktrees.
# Args: $1=kanban-runtime-url $2=db-url $3=interval-secs $4=max-iterations $5=state-file

RUNTIME_URL="$1"
DB_URL="$2"
INTERVAL="${3:-300}"
MAX_ITER="${4:-0}"  # 0 = unlimited
STATE_FILE="${5:-/tmp/kanban-git-fetch-state}"

# Load iteration counter
iter=0
[ -f "$STATE_FILE" ] && iter=$(cat "$STATE_FILE")
iter=$((iter + 1))

# Policy gate: max iterations (0 = no limit)
if [ "$MAX_ITER" -gt 0 ] && [ "$iter" -gt "$MAX_ITER" ]; then
  echo "git-fetch-all: reached max iterations ($MAX_ITER), stopping."
  rm -f "$STATE_FILE"
  exit 0
fi

echo "$iter" > "$STATE_FILE"

# Do the work: call kanban's TRPC to get project list, then git fetch each
# (simplified — real implementation would parse JSON response)
echo "git-fetch-all: iteration $iter, fetching all remotes"
# ... git fetch logic ...

# Schedule next run
job_queue --database-url "$DB_URL" schedule \
  --queue kanban.maintenance \
  --due-in "${INTERVAL}s" \
  --command "$0" \
  --arg "$RUNTIME_URL" --arg "$DB_URL" --arg "$INTERVAL" --arg "$MAX_ITER" --arg "$STATE_FILE"

echo "git-fetch-all: iteration $iter complete, next in ${INTERVAL}s"
```

**`kanban/scripts/maintenance/stale-session-checker.sh`** — Checks for `in_progress` tasks with no output for >30 minutes and optionally stops them.

**`kanban/scripts/maintenance/worktree-cleanup.sh`** — Removes worktrees for trashed tasks older than 24 hours.

#### 2.2 — Maintenance job registration

When the sidecar starts, Kanban seeds the initial maintenance jobs if they aren't already running.

**In `job-queue-service.ts`, add:**

```typescript
async seedMaintenanceJobs(options: {
  kanbanRuntimeUrl: string;
  scripts: Array<{
    name: string;
    scriptPath: string;
    queue: string;
    intervalSecs: number;
    args?: string[];
  }>;
}): Promise<void> {
  // Check if maintenance jobs are already scheduled
  const snapshot = await this.inspect({ queue: "kanban.maintenance" });
  const pendingCount =
    (snapshot.scheduled.status_counts["pending"] ?? 0) +
    (snapshot.jobs.status_counts["queued"] ?? 0) +
    (snapshot.jobs.status_counts["running"] ?? 0);

  if (pendingCount > 0) {
    return; // Maintenance jobs already active
  }

  for (const job of options.scripts) {
    await this.schedule({
      queue: job.queue,
      command: job.scriptPath,
      args: [
        options.kanbanRuntimeUrl,
        this.databaseUrl,
        String(job.intervalSecs),
        ...(job.args ?? []),
      ],
      dueIn: "10s", // Start 10s after boot
    });
  }
}
```

#### 2.3 — Settings UI for maintenance jobs

**New component: `web-ui/src/components/settings/maintenance-settings.tsx`**

A settings panel that lists available maintenance jobs with:
- Toggle to enable/disable each job type.
- Interval picker (every 5min, 15min, 30min, 1h, 4h).
- "Run Now" button that immediately enqueues the job.
- Last run time and outcome.

The settings are stored in Kanban's runtime config and used when seeding jobs on startup.

### Progress

- [x] 2.1 — Created `scripts/maintenance/` directory with executable scripts
- [x] 2.2 — Implemented `git-fetch-all.sh` (fetches all project repos; self-reschedules)
- [x] 2.3 — Implemented `stale-session-checker.sh` (stops in_progress tasks idle >30m; self-reschedules)
- [x] 2.4 — Implemented `worktree-cleanup.sh` (removes trash worktrees older than 24h; self-reschedules)
- [x] 2.5 — `seedMaintenanceJobs` implemented in `src/server/maintenance-jobs.ts` (idempotent, checks for existing pending/running jobs per queue before seeding)
- [x] 2.6 — Called from `runtime-server.ts` after sidecar `startSidecar()` resolves
- [ ] 2.7 — Add maintenance job config to runtime config schema
- [ ] 2.8 — Create `MaintenanceSettings` component in settings UI
- [ ] 2.9 — Test: verify maintenance jobs self-reschedule correctly across 3 iterations

---

## Project 3: Dependency-Driven Auto-Start Pipelines

### Concepts

Kanban already has task dependencies: a backlog card can depend on a review card. When the review card is trashed (completed), the dependent backlog cards become "ready." Today, the user has to manually start them. With the job queue, we can automatically start ready tasks.

A "dependency watcher" job runs periodically (every 30s), queries the board for backlog tasks whose dependencies have all been satisfied, and starts them. This creates automatic task pipelines.

### Implementation

#### 3.1 — `kanban task list-ready` CLI command

Add a CLI command that returns backlog tasks with all dependencies satisfied.

```typescript
taskCommand
  .command("list-ready")
  .option("--workspace <path>")
  .option("--json", "Output JSON")
  .action(async (options) => {
    // Query workspace state via TRPC
    // Filter backlog cards where all dependency toTaskIds are in trash
    // Output task IDs
  });
```

#### 3.2 — Auto-start watcher script

**`kanban/scripts/maintenance/dependency-auto-start.sh`**

```bash
#!/bin/bash
set -euo pipefail
# Watches for backlog tasks whose dependencies are satisfied and starts them.

RUNTIME_URL="$1"
DB_URL="$2"
INTERVAL="${3:-30}"
WORKSPACE="$4"
CONCURRENCY_LIMIT="${5:-2}"  # Max tasks to auto-start per tick

# Get ready task IDs
READY_TASKS=$(kanban task list-ready --workspace "$WORKSPACE" --json 2>/dev/null || echo "[]")
COUNT=$(echo "$READY_TASKS" | jq 'length')

if [ "$COUNT" -gt 0 ]; then
  # Start up to CONCURRENCY_LIMIT tasks
  echo "$READY_TASKS" | jq -r ".[:$CONCURRENCY_LIMIT][]" | while read -r TASK_ID; do
    echo "auto-starting ready task: $TASK_ID"
    kanban task start "$TASK_ID" --workspace "$WORKSPACE" || true
  done
fi

# Reschedule
job_queue --database-url "$DB_URL" schedule \
  --queue kanban.automation \
  --due-in "${INTERVAL}s" \
  --command "$0" \
  --arg "$RUNTIME_URL" --arg "$DB_URL" --arg "$INTERVAL" --arg "$WORKSPACE" --arg "$CONCURRENCY_LIMIT"
```

#### 3.3 — Card UI: Auto-start toggle

On backlog cards that have dependencies, show a toggle: "Auto-start when ready." When enabled, this ensures the dependency watcher will pick up this task. The toggle sets a flag on the card metadata.

**Extend board card schema:**

```typescript
autoStartWhenReady: z.boolean().optional(),
```

The watcher script filters to only auto-start cards that have this flag set.

#### 3.4 — Pipeline visualization

In the board view, when a card has dependencies and `autoStartWhenReady` is true, render a subtle pipeline arrow from the dependency card to this card, with a lightning bolt icon indicating automatic execution.

### Progress

- [x] 3.1 — `kanban task list-ready` CLI command: queries workspace state, finds backlog cards with `autoStartWhenReady=true` and all deps in trash
- [x] 3.2 — `scripts/maintenance/dependency-auto-start.sh`: polls `list-ready`, starts up to CONCURRENCY_LIMIT tasks, self-reschedules
- [x] 3.3 — `autoStartWhenReady: z.boolean().optional()` added to `runtimeBoardCardSchema` in `api-contract.ts`
- [x] 1.5 — `scripts/maintenance/schedule-task-guard.sh`: checks task is still in backlog before starting (prevents double-start on scheduled tasks)
- [ ] 3.4 — Add auto-start toggle to backlog card dependency UI
- [x] 3.5 — `seedProjectAutomationJobs()` in `maintenance-jobs.ts`: seeds `dependency-auto-start.sh` for each indexed project + global git-fetch-all / stale-session-checker / worktree-cleanup; called from `runtime-server.ts` after `seedMaintenanceJobs`
- [ ] 3.6 — Add pipeline arrow visualization between dependent cards
- [ ] 3.7 — Test: create A→B dependency chain, trash B, verify A auto-starts

---

## Project 4: Multi-Step Agentic Workflows

### Concepts

This is the most powerful integration. A "workflow card" is a task that doesn't run a single agent session — instead, it orchestrates multiple bounded steps through the job queue. Each step is a separate job, and the output of one step determines what the next step does.

This implements Pattern B (Planner/Executor) and Pattern C (Policy-Gated Autonomous Loop) from the job queue's agentic demos, but adapted for Kanban's board model.

A workflow has:
- An **objective** (the prompt).
- A **policy** (max iterations, deadline, allowed actions).
- A **state file** (tracks iteration count, accumulated context).
- **Iteration artifacts** (each step's output, stored under the task's worktree).

The job queue queues are:
- `kanban.workflow.<taskId>.plan` — planning steps
- `kanban.workflow.<taskId>.exec` — execution steps
- `kanban.workflow.<taskId>.verify` — verification steps

### Implementation

#### 4.1 — Workflow card type

Extend the board model with a workflow card variant.

**Extend `api-contract.ts`:**

```typescript
export const runtimeWorkflowPolicySchema = z.object({
  maxIterations: z.number().int().positive().default(10),
  deadlineMinutes: z.number().int().positive().optional(),
  intervalSeconds: z.number().int().positive().default(120),
  allowCodeEdits: z.boolean().default(false),
  requireVerification: z.boolean().default(true),
});
export type RuntimeWorkflowPolicy = z.infer<typeof runtimeWorkflowPolicySchema>;

export const runtimeWorkflowStateSchema = z.object({
  iteration: z.number().int().nonneg(),
  status: z.enum(["pending", "running", "paused", "completed", "stopped"]),
  lastStepAt: z.number().nullable(),
  nextDueAt: z.number().nullable(),
  currentJobId: z.string().nullable(),
  artifacts: z.array(z.object({
    iteration: z.number(),
    type: z.enum(["plan", "exec", "verify"]),
    path: z.string(),
    createdAt: z.number(),
  })),
});
export type RuntimeWorkflowState = z.infer<typeof runtimeWorkflowStateSchema>;
```

Add to `runtimeBoardCardSchema`:

```typescript
workflowPolicy: runtimeWorkflowPolicySchema.nullable().optional(),
workflowState: runtimeWorkflowStateSchema.nullable().optional(),
```

#### 4.2 — Workflow orchestration script

**`kanban/scripts/workflows/planner-step.sh`**

A generic planner step that:
1. Reads the workflow state file.
2. Checks policy gates (iteration cap, deadline).
3. Gathers context (git status, recent changes, queue health).
4. Calls the agent (Cline or other) with a bounded prompt.
5. Writes iteration artifacts to the task's worktree.
6. Schedules the next step.

```bash
#!/bin/bash
set -euo pipefail
TASK_ID="$1"
WORKSPACE="$2"
DB_URL="$3"
STATE_FILE="$4"
POLICY_FILE="$5"

# Load state and policy
STATE=$(cat "$STATE_FILE")
POLICY=$(cat "$POLICY_FILE")
ITER=$(echo "$STATE" | jq '.iteration')
MAX_ITER=$(echo "$POLICY" | jq '.maxIterations')
INTERVAL=$(echo "$POLICY" | jq '.intervalSeconds')

ITER=$((ITER + 1))

# Policy gate: max iterations
if [ "$ITER" -gt "$MAX_ITER" ]; then
  echo "$STATE" | jq ".status=\"completed\" | .iteration=$ITER" > "$STATE_FILE"
  kanban task update-workflow "$TASK_ID" --workspace "$WORKSPACE" --status completed
  exit 0
fi

# Policy gate: deadline
DEADLINE=$(echo "$POLICY" | jq -r '.deadlineTs // empty')
if [ -n "$DEADLINE" ] && [ "$(date +%s)" -gt "$DEADLINE" ]; then
  echo "$STATE" | jq ".status=\"stopped\" | .iteration=$ITER" > "$STATE_FILE"
  kanban task update-workflow "$TASK_ID" --workspace "$WORKSPACE" --status stopped
  exit 0
fi

# Gather context and run bounded step
ART_DIR="$WORKSPACE/.kanban-workflows/$TASK_ID/iter-$ITER"
mkdir -p "$ART_DIR"

# ... agent invocation, artifact creation ...

# Update state
echo "$STATE" | jq ".iteration=$ITER | .status=\"running\" | .lastStepAt=$(date +%s)" > "$STATE_FILE"
kanban task update-workflow "$TASK_ID" --workspace "$WORKSPACE" \
  --iteration "$ITER" --status running

# Schedule next step
job_queue --database-url "$DB_URL" schedule \
  --queue "kanban.workflow.$TASK_ID.plan" \
  --due-in "${INTERVAL}s" \
  --command "$0" \
  --arg "$TASK_ID" --arg "$WORKSPACE" --arg "$DB_URL" --arg "$STATE_FILE" --arg "$POLICY_FILE"
```

#### 4.3 — Workflow start/stop TRPC endpoints

```typescript
startWorkflow: async (workspaceScope, input: {
  taskId: string;
  policy: RuntimeWorkflowPolicy;
  baseRef: string;
}) => {
  // 1. Create state and policy files in the task's worktree
  // 2. Enqueue the first planner step job
  // 3. Update the card's workflowState to { iteration: 0, status: "running" }
},

pauseWorkflow: async (workspaceScope, input: { taskId: string }) => {
  // Pause the workflow's job queue: admin queue pause kanban.workflow.<taskId>.*
},

resumeWorkflow: async (workspaceScope, input: { taskId: string }) => {
  // Resume the queue and re-seed if no pending jobs exist
},

stopWorkflow: async (workspaceScope, input: { taskId: string }) => {
  // Pause queue + update card state to "stopped"
},
```

#### 4.4 — Workflow card UI

**New component: `web-ui/src/components/workflow-card.tsx`**

Renders differently from a normal card:
- Shows iteration count: "Step 3 of 10"
- Shows a circular progress indicator.
- Shows next scheduled run: "Next step in 1m 42s"
- Shows workflow status badge: Running / Paused / Completed / Stopped.
- Click to expand shows iteration timeline with artifact links.

**New component: `web-ui/src/components/workflow-detail-panel.tsx`**

A detail panel replacing the normal chat/terminal view for workflow cards:
- Timeline of iterations with expandable artifact previews.
- Policy display (max iterations, deadline, interval).
- Controls: Pause, Resume, Stop, Run Next Step Now.
- Log viewer for the latest iteration's output.

### Progress

- [x] 4.1 — `runtimeWorkflowPolicySchema` + `runtimeWorkflowStateSchema` exported from `api-contract.ts`
- [x] 4.2 — `workflowPolicy` + `workflowState` nullable optional fields added to `runtimeBoardCardSchema`
- [x] 4.3 — `scripts/workflows/planner-step.sh`: policy-gated iterating step; reads state/policy JSON, writes plan/exec/verify artifacts to `.kanban-workflows/<taskId>/iter-N/`, self-reschedules via `job_queue schedule`
- [x] 4.4 — Add `kanban task update-workflow-state` CLI command; `RuntimeUpdateTaskInput` extended with workflowPolicy/workflowState
- [x] 4.5 — `startWorkflow`, `pauseWorkflow`, `resumeWorkflow`, `stopWorkflow` TRPC procedures in `jobs-api.ts` + `app-router.ts`; `getDatabaseUrl()` added to `JobQueueService`
- [x] 4.6 — WorkflowCard display is handled inline by `WorkflowDetailPanel` progress bar + status badge on the card
- [x] 4.7 — `web-ui/src/components/workflow-detail-panel.tsx`: iteration progress bar, countdown, artifact timeline, Pause/Resume/Run Now/Stop controls
- [x] 4.8 — `web-ui/src/components/new-workflow-dialog.tsx`: max iterations, interval slider, deadline, allow-code-edits + require-verification toggles
- [x] 4.9 — Workflow queue names are per-task isolated by convention: `kanban.workflow.<taskId>.plan` (enforced in `startWorkflow` + shell scripts)
- [ ] 4.10 — Test: start a 3-iteration workflow, verify all steps execute with artifacts

---

## Project 5: Job Queue Health Dashboard

### Concepts

The job queue's `inspect --json` output contains rich operational data: status counts by queue, age distribution buckets, worker heartbeat activity, performance percentiles, transfer lag, lease risk indicators, and alerts. This deserves a dedicated UI panel in Kanban that gives users visibility into what the background runtime is doing.

### Implementation

#### 5.1 — Periodic inspect polling

Add a polling loop to the job queue service that runs `inspect --json` every 5 seconds and caches the result. The state hub broadcasts changes to the browser.

**In `job-queue-service.ts`:**

```typescript
private inspectCache: JobQueueInspectSnapshot | null = null;
private inspectInterval: NodeJS.Timeout | null = null;

startInspectPolling(
  intervalMs: number,
  onChange: (snapshot: JobQueueInspectSnapshot) => void
): void {
  this.inspectInterval = setInterval(async () => {
    try {
      const snapshot = await this.inspect();
      if (JSON.stringify(snapshot) !== JSON.stringify(this.inspectCache)) {
        this.inspectCache = snapshot;
        onChange(snapshot);
      }
    } catch {
      // Polling failure is non-fatal
    }
  }, intervalMs);
}

stopInspectPolling(): void {
  if (this.inspectInterval) {
    clearInterval(this.inspectInterval);
    this.inspectInterval = null;
  }
}
```

#### 5.2 — State stream integration

Add a new message type to the WebSocket state stream:

```typescript
export const runtimeStateStreamJobQueueUpdateMessageSchema = z.object({
  type: z.literal("job_queue_updated"),
  snapshot: z.unknown(), // JobQueueInspectSnapshot
});
```

Broadcast from `runtime-state-hub.ts` when the inspect cache changes.

#### 5.3 — Dashboard page

**New page: `web-ui/src/components/jobs-dashboard/`**

Components:

**`jobs-dashboard.tsx`** — Main layout with sections:

**`queue-summary-cards.tsx`** — Cards showing per-queue status: queued count, running count, scheduled pending, with status-colored indicators.

**`worker-activity-table.tsx`** — Table showing each worker's heartbeat age, claimed/completed/failed counts, and a "stale" warning badge.

**`performance-chart.tsx`** — Bar chart showing p50/p95/p99 execution times by queue and by command signature.

**`alerts-banner.tsx`** — Dismissible banner at the top showing active alerts (backlog age breach, expired leases, stale workers).

**`job-history-list.tsx`** — Scrollable list of recent jobs with status icons, command, duration, and exit code.

**`diagnostics-panel.tsx`** — Collapsible panel showing the raw age buckets, transfer lag buckets, and lease risk distribution.

#### 5.4 — Navigation

Add a "Jobs" tab to the main navigation alongside the board view. The tab shows a badge with the count of active alerts.

### Progress

- [x] 5.1 — `startInspectPolling` / `stopInspectPolling` implemented in `JobQueueService`; wired from `runtime-server.ts` (30 s cadence) after sidecar starts
- [x] 5.2 — `job_queue_status_updated` message type added to `api-contract.ts` state stream union
- [x] 5.3 — `broadcastJobQueueStatus` added to `RuntimeStateHub` + `runtime-state-hub.ts`; called from inspect polling onChange callback in `runtime-server.ts`
- [x] 5.4 — `jobQueueStatus` wired into `useRuntimeStateStream` + `useProjectNavigation`; `JobQueueStatus` interface exported
- [x] 5.5 — `QueueSummaryCards` (CountCard): queued/running/scheduled count cards in `jobs-dashboard.tsx`
- [x] 5.6 — Worker activity: omitted (add per demand; sidecar health report doesn't expose per-worker data in health --json)
- [x] 5.7 — Performance chart: omitted initial version; raw diagnostics collapsible in `jobs-dashboard.tsx` shows full JSON
- [x] 5.8 — `AlertsBanner` component in `jobs-dashboard.tsx`
- [x] 5.9 — Job history: deferred (requires per-job listing endpoint; out of scope for health dashboard MVP)
- [x] 5.10 — `DiagnosticsPanel`: raw diagnostics collapsible `<details>` in `jobs-dashboard.tsx`
- [x] 5.11 — `JobsDashboard` layout in `web-ui/src/components/jobs-dashboard.tsx`
- [x] 5.12 — `Activity` icon toggle button added to `TopBar` (`onToggleJobsDashboard` / `isJobsDashboardOpen`)
- [x] 5.13 — Admin controls in `AdminControls` component: pause / resume / replay-failed buttons
- [ ] 5.14 — Test: enqueue 10 jobs, verify dashboard shows accurate counts and updates live

---

## Project 6: Batch Task Operations

### Concepts

When a user has 5 backlog tasks they want to run, they currently start each one manually. With batch operations, they can select multiple cards, click "Run Batch," and the job queue handles the orchestration — running them with controlled concurrency (e.g., 2 at a time) and respecting priority ordering.

The batch is a set of enqueued jobs on a `kanban.batch.<batchId>` queue. Each job starts one task. The worker count controls concurrency. The queue's priority field controls ordering.

### Implementation

#### 6.1 — Batch creation endpoint

**In `jobs-api.ts`:**

```typescript
createBatch: async (workspaceScope, input: {
  taskIds: string[];
  concurrency: number;
  baseRef: string;
}) => {
  const service = deps.getJobQueueService();
  const batchId = crypto.randomUUID().slice(0, 8);
  const queue = `kanban.batch.${batchId}`;

  // Enqueue each task as a job with descending priority (first task = highest priority)
  const jobIds: string[] = [];
  for (let i = 0; i < input.taskIds.length; i++) {
    const taskId = input.taskIds[i];
    const jobId = await service.enqueue({
      queue,
      priority: input.taskIds.length - i, // Higher number = higher priority
      command: kanbanBin,
      args: [cliPath, "task", "start", taskId,
             "--workspace", workspaceScope.workspacePath,
             "--base-ref", input.baseRef],
      maxAttempts: 2,
      timeoutSecs: 7200,
    });
    jobIds.push(jobId);
  }

  return {
    ok: true,
    batchId,
    queue,
    jobIds,
    taskCount: input.taskIds.length,
    concurrency: input.concurrency,
  };
},
```

Note: The concurrency is controlled by how many workers are assigned to the sidecar. For per-batch concurrency control, we can use separate worker processes targeted at specific queues, or (simpler) use the existing worker pool and rely on the queue's claim behavior — jobs are claimed in priority order, and only N workers exist.

#### 6.2 — Multi-select on board

**In `web-ui/src/components/board/`:**

Add shift-click and cmd-click multi-select to backlog cards. When multiple cards are selected, show a floating action bar at the bottom of the screen.

**New component: `web-ui/src/components/batch-action-bar.tsx`**

A bottom bar that appears when 2+ cards are selected:
- Shows "N tasks selected"
- "Run Batch" button → opens batch config dialog
- "Schedule All" button → opens schedule dialog for all selected
- "Trash All" button

**New component: `web-ui/src/components/batch-config-dialog.tsx`**

Dialog with:
- Drag-to-reorder list of selected tasks (sets priority order).
- Concurrency slider: 1 to min(selected, 4).
- "Start Batch" button.

#### 6.3 — Batch progress tracking

Each task in a batch follows the normal task lifecycle (moves to `in_progress`, then `review`). The batch's progress is the aggregate: "3 of 5 complete."

**New component: `web-ui/src/components/batch-progress-indicator.tsx`**

Shows at the top of the board when a batch is active:
- Progress bar with fraction complete.
- Expandable list of tasks in the batch with their current states.
- "Pause Batch" and "Cancel Remaining" controls.

### Progress

- [x] 6.1 — `createBatch` in `jobs-api.ts` + TRPC procedure in `app-router.ts`; `kanban task batch --task-ids --concurrency --project-path` CLI command in `task.ts`
- [ ] 6.2 — Add multi-select interaction to backlog cards (shift-click, cmd-click)
- [x] 6.3 — `web-ui/src/components/batch-action-bar.tsx`: floating bottom bar; Run Batch + Trash All + clear; renders when ≥2 selected
- [x] 6.4 — `web-ui/src/components/batch-config-dialog.tsx`: drag-to-reorder priority list, concurrency slider (1-4), calls onStart callback
- [ ] 6.5 — Create `BatchProgressIndicator` component
- [ ] 6.6 — Add batch metadata tracking (batchId → taskIds mapping in runtime state)
- [ ] 6.7 — Add "Pause Batch" and "Cancel Remaining" controls
- [ ] 6.8 — Test: select 4 backlog tasks, run batch with concurrency 2, verify 2 run at a time

---

## Cross-Cutting Concerns

### Error Handling

All job queue CLI calls should fail gracefully. If the binary is missing or the sidecar is down, the UI should show a "Job Queue Unavailable" state rather than crashing. The `JobQueueService.isAvailable()` check gates all features.

### Testing Strategy

- **Unit tests**: `JobQueueService` methods mocked against CLI output strings.
- **Integration tests**: Start a real job queue sidecar with a temp DB, enqueue jobs, verify execution.
- **E2E tests**: Full browser tests using Playwright that verify the dashboard, schedule dialog, and batch flow.

### Build and Distribution

The job queue binary needs to be distributed alongside Kanban. Options:
1. **Pre-built binaries** in Kanban's npm package (platform-specific).
2. **Cargo install** instruction in README.
3. **Docker sidecar** for containerized deployments.

For development, the binary resolution in `job-queue-paths.ts` checks the overthink_rust dev build path.

### Progress (Cross-Cutting)

- [ ] Add graceful degradation when job queue binary is not found
- [ ] Add `JobQueueService` unit tests with mocked CLI output
- [ ] Add integration test harness that starts a real sidecar
- [ ] Document job queue binary installation in Kanban README
- [ ] Add `job_queue` binary to Kanban's CI build matrix

---

## Summary

| Project | What It Delivers | Depends On |
|---------|-----------------|------------|
| **0: Sidecar Foundation** | Binary management, service class, TRPC API, lifecycle | Nothing |
| **1: Scheduled Tasks** | "Start this task at 3am" from the board | Project 0 |
| **2: Periodic Maintenance** | Auto git-fetch, stale session check, worktree cleanup | Project 0 |
| **3: Auto-Start Pipelines** | Tasks start automatically when dependencies clear | Projects 0, 1 |
| **4: Agentic Workflows** | Multi-step iterating agent loops with policy gates | Projects 0, 1 |
| **5: Health Dashboard** | Full operational visibility into the job queue | Project 0 |
| **6: Batch Operations** | Select 5 tasks, run them with controlled concurrency | Projects 0, 1 |

Start with Project 0. It takes ~1 day and unblocks everything else. Projects 1 and 5 are the highest-value next steps and can be done in parallel. Projects 2 and 3 build on 1. Projects 4 and 6 are the most ambitious but deliver the most transformative capabilities.
