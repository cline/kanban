/**
 * G.4 — Full scan cycle integration test.
 *
 * Exercises the complete pipeline-to-action chain:
 *   evidence collectors (mocked) → DetectionPipeline → GuardrailEngine → decisions
 *
 * Uses the real DetectionPipeline and GuardrailEngine implementations together
 * with a mock AutomationStore and mocked evidence collectors.  No real server
 * or job queue is needed.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { qualityEnforcerRules } from "../../../src/automations/agents/quality-enforcer/rules";
import { QUALITY_ENFORCER_TEMPLATE } from "../../../src/automations/agents/quality-enforcer/template";
import type { AutomationStore } from "../../../src/automations/automation-store";
import type {
	AutomationAgentInstance,
	AutomationAgentTemplate,
	AutomationFinding,
	RemediationRecord,
} from "../../../src/automations/automation-types";
import { DetectionPipeline } from "../../../src/automations/detection-pipeline";
import { GuardrailEngine } from "../../../src/automations/guardrail-engine";
import { resolvePolicy } from "../../../src/automations/policy-resolver";
import { ruleCatalog } from "../../../src/automations/rule-catalog";
import { templateRegistry } from "../../../src/automations/template-registry";

// ─── Mock the evidence collector so the pipeline never spawns subprocesses ──

vi.mock("../../../src/automations/evidence-collectors", () => ({
	collectEvidence: vi.fn(),
	getRequiredCollectorIds: vi.fn().mockReturnValue([]),
}));

import { collectEvidence } from "../../../src/automations/evidence-collectors";

const mockCollectEvidence = vi.mocked(collectEvidence);

// ─── Cached template (registered once in beforeAll) ──────────────────────────

let cachedTemplate: AutomationAgentTemplate;

// ─── Register templates and rules once ──────────────────────────────────────

beforeAll(() => {
	if (!templateRegistry.hasTemplate(QUALITY_ENFORCER_TEMPLATE.id)) {
		templateRegistry.registerTemplate(QUALITY_ENFORCER_TEMPLATE);
	}
	for (const rule of qualityEnforcerRules) {
		if (!ruleCatalog.hasRule(rule.rule.id)) {
			ruleCatalog.registerRule(rule);
		}
	}
	const t = templateRegistry.getTemplate(QUALITY_ENFORCER_TEMPLATE.id);
	if (!t) throw new Error("Quality Enforcer template not registered");
	cachedTemplate = t;
});

// ─── Mock store factory ───────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROJECT_PATH = "/test/myproject";

function makeInstance(overrides: Partial<AutomationAgentInstance> = {}): AutomationAgentInstance {
	return {
		id: "a0000000-0000-0000-0000-000000000001",
		templateId: QUALITY_ENFORCER_TEMPLATE.id,
		label: "Test QE",
		projectPaths: [PROJECT_PATH],
		enabled: true,
		policyOverrides: {},
		createdAt: Date.now(),
		updatedAt: Date.now(),
		...overrides,
	};
}

/** Evidence map with a failing test suite. */
function failingTestEvidence(): Map<string, string> {
	return new Map([
		["test-results.exitCode", "1"],
		["test-results.output", "FAIL src/foo.test.ts\n  ● foo › should pass\n  Expected: true\n  Received: false"],
		["test-results.failingTests", "foo › should pass"],
	]);
}

/** Evidence map representing a clean project. */
function cleanEvidence(): Map<string, string> {
	return new Map([
		["test-results.exitCode", "0"],
		["test-results.output", ""],
		["typecheck-output.exitCode", "0"],
		["typecheck-output.output", ""],
		["lint-output.exitCode", "0"],
		["lint-output.output", ""],
	]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("G.4 — Full scan cycle integration", () => {
	let pipeline: DetectionPipeline;

	beforeEach(() => {
		pipeline = new DetectionPipeline();
		mockCollectEvidence.mockReset();
	});

	it("failing-tests evidence produces a finding with create_task decision (first scan)", async () => {
		const instance = makeInstance();
		const store = makeMockStore();

		// Mock the evidence collector to return a failing test suite.
		mockCollectEvidence.mockResolvedValue(failingTestEvidence());

		const result = await pipeline.run(instance, PROJECT_PATH, null, null);

		expect(result.errors).toHaveLength(0);
		expect(result.findings.length).toBeGreaterThan(0);

		const testFinding = result.findings.find((f) => f.ruleId === "failing-tests");
		expect(testFinding).toBeDefined();
		expect(testFinding?.severity).toBe("error");
		expect(testFinding?.fingerprint).toBeTruthy();
		expect(testFinding?.instanceId).toBe(instance.id);
		expect(testFinding?.projectPath).toBe(PROJECT_PATH);

		// Run through guardrails — fresh store (no prior findings → create_task).
		const engine = new GuardrailEngine(store);
		engine.resetForScan();

		const policy = resolvePolicy(cachedTemplate, instance);

		const decisions = await engine.evaluateFindings(
			result.findings,
			instance,
			cachedTemplate,
			policy,
			result.rawFindingsCount,
		);

		const testDecision = decisions.find((d) => d.finding.ruleId === "failing-tests");
		expect(testDecision).toBeDefined();
		// New finding → engine should either create or auto-start a task (both valid).
		expect(["create_task", "auto_start_task"]).toContain(testDecision?.action);
		expect(testDecision?.reason).toBeTruthy();
	});

	it("second scan with same evidence produces update_existing (deduplication)", async () => {
		const instance = makeInstance();

		// First scan to obtain the stable fingerprint.
		mockCollectEvidence.mockResolvedValue(failingTestEvidence());
		const result1 = await pipeline.run(instance, PROJECT_PATH, null, null);
		const finding1 = result1.findings.find((f) => f.ruleId === "failing-tests");
		expect(finding1).toBeDefined();
		if (!finding1) throw new Error("finding1 not found");

		// Simulate the finding already having a task created.
		const existingFinding: AutomationFinding = {
			...finding1,
			status: "task_created",
			linkedTaskId: "task-abc-123",
		};

		const store = makeMockStore({
			getFinding: vi
				.fn()
				.mockImplementation((fp: string) =>
					Promise.resolve(fp === existingFinding.fingerprint ? existingFinding : null),
				),
		});

		// Second scan with identical evidence.
		mockCollectEvidence.mockResolvedValue(failingTestEvidence());
		const result2 = await pipeline.run(instance, PROJECT_PATH, null, null);
		const finding2 = result2.findings.find((f) => f.ruleId === "failing-tests");
		expect(finding2).toBeDefined();

		// Fingerprints must be identical (deterministic).
		expect(finding2?.fingerprint).toBe(finding1.fingerprint);

		// Guardrails should see the existing open finding and return update_existing.
		const engine = new GuardrailEngine(store);
		engine.resetForScan();

		const policy = resolvePolicy(cachedTemplate, instance);

		const decisions = await engine.evaluateFindings(
			result2.findings,
			instance,
			cachedTemplate,
			policy,
			result2.rawFindingsCount,
		);

		const decision = decisions.find((d) => d.finding.ruleId === "failing-tests");
		expect(decision).toBeDefined();
		expect(decision?.action).toBe("update_existing");
	});

	it("previously-resolved finding reappearing triggers new create_task", async () => {
		const instance = makeInstance();

		mockCollectEvidence.mockResolvedValue(failingTestEvidence());
		const scanResult = await pipeline.run(instance, PROJECT_PATH, null, null);
		const finding = scanResult.findings.find((f) => f.ruleId === "failing-tests");
		expect(finding).toBeDefined();
		if (!finding) throw new Error("finding not found");

		// Simulate a previously resolved finding.
		const resolvedFinding: AutomationFinding = {
			...finding,
			status: "resolved",
			linkedTaskId: "task-old-resolved",
		};
		const resolvedRemediation: RemediationRecord = {
			findingFingerprint: finding.fingerprint,
			taskId: "task-old-resolved",
			createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
			lastAttemptAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
			attemptCount: 1,
			state: "resolved",
		};
		const store = makeMockStore({
			getFinding: vi
				.fn()
				.mockImplementation((fp: string) =>
					Promise.resolve(fp === resolvedFinding.fingerprint ? resolvedFinding : null),
				),
			getRemediation: vi
				.fn()
				.mockImplementation((fp: string) =>
					Promise.resolve(fp === resolvedFinding.fingerprint ? resolvedRemediation : null),
				),
		});

		const engine = new GuardrailEngine(store);
		engine.resetForScan();

		const policy = resolvePolicy(cachedTemplate, instance);

		const decisions = await engine.evaluateFindings(
			scanResult.findings,
			instance,
			cachedTemplate,
			policy,
			scanResult.rawFindingsCount,
		);

		// The finding reappears after being resolved → should create or auto-start a new task.
		const decision = decisions.find((d) => d.finding.ruleId === "failing-tests");
		expect(decision).toBeDefined();
		expect(["create_task", "auto_start_task"]).toContain(decision?.action);
	});

	it("clean evidence produces no findings", async () => {
		const instance = makeInstance();
		const store = makeMockStore();

		mockCollectEvidence.mockResolvedValue(cleanEvidence());
		const result = await pipeline.run(instance, PROJECT_PATH, null, null);

		expect(result.errors).toHaveLength(0);
		expect(result.findings).toHaveLength(0);

		const engine = new GuardrailEngine(store);
		engine.resetForScan();

		const policy = resolvePolicy(cachedTemplate, instance);

		const decisions = await engine.evaluateFindings(
			result.findings,
			instance,
			cachedTemplate,
			policy,
			result.rawFindingsCount,
		);
		expect(decisions).toHaveLength(0);
	});

	it("finding carries correct provenance metadata", async () => {
		const instance = makeInstance();

		mockCollectEvidence.mockResolvedValue(failingTestEvidence());
		const result = await pipeline.run(instance, PROJECT_PATH, null, null);

		const finding = result.findings.find((f) => f.ruleId === "failing-tests");
		expect(finding).toBeDefined();
		expect(finding?.instanceId).toBe(instance.id);
		expect(finding?.templateId).toBe(QUALITY_ENFORCER_TEMPLATE.id);
		expect(finding?.fingerprint).toBeTruthy();
		expect(finding?.projectPath).toBe(PROJECT_PATH);
		expect(typeof finding?.evidence).toBe("object");
		expect(Object.keys(finding?.evidence ?? {}).length).toBeGreaterThan(0);
	});
});
