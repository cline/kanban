/**
 * G.5 — Runaway prevention stress tests.
 *
 * These tests verify that no matter how many findings arrive in a single scan
 * or across rapid successive scans, the guardrail engine:
 *   1. Stops creating tasks once the per-instance hourly budget is exhausted.
 *   2. Stops creating tasks once the global hourly budget is exhausted.
 *   3. Honours the per-finding cooldown (no re-trigger while cooldown is active).
 *   4. Halts the entire instance when the preflight tripwire fires (too many raw findings).
 *   5. Never auto-starts more tasks than maxAutoStartsPerHour.
 *
 * Each test uses the real GuardrailEngine implementation with a mock store,
 * so no Kanban server or job queue is needed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationStore } from "../../../src/automations/automation-store";
import type {
	AutomationAgentInstance,
	AutomationAgentTemplate,
	AutomationFinding,
	RemediationRecord,
	ResolvedPolicy,
} from "../../../src/automations/automation-types";
import { GuardrailEngine } from "../../../src/automations/guardrail-engine";

// ─── Constants that mirror engine internals (keep in sync) ───────────────────

/** TRIPWIRE_FINDINGS_MULTIPLIER from guardrail-engine.ts */
const TRIPWIRE_FINDINGS_MULTIPLIER = 3;
/** GLOBAL_MAX_TASKS_PER_HOUR from guardrail-engine.ts */
const GLOBAL_MAX_TASKS_PER_HOUR = 20;

// ─── Sequence helpers ─────────────────────────────────────────────────────────

let _seq = 100;
function nextUuid(): string {
	const n = String(_seq++).padStart(12, "0");
	return `aaaaaaaa-0000-0000-0000-${n}`;
}

// ─── Fixture factories ────────────────────────────────────────────────────────

function makeMockStore(overrides: Partial<Record<keyof AutomationStore, unknown>> = {}): AutomationStore {
	return {
		listInstances: vi.fn().mockResolvedValue([]),
		getInstance: vi.fn().mockResolvedValue(null),
		saveInstance: vi.fn().mockResolvedValue(undefined),
		deleteInstance: vi.fn().mockResolvedValue(undefined),
		listFindings: vi.fn().mockResolvedValue([]),
		getFinding: vi.fn().mockResolvedValue(null),
		saveFinding: vi.fn().mockResolvedValue(undefined),
		getRemediation: vi.fn().mockResolvedValue(null),
		saveRemediation: vi.fn().mockResolvedValue(undefined),
		listRemediations: vi.fn().mockResolvedValue([]),
		listScanRuns: vi.fn().mockResolvedValue([]),
		saveScanRun: vi.fn().mockResolvedValue(undefined),
		listAuditEvents: vi.fn().mockResolvedValue([]),
		appendAuditEvent: vi.fn().mockResolvedValue(undefined),
		purgeAuditEvents: vi.fn().mockResolvedValue(0),
		countTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
		countAutoStartsInWindow: vi.fn().mockResolvedValue(0),
		countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
		countGlobalAutoStartsInWindow: vi.fn().mockResolvedValue(0),
		...overrides,
	} as unknown as AutomationStore;
}

function makeInstance(overrides: Partial<AutomationAgentInstance> = {}): AutomationAgentInstance {
	return {
		id: nextUuid(),
		templateId: "quality-enforcer",
		label: "Stress Test QE",
		projectPaths: ["/stress/project"],
		enabled: true,
		policyOverrides: {},
		createdAt: Date.now(),
		updatedAt: Date.now(),
		...overrides,
	};
}

function makeTemplate(overrides: Partial<AutomationAgentTemplate> = {}): AutomationAgentTemplate {
	return {
		id: "quality-enforcer",
		name: "Quality Enforcer",
		description: "Stress test",
		version: "1.0.0",
		ruleIds: [],
		allowedActions: ["create_backlog_task", "auto_start_task"],
		defaultPolicy: {
			scanIntervalSeconds: 300,
			maxFindingsPerScan: 20,
			maxTasksCreatedPerHour: 5,
			maxAutoStartsPerHour: 2,
			cooldownMinutes: 60,
			severityThreshold: "warning",
		},
		...overrides,
	};
}

function makePolicy(overrides: Partial<ResolvedPolicy> = {}): ResolvedPolicy {
	return {
		scanIntervalSeconds: 300,
		maxFindingsPerScan: 20,
		maxTasksCreatedPerHour: 5,
		maxAutoStartsPerHour: 2,
		cooldownMinutes: 60,
		severityThreshold: "warning",
		allowedActions: ["create_backlog_task", "auto_start_task"],
		...overrides,
	};
}

function makeFinding(overrides: Partial<AutomationFinding> = {}): AutomationFinding {
	const fp = `fp-${nextUuid()}`;
	return {
		id: nextUuid(),
		fingerprint: fp,
		instanceId: nextUuid(),
		templateId: "quality-enforcer",
		projectPath: "/stress/project",
		ruleId: "failing-tests",
		title: "Failing tests",
		description: "Tests failed.",
		category: "failing-tests",
		affectedFiles: [],
		severity: "error",
		status: "open",
		evidence: { testExitCode: "1" },
		firstSeenAt: Date.now(),
		lastSeenAt: Date.now(),
		linkedTaskId: null,
		...overrides,
	};
}

function makeRemediation(fingerprint: string, overrides: Partial<RemediationRecord> = {}): RemediationRecord {
	return {
		findingFingerprint: fingerprint,
		taskId: nextUuid(),
		createdAt: Date.now(),
		lastAttemptAt: Date.now(),
		attemptCount: 1,
		state: "active",
		...overrides,
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("G.5 — Runaway prevention stress tests", () => {
	let store: AutomationStore;
	let engine: GuardrailEngine;
	let instance: AutomationAgentInstance;
	let template: AutomationAgentTemplate;
	let policy: ResolvedPolicy;

	beforeEach(() => {
		store = makeMockStore();
		engine = new GuardrailEngine(store);
		instance = makeInstance();
		template = makeTemplate();
		policy = makePolicy();
	});

	// ─── 1. Per-instance budget exhaustion ──────────────────────────────────

	it("stops creating tasks once per-instance hourly budget is exhausted", async () => {
		const maxTasks = 3;
		const localPolicy = makePolicy({ maxTasksCreatedPerHour: maxTasks });

		// Historical count already at the limit.
		store = makeMockStore({
			getFinding: vi.fn().mockResolvedValue(null),
			getRemediation: vi.fn().mockResolvedValue(null),
			countTasksCreatedInWindow: vi.fn().mockResolvedValue(maxTasks),
			countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(maxTasks),
		});
		engine = new GuardrailEngine(store);
		engine.resetForScan();

		const findings = Array.from({ length: 5 }, () => makeFinding());
		const decisions = await engine.evaluateFindings(findings, instance, template, localPolicy, findings.length);

		const createDecisions = decisions.filter((d) => d.action === "create_task");
		// Budget already exhausted historically → no new tasks should be created.
		expect(createDecisions).toHaveLength(0);
	});

	it("respects in-scan counter: stops after maxTasksCreatedPerHour within one batch", async () => {
		const maxTasks = 3;
		const localPolicy = makePolicy({ maxTasksCreatedPerHour: maxTasks });

		// History starts at 0 — budget is fresh.
		store = makeMockStore({
			getFinding: vi.fn().mockResolvedValue(null),
			getRemediation: vi.fn().mockResolvedValue(null),
			countTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
		});
		engine = new GuardrailEngine(store);
		engine.resetForScan();

		// Submit 10 brand-new findings; only maxTasks may become create_task.
		const findings = Array.from({ length: 10 }, () => makeFinding());
		const decisions = await engine.evaluateFindings(findings, instance, template, localPolicy, findings.length);

		const createDecisions = decisions.filter((d) => d.action === "create_task");
		expect(createDecisions.length).toBeLessThanOrEqual(maxTasks);
	});

	// ─── 2. Global budget cap ───────────────────────────────────────────────

	it("respects global budget: no new tasks when global limit reached", async () => {
		// Global count already at the global cap.
		store = makeMockStore({
			getFinding: vi.fn().mockResolvedValue(null),
			getRemediation: vi.fn().mockResolvedValue(null),
			countTasksCreatedInWindow: vi.fn().mockResolvedValue(0), // per-instance OK
			countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(GLOBAL_MAX_TASKS_PER_HOUR),
		});
		engine = new GuardrailEngine(store);
		engine.resetForScan();

		const findings = Array.from({ length: 5 }, () => makeFinding());
		const decisions = await engine.evaluateFindings(findings, instance, template, policy, findings.length);

		const createDecisions = decisions.filter((d) => d.action === "create_task");
		expect(createDecisions).toHaveLength(0);
	});

	// ─── 3. Auto-start budget ────────────────────────────────────────────────

	it("never auto-starts more tasks than maxAutoStartsPerHour", async () => {
		const maxAutoStarts = 2;
		const localPolicy = makePolicy({ maxAutoStartsPerHour: maxAutoStarts });

		store = makeMockStore({
			getFinding: vi.fn().mockResolvedValue(null),
			getRemediation: vi.fn().mockResolvedValue(null),
			countTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countGlobalAutoStartsInWindow: vi.fn().mockResolvedValue(0),
		});
		engine = new GuardrailEngine(store);
		engine.resetForScan();

		const findings = Array.from({ length: 10 }, () => makeFinding({ severity: "critical" }));
		const decisions = await engine.evaluateFindings(findings, instance, template, localPolicy, findings.length);

		const autoStartDecisions = decisions.filter((d) => d.action === "auto_start_task");
		expect(autoStartDecisions.length).toBeLessThanOrEqual(maxAutoStarts);
	});

	// ─── 4. Cooldown suppression ────────────────────────────────────────────

	it("suppresses a finding within cooldown window when active remediation exists", async () => {
		const fp = `fp-cooldown-${nextUuid()}`;
		const finding = makeFinding({ fingerprint: fp, status: "task_created", linkedTaskId: "task-x" });

		const activeRemediation = makeRemediation(fp, {
			state: "active",
			lastAttemptAt: Date.now() - 5 * 60 * 1000, // 5 min ago (within 60 min cooldown)
		});

		store = makeMockStore({
			getFinding: vi.fn().mockImplementation((f: string) => Promise.resolve(f === fp ? finding : null)),
			getRemediation: vi
				.fn()
				.mockImplementation((f: string) => Promise.resolve(f === fp ? activeRemediation : null)),
			countTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countGlobalAutoStartsInWindow: vi.fn().mockResolvedValue(0),
		});
		engine = new GuardrailEngine(store);
		engine.resetForScan();

		const decisions = await engine.evaluateFindings([finding], instance, template, policy, 1);

		expect(decisions).toHaveLength(1);
		// Should NOT create a new task — existing active remediation is within cooldown.
		expect(decisions[0]?.action).not.toBe("create_task");
		expect(decisions[0]?.action).not.toBe("auto_start_task");
	});

	// ─── 5. Preflight tripwire ──────────────────────────────────────────────

	it("halts the instance when rawFindingsCount exceeds tripwire threshold", async () => {
		const findings = [makeFinding()];
		const overTripwire = policy.maxFindingsPerScan * TRIPWIRE_FINDINGS_MULTIPLIER + 1;

		const decisions = await engine.evaluateFindings(findings, instance, template, policy, overTripwire);

		expect(decisions).toHaveLength(1);
		expect(decisions[0]?.action).toBe("halt");
		expect(decisions[0]?.reason).toBeTruthy();
	});

	it("does not halt when rawFindingsCount is exactly at (not over) the tripwire threshold", async () => {
		store = makeMockStore({
			getFinding: vi.fn().mockResolvedValue(null),
			getRemediation: vi.fn().mockResolvedValue(null),
			countTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countAutoStartsInWindow: vi.fn().mockResolvedValue(0),
			countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countGlobalAutoStartsInWindow: vi.fn().mockResolvedValue(0),
		});
		engine = new GuardrailEngine(store);
		engine.resetForScan();

		const findings = [makeFinding()];
		const atTripwire = policy.maxFindingsPerScan * TRIPWIRE_FINDINGS_MULTIPLIER;

		const decisions = await engine.evaluateFindings(findings, instance, template, policy, atTripwire);

		// No halt — engine uses strict >
		expect(decisions.every((d) => d.action !== "halt")).toBe(true);
	});

	// ─── 6. Rapid successive scans stay within budget ───────────────────────

	it("two successive scans together never exceed the hourly budget", async () => {
		const maxTasks = 4;
		const localPolicy = makePolicy({ maxTasksCreatedPerHour: maxTasks });

		// First scan: budget is fresh.
		store = makeMockStore({
			getFinding: vi.fn().mockResolvedValue(null),
			getRemediation: vi.fn().mockResolvedValue(null),
			countTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
			countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(0),
		});
		const engine1 = new GuardrailEngine(store);
		engine1.resetForScan();

		const scan1Findings = Array.from({ length: 4 }, () => makeFinding());
		const scan1Decisions = await engine1.evaluateFindings(
			scan1Findings,
			instance,
			template,
			localPolicy,
			scan1Findings.length,
		);
		const scan1Created = scan1Decisions.filter((d) => d.action === "create_task").length;

		// Second scan: historical count now includes what scan 1 created.
		const engine2Store = makeMockStore({
			getFinding: vi.fn().mockResolvedValue(null),
			getRemediation: vi.fn().mockResolvedValue(null),
			countTasksCreatedInWindow: vi.fn().mockResolvedValue(scan1Created),
			countGlobalTasksCreatedInWindow: vi.fn().mockResolvedValue(scan1Created),
		});
		const engine2 = new GuardrailEngine(engine2Store);
		engine2.resetForScan();

		const scan2Findings = Array.from({ length: 4 }, () => makeFinding());
		const scan2Decisions = await engine2.evaluateFindings(
			scan2Findings,
			instance,
			template,
			localPolicy,
			scan2Findings.length,
		);
		const scan2Created = scan2Decisions.filter((d) => d.action === "create_task").length;

		// Total across both scans must not exceed the hourly max.
		expect(scan1Created + scan2Created).toBeLessThanOrEqual(maxTasks);
	});
});
