# Automation Agents Platform — Implementation Plan

This document describes the complete implementation path for building a **local automation agent platform** on top of Kanban's job queue integration. The platform enables autonomous, self-driven agents that periodically inspect work, detect issues, and create or start follow-up tasks — all running locally on the user's machine with strong guardrails against runaway activity.

The first agent built on this platform is the **Quality Enforcer**: a recurring automation that watches for code quality gaps (failing tests, missing coverage, lint/type errors, stale reviews) and creates Kanban tasks to fix them. But the platform is designed from the start to support **myriad agent types** — any automation that follows the pattern of _trigger → analyze → decide → act on the board_.

**Prerequisite:** The [Job Queue Integration Plan](./JOB_QUEUE_INTEGRATION_PLAN.md) must be fully implemented and verified before starting this work. This plan assumes all six projects (Sidecar Foundation, Scheduled Tasks, Periodic Maintenance, Dependency Pipelines, Agentic Workflows, Health Dashboard, Batch Operations) are complete and stable.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project A: Automation Agent Platform Foundation](#project-a-automation-agent-platform-foundation)
3. [Project B: Detection Pipeline Engine](#project-b-detection-pipeline-engine)
4. [Project C: Anti-Runaway Guardrail System](#project-c-anti-runaway-guardrail-system)
5. [Project D: Quality Enforcer — First Agent](#project-d-quality-enforcer--first-agent)
6. [Project E: Automation Management UI](#project-e-automation-management-ui)
7. [Project F: Observability and Audit Trail](#project-f-observability-and-audit-trail)
8. [Project G: Verification and Testing](#project-g-verification-and-testing)
9. [Future Agent Types](#future-agent-types)
10. [Summary](#summary)

---

## Architecture Overview

### The Automation Agent Model

An automation agent is a **recurring job-queue job** that runs a structured pipeline: collect evidence, evaluate rules, produce findings, enforce budgets, and take board actions. Every agent shares the same execution substrate (the job queue sidecar), the same guardrail system (budgets, deduplication, cooldowns, tripwires), and the same observability infrastructure (audit log, dashboard, state stream).

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Kanban Automation Platform                       │
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐   │
│  │   Quality   │  │  Dependency │  │   Release   │  │  Custom   │   │
│  │  Enforcer   │  │   Updater   │  │  Readiness  │  │  Agent N  │   │
│  └──────┬───── ┘  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘   │
│         │                │                │                │        │
│  ┌──────▼────────────────▼────────────────▼────────────────▼─────┐  │
│  │              Detection Pipeline Engine (shared)               │  │
│  │  trigger → collect → evaluate → normalize → dedupe → act      │  │
│  └───────────────────────────────┬───────────────────────────────┘  │
│                                  │                                  │
│  ┌───────────────────────────────▼───────────────────────────────┐  │
│  │              Guardrail System (shared)                        │  │
│  │  budgets · cooldowns · dedup · loop prevention · tripwires    │  │
│  └───────────────────────────────┬───────────────────────────────┘  │
│                                  │                                  │
│  ┌───────────────────────────────▼───────────────────────────────┐  │
│  │              Job Queue Sidecar (existing)                     │  │
│  │  queues · workers · scheduling · admin · inspect              │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              Kanban Board + TRPC API (existing)               │  │
│  │  task creation · card metadata · sessions · state stream      │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Agents are data, not code plugins.** Each agent type is a configuration object (template + rules + policy) stored in the automation registry. Adding a new agent type does not require new code — only a new rule set and template. This keeps the platform extensible without growing the codebase linearly.

2. **Deterministic signals first, agentic reasoning second.** The detection pipeline runs cheap, deterministic checks (test exit codes, lint output, git diff stats) before optionally invoking an LLM for deeper analysis. This prevents agents from being noisy or expensive by default.

3. **Every action is budget-gated.** No agent can create tasks, start sessions, or schedule work without passing through the guardrail system. Budgets are enforced per-agent, per-project, and globally. This is the primary defense against runaway self-generated activity.

4. **The board is the single source of truth.** Agents read board state to understand what work exists, and write to the board to create new work. They never bypass the board to start processes directly. This ensures the user always sees what's happening.

5. **Provenance is mandatory.** Every task created by an automation agent carries metadata identifying which agent created it, which finding triggered it, and what evidence supported the decision. This makes the system auditable and debuggable.

---

## Project A: Automation Agent Platform Foundation

This project builds the shared data model, persistence layer, and registry that all automation agents use. It's the equivalent of Project 0 (Sidecar Foundation) from the job queue plan — everything else depends on it.

### Concepts

The platform needs three core abstractions:

- **Agent Template**: a reusable type definition describing what an agent does, what rules it evaluates, and what actions it can take. Think of it as the "class" — e.g., "Quality Enforcer" or "Dependency Updater."
- **Agent Instance**: a configured, scoped copy of a template — e.g., "Quality Enforcer for project kanban, running every 15 minutes, allowed to create backlog tasks but not auto-start them." Think of it as an "object" instantiated from the class.
- **Finding**: a structured quality/issue report produced by a scan. Findings are the intermediate output between detection and action. They carry a stable fingerprint for deduplication and enough evidence for the user to understand why an action was taken.

These three concepts, plus the guardrail system (Project C), form the shared foundation.

### A.1 — Domain types

Create the core type definitions that the entire automation platform shares.

**New file: `src/automations/automation-types.ts`**

This file defines the Zod schemas and TypeScript types for the platform. It is the single source of truth for the shape of agent templates, instances, findings, and remediation records.

```typescript
// src/automations/automation-types.ts
//
// Core domain types for the Kanban Automation Agent Platform.
// All automation agents — Quality Enforcer, Dependency Updater, etc. —
// share these types.  The schemas are used for validation, persistence,
// and TRPC serialization.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Agent Template — the "class" definition for an agent type
// ---------------------------------------------------------------------------

/**
 * An AutomationAgentTemplate defines what an agent type *is*: its identity,
 * the rules it evaluates, and the action repertoire it has.  Templates are
 * registered at boot time and are immutable at runtime.  Users create
 * *instances* of templates to activate them for specific projects.
 */
export const automationAgentTemplateSchema = z.object({
  /** Unique slug identifier, e.g. "quality-enforcer", "dependency-updater". */
  id: z.string().min(1),
  /** Human-readable display name. */
  name: z.string().min(1),
  /** One-paragraph description of what this agent does. */
  description: z.string(),
  /** Semantic version of this template definition. */
  version: z.string().default("1.0.0"),
  /** IDs of the detection rules this agent evaluates.  Order matters —
   *  rules are evaluated in sequence and the pipeline short-circuits on
   *  budget exhaustion. */
  ruleIds: z.array(z.string()),
  /** The set of actions this template's instances are *allowed* to take.
   *  Instance-level policy can only restrict, never expand, this set. */
  allowedActions: z.array(
    z.enum([
      "create_backlog_task",
      "schedule_task",
      "auto_start_task",
      "link_to_existing_task",
      "add_finding_comment",
    ])
  ),
  /** Default policy values.  Instances inherit these unless overridden. */
  defaultPolicy: z.object({
    scanIntervalSeconds: z.number().int().positive(),
    maxFindingsPerScan: z.number().int().positive(),
    maxTasksCreatedPerHour: z.number().int().positive(),
    maxAutoStartsPerHour: z.number().int().nonneg(),
    cooldownMinutes: z.number().int().positive(),
    severityThreshold: z.enum(["info", "warning", "error", "critical"]),
  }),
});
export type AutomationAgentTemplate = z.infer<
  typeof automationAgentTemplateSchema
>;

// ---------------------------------------------------------------------------
// Agent Instance — a configured, scoped activation of a template
// ---------------------------------------------------------------------------

/**
 * An AutomationAgentInstance is a running (or paused) copy of a template,
 * scoped to one or more projects.  It stores the user's policy overrides
 * and the runtime state needed for scheduling and budgeting.
 */
export const automationAgentInstanceSchema = z.object({
  /** Unique instance ID (UUID). */
  id: z.string().uuid(),
  /** The template this instance was created from. */
  templateId: z.string().min(1),
  /** Human-readable label, e.g. "Quality Enforcer — kanban". */
  label: z.string().min(1),
  /** Project paths this instance is scoped to.  Empty = all indexed projects. */
  projectPaths: z.array(z.string()),
  /** Whether this instance is actively scanning. */
  enabled: z.boolean(),
  /** Policy overrides.  Merged with the template's defaultPolicy at runtime.
   *  Only the keys present here override the template defaults. */
  policyOverrides: z
    .object({
      scanIntervalSeconds: z.number().int().positive().optional(),
      maxFindingsPerScan: z.number().int().positive().optional(),
      maxTasksCreatedPerHour: z.number().int().positive().optional(),
      maxAutoStartsPerHour: z.number().int().nonneg().optional(),
      cooldownMinutes: z.number().int().positive().optional(),
      severityThreshold: z
        .enum(["info", "warning", "error", "critical"])
        .optional(),
      /** Actions this instance is restricted to (must be subset of template's
       *  allowedActions).  null = use template's full set. */
      allowedActions: z
        .array(
          z.enum([
            "create_backlog_task",
            "schedule_task",
            "auto_start_task",
            "link_to_existing_task",
            "add_finding_comment",
          ])
        )
        .nullable()
        .optional(),
    })
    .optional(),
  /** When this instance was created.  Unix ms. */
  createdAt: z.number(),
  /** When this instance was last modified.  Unix ms. */
  updatedAt: z.number(),
});
export type AutomationAgentInstance = z.infer<
  typeof automationAgentInstanceSchema
>;

// ---------------------------------------------------------------------------
// Finding — a detected issue from a scan
// ---------------------------------------------------------------------------

/**
 * Severity levels for findings, from least to most urgent.
 *
 * - info:     Observation only; no action taken unless policy is aggressive.
 * - warning:  Worth noting; may create a backlog task.
 * - error:    Concrete failure; should create a task.
 * - critical: Urgent failure; eligible for auto-start remediation.
 */
export const findingSeveritySchema = z.enum([
  "info",
  "warning",
  "error",
  "critical",
]);
export type FindingSeverity = z.infer<typeof findingSeveritySchema>;

/**
 * A Finding is a normalized quality/issue report produced by a detection
 * rule during a scan.  Findings carry a stable fingerprint so the guardrail
 * system can deduplicate and apply cooldowns across scans.
 *
 * Findings are the bridge between detection and action.  The pipeline
 * creates findings; the guardrail system decides what to do with them.
 */
export const automationFindingSchema = z.object({
  /** Unique ID for this specific finding occurrence (UUID). */
  id: z.string().uuid(),
  /** Stable content-based fingerprint for deduplication.
   *  Same root cause → same fingerprint across scans.
   *  Built from: ruleId + projectPath + normalized evidence key. */
  fingerprint: z.string().min(1),
  /** The detection rule that produced this finding. */
  ruleId: z.string().min(1),
  /** Which agent instance produced this finding. */
  instanceId: z.string().uuid(),
  /** The template the instance belongs to. */
  templateId: z.string().min(1),
  /** Project path where the finding was detected. */
  projectPath: z.string(),
  /** Severity as assessed by the detection rule. */
  severity: findingSeveritySchema,
  /** Short human-readable title, suitable for a Kanban card title.
   *  e.g. "Failing tests in src/server/job-queue-service.ts" */
  title: z.string().min(1),
  /** Longer description with evidence details. */
  description: z.string(),
  /** Category tag for grouping, e.g. "failing-tests", "missing-coverage",
   *  "lint-errors", "type-errors", "stale-review". */
  category: z.string().min(1),
  /** Affected file paths, if applicable. */
  affectedFiles: z.array(z.string()),
  /** Raw evidence: command output, diff excerpts, etc.
   *  Stored as a key-value map so different rule types can attach
   *  different evidence without a rigid schema. */
  evidence: z.record(z.string(), z.string()),
  /** When this finding was first detected.  Unix ms. */
  firstSeenAt: z.number(),
  /** When this finding was most recently detected.  Unix ms. */
  lastSeenAt: z.number(),
  /** Lifecycle status of the finding. */
  status: z.enum([
    "open",
    "task_created",
    "task_started",
    "resolved",
    "suppressed",
  ]),
  /** If a task was created for this finding, the Kanban task ID. */
  linkedTaskId: z.string().nullable(),
});
export type AutomationFinding = z.infer<typeof automationFindingSchema>;

// ---------------------------------------------------------------------------
// Remediation Record — tracks what happened after a finding
// ---------------------------------------------------------------------------

/**
 * A RemediationRecord tracks the lifecycle of a finding-to-task action.
 * It answers: "we found issue X, we created task Y — did it work?"
 */
export const remediationRecordSchema = z.object({
  /** Finding fingerprint this remediation addresses. */
  findingFingerprint: z.string().min(1),
  /** The Kanban task ID created for remediation. */
  taskId: z.string(),
  /** When the remediation task was created.  Unix ms. */
  createdAt: z.number(),
  /** When the last attempt was made (task started or restarted).  Unix ms. */
  lastAttemptAt: z.number(),
  /** How many times a remediation task has been started for this finding. */
  attemptCount: z.number().int().nonneg(),
  /** Current state of remediation. */
  state: z.enum(["pending", "active", "resolved", "abandoned"]),
});
export type RemediationRecord = z.infer<typeof remediationRecordSchema>;

// ---------------------------------------------------------------------------
// Detection Rule — defines how to detect a specific kind of issue
// ---------------------------------------------------------------------------

/**
 * A DetectionRule defines one specific check that can be evaluated during
 * a scan.  Rules are registered in the rule catalog and referenced by
 * agent templates via ruleIds.
 *
 * Rules are split into two tiers:
 * - deterministic: runs a shell command and inspects the exit code / output.
 * - heuristic: invokes an LLM or agent for deeper analysis (more expensive,
 *   subject to stricter budget controls).
 */
export const detectionRuleSchema = z.object({
  /** Unique rule identifier, e.g. "failing-tests", "missing-test-coverage". */
  id: z.string().min(1),
  /** Human-readable name. */
  name: z.string().min(1),
  /** Description of what this rule detects. */
  description: z.string(),
  /** Whether this rule is deterministic (cheap shell command) or heuristic
   *  (requires LLM invocation). */
  tier: z.enum(["deterministic", "heuristic"]),
  /** The category tag to assign to findings from this rule. */
  category: z.string().min(1),
  /** Default severity for findings from this rule.
   *  Can be overridden by the rule's evaluate function based on evidence. */
  defaultSeverity: findingSeveritySchema,
  /** How to build the finding fingerprint from evidence.
   *  A template string with {{placeholders}} that are filled from evidence keys.
   *  e.g. "failing-tests:{{projectPath}}:{{testSuite}}" */
  fingerprintTemplate: z.string().min(1),
  /** Template for the Kanban task title when a finding triggers task creation. */
  taskTitleTemplate: z.string().min(1),
  /** Template for the Kanban task prompt/description. */
  taskPromptTemplate: z.string().min(1),
  /** Whether findings from this rule are eligible for auto-start remediation. */
  autoStartEligible: z.boolean(),
  /** Minimum cooldown override for this rule, in minutes.
   *  If set, overrides the instance-level cooldown for findings from this rule. */
  minCooldownMinutes: z.number().int().positive().nullable(),
});
export type DetectionRule = z.infer<typeof detectionRuleSchema>;

// ---------------------------------------------------------------------------
// Scan Run — a record of one automation scan execution
// ---------------------------------------------------------------------------

/**
 * A ScanRun records what happened during one invocation of an agent's
 * detection pipeline.  It's the primary unit of the audit trail.
 */
export const scanRunSchema = z.object({
  /** Unique run ID (UUID). */
  id: z.string().uuid(),
  /** The agent instance that ran this scan. */
  instanceId: z.string().uuid(),
  /** Template used. */
  templateId: z.string(),
  /** When the scan started.  Unix ms. */
  startedAt: z.number(),
  /** When the scan completed.  Unix ms.  null if still running. */
  completedAt: z.number().nullable(),
  /** Projects scanned in this run. */
  projectsScanned: z.array(z.string()),
  /** Rules evaluated. */
  rulesEvaluated: z.array(z.string()),
  /** Total findings produced (before dedup/budget filtering). */
  rawFindingsCount: z.number().int().nonneg(),
  /** Findings after dedup/budget filtering. */
  newFindingsCount: z.number().int().nonneg(),
  /** Findings suppressed by dedup. */
  suppressedCount: z.number().int().nonneg(),
  /** Tasks created in response to findings. */
  tasksCreated: z.number().int().nonneg(),
  /** Tasks auto-started. */
  tasksAutoStarted: z.number().int().nonneg(),
  /** Whether a tripwire was triggered during this scan. */
  tripwireTriggered: z.boolean(),
  /** If tripwire triggered, which one. */
  tripwireReason: z.string().nullable(),
  /** Run outcome. */
  outcome: z.enum(["success", "partial", "tripwire_halt", "error"]),
  /** Error message if outcome is "error". */
  errorMessage: z.string().nullable(),
});
export type ScanRun = z.infer<typeof scanRunSchema>;
```

This is a large file, but every type is load-bearing: templates and instances are the user-facing configuration surface; findings and remediation records are the core domain objects that flow through the pipeline; detection rules are the extensibility mechanism; scan runs are the audit trail.

### A.2 — Automation persistence store

Create a lightweight persistence layer for automation state. This stores agent instances, findings, remediation records, and scan run history.

**New file: `src/automations/automation-store.ts`**

The store uses JSON files under `~/.kanban/automations/` for simplicity and debuggability. Each data type gets its own file: `instances.json`, `findings.json`, `remediations.json`, `scan-runs.json`. The `lockedFileSystem` utility (already used by Kanban's config system) provides atomic reads and writes with file locking.

The store exposes a small, focused API:

```
// Read operations
listInstances(): AutomationAgentInstance[]
getInstance(id): AutomationAgentInstance | null
listFindings(filters): AutomationFinding[]
getFinding(fingerprint): AutomationFinding | null
getRemediation(fingerprint): RemediationRecord | null
listScanRuns(instanceId, limit): ScanRun[]

// Write operations
saveInstance(instance): void
deleteInstance(id): void
upsertFinding(finding): void     // insert or update by fingerprint
saveRemediation(record): void
saveScanRun(run): void
purgeScanRuns(olderThanMs): number  // cleanup old audit records
```

Key design choice: findings are upserted by fingerprint, not inserted. When a scan detects the same issue again, it updates `lastSeenAt` and `status` on the existing finding rather than creating a duplicate. This is the persistence-level half of the deduplication system (the other half is in the guardrail engine, Project C).

### A.3 — Agent template registry

Create an in-memory registry of agent templates. Templates are registered at Kanban boot time. For v1, templates are defined in code (one file per agent type). In the future, this could support user-defined templates loaded from config files.

**New file: `src/automations/template-registry.ts`**

```
// Register a template at boot time
registerTemplate(template: AutomationAgentTemplate): void

// Look up templates
getTemplate(id: string): AutomationAgentTemplate | null
listTemplates(): AutomationAgentTemplate[]
```

The Quality Enforcer template is registered in Project D. Other templates are registered in the `Future Agent Types` section.

### A.4 — Automation service

Create the top-level service class that orchestrates the platform. This is the Node-side equivalent of `JobQueueService` — the single entry point that the TRPC API and the scan pipeline call.

**New file: `src/automations/automation-service.ts`**

The `AutomationService` owns:
- The template registry.
- The persistence store.
- Instance lifecycle management (create, update, enable, disable, delete).
- Scan scheduling (seeds recurring scan jobs into the job queue for each enabled instance).
- The bridge between the detection pipeline output and the guardrail system.

```
class AutomationService {
  constructor(
    jobQueueService: JobQueueService,
    store: AutomationStore,
    registry: TemplateRegistry,
    guardrails: GuardrailEngine  // from Project C
  )

  // Instance management
  createInstance(templateId, label, projectPaths, policyOverrides?): instance
  updateInstance(id, updates): instance
  enableInstance(id): void
  disableInstance(id): void
  deleteInstance(id): void
  listInstances(): instance[]

  // Scan lifecycle
  seedScanJobs(): void           // Called at boot; schedules recurring scans
  executeScan(instanceId): ScanRun  // Called by the scan job; runs the pipeline

  // Querying
  getInstanceStatus(id): { lastRun, nextRun, findingsCount, ... }
  getActiveFindingsForProject(projectPath): Finding[]
}
```

### A.5 — Job queue topology

Define the queue naming convention for automation agents:

```
kanban.automation.scan.<instanceId>      — the recurring scan job
kanban.automation.analyze.<instanceId>   — optional deeper analysis (heuristic rules)
kanban.automation.remediate.<instanceId> — task creation / start orchestration
```

This isolates automation work from user-initiated task queues (`kanban.tasks`, `kanban.batch.*`) and from infrastructure maintenance (`kanban.maintenance`). The queue isolation ensures that automation agents can never starve normal board operations of worker capacity.

### A.6 — Wire into Kanban server lifecycle

In `runtime-server.ts`, after the job queue sidecar starts and maintenance jobs are seeded:
1. Instantiate `AutomationService`.
2. Call `automationService.seedScanJobs()` to schedule recurring scans for all enabled instances.
3. Store the service reference for TRPC handler injection.

In `shutdown-coordinator.ts`, during shutdown:
1. The automation service does not need explicit cleanup — the job queue sidecar handles in-flight jobs.

### Progress

- [x] A.1 — Create `src/automations/automation-types.ts` with all Zod schemas and TypeScript types
- [x] A.2 — Create `src/automations/automation-store.ts` with JSON-file-backed persistence
- [x] A.3 — Create `src/automations/template-registry.ts` with boot-time registration
- [x] A.4 — Create `src/automations/automation-service.ts` with instance management + scan scheduling
- [x] A.5 — Define queue naming convention; document in code comments on `automation-service.ts`
- [x] A.6 — Wire `AutomationService` into `runtime-server.ts` and inject into TRPC context

---

## Project B: Detection Pipeline Engine

This project builds the shared execution engine that all agent scans run through. The pipeline is the core loop: trigger → collect evidence → evaluate rules → produce findings → hand off to guardrails → take action.

### Concepts

The detection pipeline is designed as a **staged, short-circuiting pipeline**. Each stage can halt the pipeline if a budget or tripwire condition is met. This prevents expensive scans from running when the system is already over-budget or when prior stages have already consumed the allowed quota.

The pipeline is **agent-agnostic**: it receives a rule set and policy from the agent instance, runs the rules, and returns findings. The pipeline doesn't know or care whether it's running a quality check or a dependency audit. Agent-specific behavior lives entirely in the detection rules.

### B.1 — Pipeline stages

**New file: `src/automations/detection-pipeline.ts`**

The pipeline has seven stages, executed in order:

**Stage 1: Scope Resolution**
Determines which projects and which files to inspect for this scan. Reads the instance's `projectPaths` config. If empty, reads all indexed projects from the workspace registry. For each project, determines the time window of changes since the last scan (using the scan run history from the store).

```
Input:  instance config, store (last scan time)
Output: Array<{ projectPath, changedFilesSinceLastScan, lastScanAt }>
```

**Stage 2: Evidence Collection**
For each project in scope, runs the evidence-gathering commands that the rules need. Evidence collection is batched — if multiple rules need `npm test` output, the command runs once and the output is shared.

The evidence collector knows how to run:
- `git diff --stat` (changed files)
- `git log --oneline` (recent commits)
- Test suites (`npm test`, `npx vitest run`, `cargo test`, etc.)
- Linters (`npx eslint`, `npx biome check`, etc.)
- Type checkers (`npx tsc --noEmit`, etc.)
- Board state queries (via Kanban TRPC — session status, card metadata)

Each evidence type is a small, focused collector function:

```typescript
interface EvidenceCollector {
  id: string;                                  // e.g. "test-results", "lint-output"
  requiredByRules: string[];                   // which rules need this evidence
  collect(context: ScanContext): Promise<Record<string, string>>;
}
```

```
Input:  scope, rule IDs (to determine which collectors to run)
Output: Map<projectPath, Map<evidenceType, evidenceData>>
```

**Stage 3: Rule Evaluation**
Iterates through the agent's rule IDs in order. For each rule, calls the rule's `evaluate` function with the collected evidence. Each rule returns zero or more raw findings.

Rules are split into two tiers:
- **Deterministic rules** inspect evidence data directly (string parsing, regex matching, exit code checking). They are fast and cheap.
- **Heuristic rules** may invoke an LLM via the Cline SDK for deeper analysis. They are slow and expensive, and are only invoked if:
  1. The instance's policy allows heuristic evaluation.
  2. The budget for heuristic evaluations has not been exhausted.
  3. Deterministic rules produced signals that justify deeper investigation.

```
Input:  evidence map, rule definitions
Output: Array<RawFinding>  (pre-normalization, pre-dedup)
```

**Stage 4: Finding Normalization**
Converts raw rule outputs into structured `AutomationFinding` objects. Computes the fingerprint for each finding using the rule's `fingerprintTemplate`. Sets `firstSeenAt` / `lastSeenAt` by checking the store for existing findings with the same fingerprint.

```
Input:  raw findings
Output: Array<AutomationFinding>  (with stable fingerprints)
```

**Stage 5: Guardrail Gate**
Hands the normalized findings to the guardrail engine (Project C). The guardrails decide, for each finding:
- Is this a duplicate of an existing open finding? → update lastSeenAt, don't create a new task.
- Is this finding within cooldown? → suppress.
- Has the agent exceeded its task-creation budget this hour? → suppress.
- Has a tripwire been triggered? → halt the entire pipeline.

```
Input:  normalized findings, guardrail engine
Output: Array<{ finding, action }>  where action is "create_task" | "update_existing" | "suppress" | "halt"
```

**Stage 6: Action Execution**
For findings that passed the guardrail gate with a `create_task` or `auto_start_task` action:
1. Create a Kanban backlog card via the workspace TRPC API.
2. Set provenance metadata on the card: `createdByAutomation: instanceId`, `findingFingerprint: ...`.
3. If the action is `auto_start_task` and the policy allows it, schedule immediate start via the job queue.
4. Update the finding's status to `task_created` or `task_started`.
5. Create a remediation record in the store.

```
Input:  approved finding-action pairs
Output: Array<{ finding, taskId, action }>
```

**Stage 7: Audit Recording**
Write the scan run record to the store. Update finding states. Emit a state stream event so the UI updates.

```
Input:  scan context, findings, actions, any errors
Output: ScanRun record
```

### B.2 — Rule implementation interface

Each detection rule has a corresponding `evaluate` function. Rules are registered alongside the template in a rule catalog.

**New file: `src/automations/rule-catalog.ts`**

```typescript
interface RuleEvaluator {
  /** The rule definition (metadata). */
  rule: DetectionRule;
  /** Evaluate this rule against collected evidence for one project.
   *  Returns zero or more raw findings. */
  evaluate(context: {
    projectPath: string;
    evidence: Map<string, string>;
    boardState: { cards: RuntimeBoardCard[]; sessions: Record<string, RuntimeTaskSessionSummary> };
  }): Promise<RawFinding[]>;
}
```

The rule catalog is a registry of `RuleEvaluator` objects, keyed by rule ID. Templates reference rules by ID; the pipeline looks them up in the catalog at evaluation time.

### B.3 — Evidence collector registry

**New file: `src/automations/evidence-collectors.ts`**

Registers the built-in evidence collectors:

| Collector ID | What it collects | Shell command |
|---|---|---|
| `git-diff-stat` | Changed files since last scan | `git diff --stat HEAD~N` |
| `git-recent-commits` | Recent commit messages | `git log --oneline -20` |
| `test-results` | Test suite output + exit code | `npm test 2>&1` / `npx vitest run 2>&1` |
| `lint-output` | Linter findings | `npx biome check . 2>&1` or `npx eslint . 2>&1` |
| `typecheck-output` | Type checker output | `npx tsc --noEmit 2>&1` |
| `board-state` | Current board cards + sessions | TRPC query (not a shell command) |
| `workspace-metadata` | Worktree health, stale sessions | TRPC query |

Each collector is a function that runs in the project's working directory and returns a `Record<string, string>` of evidence key-value pairs. The pipeline only runs collectors that are needed by the active rules (determined by cross-referencing `rule.id` with `collector.requiredByRules`).

### B.4 — Scan job script

The recurring scan job is a shell-command job in the job queue, just like the maintenance jobs. But instead of a bash script, it calls a Kanban CLI subcommand that invokes the pipeline in-process.

**New CLI subcommand: `kanban automation run-scan --instance-id <id>`**

This command:
1. Connects to the running Kanban server via TRPC.
2. Calls `automation.executeScan({ instanceId })`.
3. Exits 0 on success, non-zero on error.
4. The scan job self-reschedules for the next interval, just like maintenance jobs.

Alternatively, the scan can be triggered directly from the TRPC API (for "Run Now" from the UI).

### Progress

- [x] B.1 — Create `src/automations/detection-pipeline.ts` with the 7-stage pipeline
- [x] B.2 — Create `src/automations/rule-catalog.ts` with the rule evaluator interface and registry
- [x] B.3 — Create `src/automations/evidence-collectors.ts` with built-in collectors
- [x] B.4 — `triggerScan` via TRPC (scan run via `automationService.executeScan`); CLI subcommand deferred — UI covers the "Run Now" use case
- [x] B.5 — Self-rescheduling pattern implemented in `AutomationService.seedScanJobs()` / `executeScan()`

---

## Project C: Anti-Runaway Guardrail System

This is the most important project in the entire plan. The guardrail system is the central defense against runaway self-generated activity — the primary failure mode of autonomous local agents.

### Concepts

The guardrail system is a stateful decision engine that sits between the detection pipeline and the action executor. For every finding the pipeline produces, the guardrails answer one question: **"Should we act on this, and if so, how aggressively?"**

The system enforces five categories of control:

1. **Deduplication**: Same root cause → same fingerprint → don't create another task.
2. **Budgets**: Rate limits on task creation and auto-starts, per-agent and globally.
3. **Cooldowns**: After acting on a finding, don't re-act for N minutes even if it's still detected.
4. **Loop Prevention**: Never create tasks about your own tasks; cap recursive remediation chains.
5. **Tripwires**: Emergency brakes that disable an agent entirely when something looks wrong.

### C.1 — Guardrail engine

**New file: `src/automations/guardrail-engine.ts`**

The `GuardrailEngine` is a class that maintains in-memory budget counters (refreshed from the store on each scan) and exposes a single decision method:

```typescript
class GuardrailEngine {
  constructor(store: AutomationStore)

  /**
   * Evaluate a batch of findings from a single scan and decide what
   * action (if any) to take for each one.
   *
   * Returns a decision for each finding:
   * - "create_task": create a new backlog card
   * - "auto_start_task": create + immediately start
   * - "update_existing": finding already has a task; update lastSeenAt
   * - "suppress": finding blocked by budget/cooldown/dedup
   * - "halt": tripwire triggered; stop the entire scan
   *
   * The decisions array may be shorter than the findings array if a
   * tripwire halts processing mid-batch.
   */
  evaluateFindings(
    findings: AutomationFinding[],
    instance: AutomationAgentInstance,
    template: AutomationAgentTemplate,
    policy: ResolvedPolicy  // template defaults merged with instance overrides
  ): GuardrailDecision[]
}

interface GuardrailDecision {
  finding: AutomationFinding;
  action: "create_task" | "auto_start_task" | "update_existing" | "suppress" | "halt";
  reason: string;  // human-readable explanation for audit trail
}
```

### C.2 — Deduplication logic

When a finding arrives, the engine checks the store for an existing finding with the same fingerprint:

- **Fingerprint match + status is "open" or "task_created"**: The issue is already known and either awaiting action or has a task. Decision: `update_existing` (update `lastSeenAt`).
- **Fingerprint match + status is "task_started"**: A remediation task is actively running. Decision: `suppress` (don't interfere; check the remediation record's `attemptCount` for the loop prevention check).
- **Fingerprint match + status is "resolved"**: The issue was previously fixed. If it's re-appearing, treat it as a new finding (reset status to "open"). Decision: proceed to budget check.
- **Fingerprint match + status is "suppressed"**: The user manually suppressed this finding. Decision: `suppress`.
- **No fingerprint match**: New finding. Decision: proceed to budget check.

The fingerprint is computed from the rule's `fingerprintTemplate` with placeholders filled from evidence. For example, `"failing-tests:{{projectPath}}:{{testFile}}"` produces `"failing-tests:/Users/x/kanban:src/server/foo.test.ts"`. This ensures that the same failing test in the same project always maps to the same fingerprint, regardless of when or how many times the scan runs.

### C.3 — Budget enforcement

Budgets are rate limits with sliding windows. The engine tracks:

| Budget | Window | Scope | Effect when exhausted |
|--------|--------|-------|----------------------|
| `maxTasksCreatedPerHour` | 60 min | per-instance | All remaining findings in this scan → `suppress` |
| `maxAutoStartsPerHour` | 60 min | per-instance | Auto-start findings downgrade to `create_task` |
| `globalMaxTasksPerHour` | 60 min | all instances | All remaining findings in this scan → `suppress` |
| `globalMaxAutoStartsPerHour` | 60 min | all instances | All auto-starts → `create_task` |
| `maxFindingsPerScan` | per-scan | per-instance | Pipeline stops evaluating rules after this count |

Budget counters are loaded from the store at the start of each scan (count of tasks created / auto-started in the last 60 minutes for this instance, and globally). They are updated in memory as decisions are made within the current scan, then persisted at the end.

Global budgets are a safety net above instance-level budgets. They prevent a situation where 10 enabled instances each create 5 tasks per hour, resulting in 50 tasks per hour globally.

### C.4 — Cooldown enforcement

After a finding triggers task creation, the finding enters a cooldown period. During cooldown, the same fingerprint is suppressed even if the issue is still detected.

Cooldown logic:
1. Look up the existing finding by fingerprint.
2. If the finding has a `linkedTaskId` and the remediation record shows `lastAttemptAt` within the cooldown window → `suppress`.
3. The cooldown window is `max(instance.policy.cooldownMinutes, rule.minCooldownMinutes ?? 0)`.

Cooldowns prevent the enforcer from repeatedly creating fix tasks for an issue that takes time to resolve. The cooldown resets when evidence changes materially (detected by a change in the finding's evidence hash).

### C.5 — Loop prevention

The most critical guardrail. This prevents an agent from creating tasks about its own tasks, or from entering a recursive chain where fixing one issue creates another issue that triggers another fix.

Rules:
1. **Self-referencing exclusion**: When evaluating board state, the pipeline filters out cards whose `createdByAutomation` metadata matches the current instance ID. The agent never inspects its own remediation tasks.
2. **Cross-agent chain cap**: If a finding's `affectedFiles` overlap with changes made by a remediation task from any agent, the finding is tagged as "chain depth N." If N exceeds a configurable maximum (default: 2), the finding is suppressed.
3. **Remediation attempt cap**: If a finding's remediation record shows `attemptCount >= maxRemediationAttempts` (default: 3), the finding is downgraded: it can no longer trigger `auto_start_task`, only `create_task`. After `attemptCount >= maxAbandonAttempts` (default: 5), it is moved to `abandoned` status and permanently suppressed until the user manually reopens it.

### C.6 — Tripwire system

Tripwires are emergency brakes that disable an agent instance when conditions suggest something is going wrong. They fire based on scan-level or recent-history metrics.

| Tripwire | Condition | Effect |
|----------|-----------|--------|
| `too_many_findings` | A single scan produces more raw findings than 3× `maxFindingsPerScan` | Halt scan; disable instance; log alert |
| `rapid_task_creation` | More than `maxTasksCreatedPerHour × 2` tasks in the last 30 minutes | Halt scan; disable instance; log alert |
| `repeated_remediation_failure` | Same fingerprint has `attemptCount >= maxAbandonAttempts` for 3+ findings in one scan | Halt scan; disable instance; log alert |
| `queue_unhealthy` | Job queue health status is "degraded" | Skip scan entirely; reschedule with backoff |
| `sidecar_down` | Job queue sidecar is not running | Skip scan entirely; reschedule with backoff |

When a tripwire fires:
1. The scan is halted immediately.
2. The instance is set to `enabled: false`.
3. A scan run record is saved with `outcome: "tripwire_halt"` and `tripwireReason`.
4. A state stream event is emitted so the UI can show an alert.
5. The user must manually re-enable the instance after investigating.

### C.7 — Resolved policy merger

The guardrail engine never reads raw template defaults or raw instance overrides separately. Instead, it works with a **resolved policy**: the template's `defaultPolicy` merged with the instance's `policyOverrides`, with instance values winning.

**New file: `src/automations/policy-resolver.ts`**

```typescript
function resolvePolicy(
  template: AutomationAgentTemplate,
  instance: AutomationAgentInstance
): ResolvedPolicy {
  return {
    scanIntervalSeconds:
      instance.policyOverrides?.scanIntervalSeconds
      ?? template.defaultPolicy.scanIntervalSeconds,
    maxFindingsPerScan:
      instance.policyOverrides?.maxFindingsPerScan
      ?? template.defaultPolicy.maxFindingsPerScan,
    // ... same pattern for all policy fields ...
    allowedActions:
      instance.policyOverrides?.allowedActions
      ?? template.allowedActions,
  };
}
```

### Progress

- [x] C.1 — Create `src/automations/guardrail-engine.ts` with decision method
- [x] C.2 — Implement deduplication logic (fingerprint lookup, status-based decisions)
- [x] C.3 — Implement budget enforcement (sliding-window counters, per-instance + global)
- [x] C.4 — Implement cooldown enforcement (per-finding, evidence-change reset)
- [x] C.5 — Implement loop prevention (self-referencing exclusion, chain cap, attempt cap)
- [x] C.6 — Implement tripwire system (5 tripwire conditions, auto-disable, alert emission)
- [x] C.7 — Create `src/automations/policy-resolver.ts` with template + instance merge

---

## Project D: Quality Enforcer — First Agent

This project builds the first concrete agent on the platform: the Quality Enforcer. It implements the detection rules for code quality issues and registers the agent template.

### Concepts

The Quality Enforcer watches for six categories of code quality issues, ordered from cheapest to most expensive to detect:

1. **Failing tests**: the test suite exits non-zero.
2. **Type errors**: `tsc --noEmit` exits non-zero.
3. **Lint errors**: `biome check` or `eslint` exits non-zero.
4. **Missing test coverage for changed code**: files were modified but no corresponding test files were touched.
5. **Stale review tasks**: a task has been in `review` column for longer than a threshold.
6. **Repeated agent failures**: a task has been restarted 3+ times and keeps failing.

Categories 1-3 are deterministic rules. Category 4 is deterministic but uses heuristics to map source files to test files. Categories 5-6 are board-state rules (no shell commands needed). In v1, all rules are deterministic — no LLM invocation.

### D.1 — Quality Enforcer detection rules

**New file: `src/automations/agents/quality-enforcer/rules.ts`**

Each rule is a `RuleEvaluator` registered in the rule catalog.

**Rule: `failing-tests`**
- Collector: `test-results`
- Evaluate: parse the test runner output. If exit code ≠ 0, extract failing test names/files from the output using regex patterns for common runners (vitest, jest, mocha, cargo test).
- Fingerprint: `failing-tests:{{projectPath}}:{{testFile}}`
- Severity: `error` if entire suite fails, `warning` if individual tests fail.
- Task title: `"Fix failing tests in {{testFile}}"`
- Task prompt: includes the failing test output, the test file path, and recent git changes that may have caused the failure.
- Auto-start eligible: yes (for `error` severity only).

**Rule: `type-errors`**
- Collector: `typecheck-output`
- Evaluate: parse `tsc --noEmit` output. Extract error locations (file:line) and messages.
- Fingerprint: `type-errors:{{projectPath}}:{{errorCount}}-errors`
- Severity: `error`
- Task title: `"Fix {{errorCount}} TypeScript type errors"`
- Task prompt: includes the full type error output.
- Auto-start eligible: yes.

**Rule: `lint-errors`**
- Collector: `lint-output`
- Evaluate: parse biome/eslint output. Count errors vs warnings.
- Fingerprint: `lint-errors:{{projectPath}}:{{errorCount}}-errors`
- Severity: `warning` (lint warnings) or `error` (lint errors).
- Task title: `"Fix {{errorCount}} lint errors"`
- Task prompt: includes the lint output.
- Auto-start eligible: no (lint warnings shouldn't auto-start tasks).

**Rule: `missing-test-coverage`**
- Collector: `git-diff-stat`
- Evaluate: for each changed source file, check if a corresponding test file was also changed. Use naming conventions (`foo.ts` → `foo.test.ts`, `foo.spec.ts`, `__tests__/foo.ts`) and directory conventions (`src/x.ts` → `test/x.test.ts`).
- Fingerprint: `missing-coverage:{{projectPath}}:{{sourceFile}}`
- Severity: `warning`
- Task title: `"Add tests for {{sourceFile}}"`
- Task prompt: includes the diff for the source file and the expected test file locations.
- Auto-start eligible: no.

**Rule: `stale-review`**
- Collector: `board-state`
- Evaluate: find cards in the `review` column with `updatedAt` older than threshold (default: 24 hours).
- Fingerprint: `stale-review:{{projectPath}}:{{taskId}}`
- Severity: `info`
- Task title: `"Review stale task: {{taskTitle}}"`
- Task prompt: notes the task has been awaiting review for N hours.
- Auto-start eligible: no.

**Rule: `repeated-agent-failure`**
- Collector: `board-state`
- Evaluate: find cards in `in_progress` with a session that has been restarted 3+ times and the session state is `failed` or `interrupted`.
- Fingerprint: `repeated-failure:{{projectPath}}:{{taskId}}`
- Severity: `warning`
- Task title: `"Investigate repeated failures on: {{taskTitle}}"`
- Task prompt: includes session history and failure reasons.
- Auto-start eligible: no.

### D.2 — Quality Enforcer template

**New file: `src/automations/agents/quality-enforcer/template.ts`**

Registers the Quality Enforcer template with the template registry:

```typescript
export const QUALITY_ENFORCER_TEMPLATE: AutomationAgentTemplate = {
  id: "quality-enforcer",
  name: "Quality Enforcer",
  description:
    "Periodically scans projects for code quality issues — failing tests, " +
    "type errors, lint violations, missing test coverage, stale reviews, " +
    "and repeated agent failures — and creates Kanban tasks to address them.",
  version: "1.0.0",
  ruleIds: [
    "failing-tests",
    "type-errors",
    "lint-errors",
    "missing-test-coverage",
    "stale-review",
    "repeated-agent-failure",
  ],
  allowedActions: [
    "create_backlog_task",
    "schedule_task",
    "auto_start_task",
    "link_to_existing_task",
    "add_finding_comment",
  ],
  defaultPolicy: {
    scanIntervalSeconds: 900,        // every 15 minutes
    maxFindingsPerScan: 20,
    maxTasksCreatedPerHour: 5,
    maxAutoStartsPerHour: 1,
    cooldownMinutes: 60,
    severityThreshold: "warning",    // ignore "info" findings by default
  },
};
```

### D.3 — Quality Enforcer task templates

When the Quality Enforcer creates a Kanban task, the task card carries rich context so the remediation agent has everything it needs.

**Card metadata for automation-created tasks:**

Extend `runtimeBoardCardSchema` in `api-contract.ts` with optional automation provenance fields:

```typescript
/** If this card was created by an automation agent. */
createdByAutomation: z.string().nullable().optional(),  // instance ID
/** Fingerprint of the finding that triggered this card's creation. */
automationFindingFingerprint: z.string().nullable().optional(),
/** Evidence snapshot at the time of creation. */
automationEvidence: z.record(z.string(), z.string()).nullable().optional(),
```

These fields are set by the action executor in pipeline stage 6 and are used by the loop prevention system to filter out self-generated tasks.

### D.4 — Quality Enforcer evidence collectors

The Quality Enforcer's rules need evidence from these collectors (defined in Project B):

- `test-results` — runs the project's test command
- `typecheck-output` — runs `tsc --noEmit`
- `lint-output` — runs the project's lint command
- `git-diff-stat` — changed files since last scan
- `board-state` — current board cards and sessions

For the test and lint collectors, the pipeline needs to determine *which command to run*. This is done by inspecting `package.json` for `scripts.test` and `scripts.lint`, or falling back to known defaults. This logic belongs in the evidence collector, not the rule.

### D.5 — Register Quality Enforcer at boot

In `runtime-server.ts` (or a dedicated `src/automations/boot.ts` module):

```typescript
import { QUALITY_ENFORCER_TEMPLATE } from "./automations/agents/quality-enforcer/template";
import { qualityEnforcerRules } from "./automations/agents/quality-enforcer/rules";

// Register template
templateRegistry.registerTemplate(QUALITY_ENFORCER_TEMPLATE);

// Register rules
for (const rule of qualityEnforcerRules) {
  ruleCatalog.registerRule(rule);
}
```

### Progress

- [x] D.1 — Implement 6 Quality Enforcer detection rules in `src/automations/agents/quality-enforcer/rules.ts`
- [x] D.2 — Create Quality Enforcer template in `src/automations/agents/quality-enforcer/template.ts`
- [x] D.3 — Add automation provenance fields to `runtimeBoardCardSchema` in `api-contract.ts` — `createdByAutomation`, `automationFindingFingerprint`, `automationEvidence` added to `runtimeBoardCardSchema`
- [x] D.4 — Implement Quality Enforcer evidence collectors (test, typecheck, lint, git-diff, board-state)
- [x] D.5 — Register Quality Enforcer template and rules at Kanban boot time

---

## Project E: Automation Management UI

This project builds the browser UI for managing automation agents. It covers the full lifecycle: browsing templates, creating instances, configuring policies, monitoring activity, and handling alerts.

### Concepts

The UI introduces a new top-level surface: the **Automations panel**. This sits alongside the existing board view and jobs dashboard, accessible from the top navigation bar. It's the user's primary control surface for enabling, configuring, and monitoring autonomous agents.

The Automations panel has three sub-views:
1. **Catalog**: browse available agent templates and create instances.
2. **Instances**: see all active/paused instances, their status, and recent activity.
3. **Findings**: review detected issues, linked tasks, and suppressed findings.

### E.1 — TRPC API for automations

**New file: `src/trpc/automations-api.ts`**

Expose automation operations to the browser:

```typescript
export function createAutomationsApi(deps: { getAutomationService: () => AutomationService }) {
  return {
    // Templates
    listTemplates: async () => { ... },
    getTemplate: async (input: { templateId: string }) => { ... },

    // Instances
    listInstances: async () => { ... },
    getInstance: async (input: { instanceId: string }) => { ... },
    createInstance: async (input: {
      templateId: string;
      label: string;
      projectPaths: string[];
      policyOverrides?: Partial<PolicyOverrides>;
    }) => { ... },
    updateInstance: async (input: { instanceId: string; updates: ... }) => { ... },
    enableInstance: async (input: { instanceId: string }) => { ... },
    disableInstance: async (input: { instanceId: string }) => { ... },
    deleteInstance: async (input: { instanceId: string }) => { ... },
    runScanNow: async (input: { instanceId: string }) => { ... },

    // Findings
    listFindings: async (input: {
      instanceId?: string;
      projectPath?: string;
      status?: string;
      limit?: number;
    }) => { ... },
    suppressFinding: async (input: { fingerprint: string }) => { ... },
    unsuppressFinding: async (input: { fingerprint: string }) => { ... },

    // Scan history
    listScanRuns: async (input: { instanceId: string; limit?: number }) => { ... },

    // Aggregate status
    getAutomationStatus: async () => {
      // Returns: enabled instances count, total open findings, tasks created today,
      // active tripwires, next scheduled scan
    },
  };
}
```

Register in `app-router.ts` alongside existing routers.

### E.2 — State stream integration

Add a new state stream message type for automation updates:

```typescript
export const runtimeStateStreamAutomationUpdatedMessageSchema = z.object({
  type: z.literal("automation_updated"),
  instances: z.array(automationAgentInstanceSchema),
  openFindingsCount: z.number(),
  activeTripwires: z.array(z.string()),
});
```

Add to the discriminated union in `runtimeStateStreamMessageSchema`. The automation service broadcasts this after each scan completes or when instance state changes.

### E.3 — Automations panel layout

**New file: `web-ui/src/components/automations/automations-panel.tsx`**

The top-level container with three tabs: Catalog, Instances, Findings.

### E.4 — Agent catalog view

**New file: `web-ui/src/components/automations/agent-catalog.tsx`**

Cards showing each registered template:
- Template name, description, version.
- Number of active instances.
- "Create Instance" button → opens the instance creation dialog.

### E.5 — Instance creation dialog

**New file: `web-ui/src/components/automations/create-instance-dialog.tsx`**

A dialog for configuring a new agent instance:
- Template selector (pre-selected if opened from a catalog card).
- Label text input.
- Project scope selector: multi-select from indexed projects, or "All projects."
- Policy configuration:
  - Scan interval: dropdown (5m, 15m, 30m, 1h, 4h).
  - Max findings per scan: number input.
  - Max tasks per hour: number input.
  - Max auto-starts per hour: number input (0 = disabled).
  - Cooldown minutes: number input.
  - Severity threshold: dropdown (info, warning, error, critical).
  - Allowed actions: checkboxes from the template's allowed set.
- "Create & Enable" and "Create (Paused)" buttons.

### E.6 — Instance list view

**New file: `web-ui/src/components/automations/instance-list.tsx`**

Table/card list of all instances:
- Status indicator (enabled/disabled/tripwire).
- Template name.
- Scoped projects.
- Last scan time and outcome.
- Next scheduled scan.
- Open findings count.
- Tasks created (last 24h).
- Actions: Enable/Disable toggle, Edit, Run Now, Delete.

### E.7 — Instance detail panel

**New file: `web-ui/src/components/automations/instance-detail-panel.tsx`**

Expands when an instance is selected:
- Policy configuration (editable).
- Recent scan run history (timeline with outcomes).
- Findings list (filterable by status, severity, category).
- Linked tasks list (cards created by this instance).
- Budget utilization gauges (tasks created this hour / max).
- Tripwire status.

### E.8 — Findings view

**New file: `web-ui/src/components/automations/findings-list.tsx`**

Cross-instance view of all findings:
- Filterable by: instance, project, status, severity, category.
- Sortable by: severity, lastSeenAt, firstSeenAt.
- Each finding row shows: title, severity badge, category tag, project, status, linked task, first/last seen.
- Actions per finding: View Details, Suppress, Unsuppress, View Linked Task.

**New file: `web-ui/src/components/automations/finding-detail-dialog.tsx`**

Dialog showing full finding details:
- Evidence display (formatted command output, diffs).
- Remediation history (attempt count, linked task status).
- Fingerprint (for debugging).
- Suppress/unsuppress toggle.

### E.9 — Board integration

On the Kanban board itself, cards created by automation agents should be visually distinguishable:

- A small "robot" icon (🤖 or a Lucide `Bot` icon) badge on the card.
- Hover tooltip showing: "Created by Quality Enforcer — failing-tests finding."
- In the card detail view, a collapsible section showing the finding's evidence.

### E.10 — Navigation integration

Add an "Automations" entry to the top navigation bar, alongside the existing board and jobs views. Show a badge with the count of active tripwires or unresolved critical findings.

### Progress

- [x] E.1 — Create `src/trpc/automations-api.ts` with full TRPC API; register in `app-router.ts`
- [x] E.2 — Add `automation_updated` state stream message type; handle in `use-runtime-state-stream.ts`
- [x] E.3 — Create `web-ui/src/components/automations/automations-panel.tsx` (full tabbed panel with instances/findings/templates; E.4–E.8 implemented inline as focused sub-components within this file per clean-architecture principle)
- [x] E.4 — TemplateCard + TemplatesTab (integrated in automations-panel.tsx)
- [x] E.5 — CreateInstanceForm inline (integrated in automations-panel.tsx)
- [x] E.6 — InstanceRow + InstancesTab (integrated in automations-panel.tsx)
- [x] E.7 — Instance detail (status, scan-now, tripwire badge — integrated in automations-panel.tsx)
- [x] E.8 — FindingRow (expand/collapse) + FindingsTab (integrated in automations-panel.tsx)
- [ ] E.9 — Add automation provenance badge + evidence section to board cards and card detail view (deferred to next iteration — board card schema already has `createdByAutomation` / `automationFindingFingerprint` fields; UI badge pending)
- [x] E.10 — Add Bot icon toggle button to top navigation bar

---

## Project F: Observability and Audit Trail

This project builds the audit infrastructure that makes the automation system transparent and debuggable. Every scan, every decision, every action is recorded and surfaceable.

### Concepts

Because the automation system acts autonomously, users need to be able to answer: "What did it do? Why? When? What happened next?" The audit trail answers these questions without requiring the user to dig through logs.

### F.1 — Audit event model

Every significant automation action emits an audit event. Events are stored in the automation store and surfaced in the UI.

**Extend `automation-types.ts`:**

```typescript
export const automationAuditEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.number(),
  instanceId: z.string().uuid(),
  templateId: z.string(),
  eventType: z.enum([
    "scan_started",
    "scan_completed",
    "finding_detected",
    "finding_suppressed_dedup",
    "finding_suppressed_cooldown",
    "finding_suppressed_budget",
    "task_created",
    "task_auto_started",
    "remediation_attempted",
    "remediation_resolved",
    "remediation_abandoned",
    "tripwire_triggered",
    "instance_enabled",
    "instance_disabled",
    "instance_deleted",
    "manual_scan_triggered",
    "finding_manually_suppressed",
    "finding_manually_unsuppressed",
  ]),
  /** Structured context for this event. */
  details: z.record(z.string(), z.unknown()),
});
export type AutomationAuditEvent = z.infer<typeof automationAuditEventSchema>;
```

### F.2 — Audit event storage

Add audit events to the automation store:

```
saveAuditEvent(event): void
listAuditEvents(filters: { instanceId?, eventType?, since?, limit? }): AuditEvent[]
purgeAuditEvents(olderThanMs): number
```

Audit events are append-only. A periodic cleanup job purges events older than 30 days (configurable).

### F.3 — Audit timeline UI

**New file: `web-ui/src/components/automations/audit-timeline.tsx`**

A chronological timeline view in the Automations panel:
- Shows events from all instances, or filtered to one instance.
- Each event is a timestamped row with: event type icon, instance label, human-readable description, expandable details.
- Color-coded by event type (green for resolved, red for tripwires, gray for suppressed).
- Filterable by event type, instance, time range.

### F.4 — Dashboard integration

In the existing Jobs Dashboard, add an "Automation Activity" section showing:
- Active automation instances and their scan cadence.
- Tasks created by automations in the last 24h.
- Active tripwires (prominently displayed).
- Link to the full Automations panel.

### F.5 — Audit event cleanup job

A new maintenance job (extending Project 2's pattern) that purges old audit events:

**Add to `maintenance-jobs.ts`:**

A `purge-automation-audit` seed that runs daily, calling `automationStore.purgeAuditEvents(30 * 24 * 60 * 60 * 1000)`.

### Progress

- [x] F.1 — Define `AutomationAuditEvent` schema in `automation-types.ts` — complete with full event lifecycle schema
- [x] F.2 — Add audit event persistence to `automation-store.ts` — `appendAuditEvent`, `listAuditEvents`, `purgeAuditEvents` implemented
- [x] F.3 — Create `web-ui/src/components/automations/audit-timeline.tsx` — AuditTimeline component with chronological event feed, filtering, and expand/collapse; added as "Audit" tab in AutomationsPanel
- [x] F.4 — Add "Automation Activity" section to Jobs Dashboard — AutomationActivitySection in `web-ui/src/components/jobs-dashboard.tsx` shows enabled agent count, open findings, and tripwire alert with link to open Automations panel
- [x] F.5 — Add `purge-automation-audit` maintenance job seed — `scripts/maintenance/purge-automation-audit.sh` + seed in `seedProjectAutomationJobs`

---

## Project G: Verification and Testing

This project defines the test strategy and implements the tests that prove the system works correctly and safely. Testing is especially critical here because the system is autonomous — bugs manifest as runaway behavior, not just wrong output.

### Concepts

The testing strategy has four layers:

1. **Unit tests**: individual functions in isolation (fingerprint computation, budget counting, cooldown checking, policy resolution).
2. **Pipeline integration tests**: the detection pipeline running against mock evidence and a real store.
3. **Guardrail scenario tests**: targeted scenarios that verify the system handles edge cases correctly.
4. **End-to-end tests**: full scan cycles running against a real project with the job queue sidecar.

The guardrail scenario tests are the most important layer. Each test encodes a specific failure mode that the system must handle.

### G.1 — Unit tests

**New file: `test/runtime/automations/fingerprint.test.ts`**

- Verify fingerprint template interpolation.
- Verify same evidence → same fingerprint.
- Verify different evidence → different fingerprint.
- Verify fingerprint is deterministic (no randomness, no timestamps).

**New file: `test/runtime/automations/policy-resolver.test.ts`**

- Verify instance overrides take precedence over template defaults.
- Verify missing overrides fall through to template defaults.
- Verify action restriction (instance can only narrow, not expand).

**New file: `test/runtime/automations/budget-counter.test.ts`**

- Verify budget counts tasks in the correct time window.
- Verify budget resets after the window expires.
- Verify global budget aggregates across instances.

### G.2 — Guardrail scenario tests

**New file: `test/runtime/automations/guardrail-scenarios.test.ts`**

Each test is a named scenario:

| Scenario | Setup | Expected Behavior |
|----------|-------|-------------------|
| Duplicate finding | Same fingerprint appears twice in one scan | Second occurrence → `update_existing` |
| Cooldown active | Finding with recent remediation attempt | `suppress` |
| Budget exhausted | Instance has already created `maxTasksCreatedPerHour` tasks | `suppress` for remaining findings |
| Auto-start downgrade | Auto-start budget exhausted but create budget available | `auto_start_task` → `create_task` |
| Self-referencing exclusion | Finding detected on a card created by the same agent | Finding is never produced (filtered in pipeline) |
| Chain depth exceeded | Finding on files changed by another agent's remediation task, depth > 2 | `suppress` |
| Remediation attempt cap | Finding with `attemptCount >= maxAbandonAttempts` | `suppress` + status → `abandoned` |
| Tripwire: too many findings | Scan produces 3× `maxFindingsPerScan` findings | Pipeline halts; instance disabled |
| Tripwire: rapid creation | Budget tracking shows 2× max rate | Pipeline halts; instance disabled |
| Resolved finding re-detected | Previously resolved finding appears again | Treated as new finding (status reset) |
| Suppressed finding re-detected | User-suppressed finding appears again | `suppress` (user suppression is permanent) |
| Evidence change resets cooldown | Same fingerprint but different evidence hash | Cooldown does not apply; finding is actionable |
| Global budget blocks instance | Instance has budget remaining, but global budget is exhausted | `suppress` |
| Disabled instance skips scan | Instance `enabled: false` | Scan job exits immediately without running pipeline |

### G.3 — Pipeline integration tests

**New file: `test/runtime/automations/detection-pipeline.test.ts`**

- Set up a mock evidence collector that returns predetermined evidence.
- Run the pipeline with the Quality Enforcer's rules.
- Verify the correct findings are produced.
- Verify findings are correctly fingerprinted.
- Verify the guardrail decisions match expectations.
- Verify task creation calls are made with correct card metadata.

### G.4 — End-to-end scan test

**New file: `test/integration/automation-scan.integration.test.ts`**

- Start a Kanban server with the job queue sidecar.
- Create a Quality Enforcer instance scoped to a test project.
- Introduce a failing test in the test project.
- Trigger a scan via `kanban automation run-scan --instance-id <id>`.
- Verify: finding is created, task is created on the board, card has correct provenance metadata.
- Run the scan again (same failing test still present).
- Verify: finding is updated (lastSeenAt changes), no duplicate task is created.
- Fix the test.
- Run the scan again.
- Verify: finding status changes to "resolved."

### G.5 — Runaway prevention stress test

**New file: `test/integration/automation-runaway.integration.test.ts`**

- Create 3 Quality Enforcer instances, each scoped to the same project.
- Configure aggressive policies (scan every 5s, low budgets).
- Introduce multiple failures in the test project.
- Let the system run for 60 seconds.
- Verify: total tasks created across all instances does not exceed global budget.
- Verify: no instance created tasks about another instance's tasks (loop prevention).
- Verify: at least one tripwire fired and disabled an instance.

### Progress

- [x] G.1 — Write unit tests for policy resolution — `test/runtime/automations/policy-resolver.test.ts` (9 tests, all passing)
- [x] G.2 — Write guardrail scenario tests — `test/runtime/automations/guardrail-scenarios.test.ts` (11 scenarios covering tripwires, budgets, dedup, cooldowns, global cap — all passing)
- [x] G.3 — Write pipeline integration test with mock evidence — `test/runtime/automations/detection-pipeline.test.ts` (20 tests: all 6 rules, fingerprint stability, policy enforcement, finding structure — all passing)
- [x] G.4 — Write full scan cycle integration test — `test/runtime/automations/automation-service-scan.test.ts` (5 tests exercising DetectionPipeline + GuardrailEngine end-to-end with mock evidence: first scan create_task, deduplication update_existing, re-appearing finding, clean evidence, provenance metadata — all passing)
- [x] G.5 — Write runaway prevention stress test — `test/runtime/automations/runaway-prevention.test.ts` (8 tests: per-instance budget exhaustion, in-scan counter cap, global budget cap, auto-start budget, cooldown suppression, tripwire halt, tripwire threshold boundary, two-scan budget invariant — all passing; total 54/54 passing across all automation test files)

---

## Future Agent Types

The platform is designed to support additional agent types beyond the Quality Enforcer. Each new agent is a template + rule set registered at boot time. No platform code changes are needed — only new files under `src/automations/agents/<agent-name>/`.

Here are the agent types we envision building after the Quality Enforcer is stable:

### Dependency Updater
- Scans for outdated dependencies (`npm outdated`, `cargo outdated`).
- Creates tasks to update specific packages.
- Rules: `outdated-major`, `outdated-minor`, `security-advisory`.
- Policy: conservative by default (create only, no auto-start).

### Release Readiness Checker
- Evaluates whether a branch is ready for release.
- Checks: all tests pass, no open critical findings, no stale reviews, changelog updated.
- Creates a "Release Readiness Report" task when conditions are met.
- Rules: `release-tests-pass`, `release-no-blockers`, `release-changelog`.

### Docs Sync Agent
- Detects when code changes invalidate documentation.
- Compares API signatures and README examples against actual code.
- Creates tasks to update docs.
- Rules: `stale-readme-example`, `api-signature-mismatch`, `missing-jsdoc`.

### Bug Triage Agent
- Monitors GitHub issues (via `gh` CLI) and creates corresponding Kanban tasks.
- Rules: `new-bug-report`, `high-priority-issue`, `issue-assigned-to-me`.
- Policy: create only, never auto-start.

### Stale Task Janitor
- Finds tasks that have been in `in_progress` with no session activity for days.
- Creates investigation tasks or moves stale tasks back to backlog.
- Rules: `stale-in-progress`, `stale-review`.

Each of these follows the exact same pattern: define rules in a `rules.ts`, define a template in a `template.ts`, register both at boot. The detection pipeline, guardrails, persistence, and UI all work without modification.

---

## Summary

| Project | What It Delivers | Depends On |
|---------|-----------------|------------|
| **A: Platform Foundation** | Types, store, registry, service, queue topology | Job Queue Integration (complete) |
| **B: Detection Pipeline** | 7-stage scan engine, rule interface, evidence collectors | Project A |
| **C: Guardrail System** | Dedup, budgets, cooldowns, loop prevention, tripwires | Project A |
| **D: Quality Enforcer** | First agent: 6 detection rules, template, evidence collectors | Projects A, B, C |
| **E: Automation UI** | Catalog, instances, findings, board integration, navigation | Projects A, D |
| **F: Observability** | Audit events, timeline UI, dashboard integration | Projects A, D, E |
| **G: Testing** | Unit, scenario, pipeline, E2E, and stress tests | All projects |

### Recommended build order

**Start with Project A** (1-2 days). It defines the types and persistence that everything else depends on.

**Build Projects B and C in parallel** (2-3 days each). They are independent of each other and both depend only on A. The pipeline needs the guardrails only at stage 5, so the pipeline can be built with a stub guardrail gate initially.

**Build Project D** (2-3 days) once B and C are functional. This is the first real integration — the Quality Enforcer exercises the entire platform end-to-end.

**Build Project E** (3-4 days) once D produces real findings. The UI is most useful and testable when there's real data flowing through the system.

**Build Project F** (1-2 days) alongside or after E. Observability becomes important once the system is running autonomously.

**Build Project G throughout** — write unit tests as you build each module, integration tests after D, and the stress test last.

### What "done" looks like

The automation platform is done when:
1. A user can enable a Quality Enforcer instance from the Automations UI.
2. The agent periodically scans their project and creates findings for real issues.
3. Tasks are automatically created on the board with clear provenance and evidence.
4. Duplicate findings don't create duplicate tasks.
5. Budget and cooldown controls prevent excessive task creation.
6. Tripwires fire and disable the agent if something goes wrong.
7. The audit trail shows every scan, every decision, and every action.
8. The stress test proves the system stays bounded under adversarial conditions.
9. Adding a new agent type is as simple as writing a `rules.ts` and `template.ts`.
