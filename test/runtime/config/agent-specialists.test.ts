import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadAgentSpecialists } from "../../../src/config/agent-specialists";

describe("loadAgentSpecialists", () => {
	/**
	 * Creates a tmp directory, writes .cline/agents/<filename> for each entry,
	 * and returns tmpDir (the projectRoot to pass to loadAgentSpecialists).
	 */
	function makeTmpAgentsDir(files: Record<string, string>): string {
		const tmpDir = mkdtempSync(join(tmpdir(), "kb-specialists-test-"));
		mkdirSync(join(tmpDir, ".cline", "agents"), { recursive: true });
		for (const [filename, content] of Object.entries(files)) {
			writeFileSync(join(tmpDir, ".cline", "agents", filename), content);
		}
		return tmpDir;
	}

	it("returns [] when .cline/agents/ directory does not exist", () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "kb-specialists-test-"));
		expect(loadAgentSpecialists(tmpDir)).toEqual([]);
	});

	it("loads a valid specialist from a .md file without modelId", () => {
		const tmpDir = makeTmpAgentsDir({
			"planner.md": "---\nname: planner\nbaseAgentId: claude\ndescription: Plans tasks\n---\n",
		});
		const result = loadAgentSpecialists(tmpDir);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ name: "planner", baseAgentId: "claude", description: "Plans tasks" });
		expect(result[0]?.modelId).toBeUndefined();
		expect(result[0]?.instructions).toBeUndefined();
	});

	it("loads a valid specialist from a .md file with modelId", () => {
		const tmpDir = makeTmpAgentsDir({
			"poet.md":
				"---\nname: poet\nbaseAgentId: cline\ndescription: Writes beautiful prose\nmodelId: claude-opus-4-5\n---\n",
		});
		const result = loadAgentSpecialists(tmpDir);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			name: "poet",
			baseAgentId: "cline",
			description: "Writes beautiful prose",
			modelId: "claude-opus-4-5",
		});
	});

	it("captures instructions from the Markdown body", () => {
		const tmpDir = makeTmpAgentsDir({
			"reviewer.md":
				"---\nname: reviewer\nbaseAgentId: claude\ndescription: Reviews code\n---\n\nAlways check for security issues first.\nThen review style and correctness.\n",
		});
		const result = loadAgentSpecialists(tmpDir);
		expect(result).toHaveLength(1);
		expect(result[0]?.instructions).toBe(
			"Always check for security issues first.\nThen review style and correctness.",
		);
	});

	it("filters out a file with empty-string modelId in frontmatter", () => {
		const tmpDir = makeTmpAgentsDir({
			"bad.md": "---\nname: bad\nbaseAgentId: cline\ndescription: Has blank model\nmodelId: \n---\n",
			"good.md": "---\nname: good\nbaseAgentId: cline\ndescription: No model field\n---\n",
		});
		const result = loadAgentSpecialists(tmpDir);
		expect(result).toHaveLength(1);
		expect(result[0]?.name).toBe("good");
	});

	it("filters out a file with whitespace-only modelId", () => {
		const tmpDir = makeTmpAgentsDir({
			"bad.md": "---\nname: bad\nbaseAgentId: cline\ndescription: Has whitespace model\nmodelId:    \n---\n",
		});
		expect(loadAgentSpecialists(tmpDir)).toHaveLength(0);
	});

	it("filters out a file missing name field", () => {
		const tmpDir = makeTmpAgentsDir({
			"noname.md": "---\nbaseAgentId: claude\ndescription: Missing name\n---\n",
		});
		expect(loadAgentSpecialists(tmpDir)).toHaveLength(0);
	});

	it("filters out a file missing baseAgentId field", () => {
		const tmpDir = makeTmpAgentsDir({
			"nobase.md": "---\nname: nobase\ndescription: Missing baseAgentId\n---\n",
		});
		expect(loadAgentSpecialists(tmpDir)).toHaveLength(0);
	});

	it("filters out a file missing description field", () => {
		const tmpDir = makeTmpAgentsDir({
			"nodesc.md": "---\nname: nodesc\nbaseAgentId: cline\n---\n",
		});
		expect(loadAgentSpecialists(tmpDir)).toHaveLength(0);
	});

	it("skips a file with malformed frontmatter (no closing ---)", () => {
		const tmpDir = makeTmpAgentsDir({
			"malformed.md": "---\nname: broken\nbaseAgentId: cline\ndescription: No closing delimiter\n",
		});
		expect(loadAgentSpecialists(tmpDir)).toHaveLength(0);
	});

	it("ignores non-.md files in the directory (.json, .txt)", () => {
		const tmpDir = makeTmpAgentsDir({
			"agents.json": '[{"id":"planner","baseAgentId":"claude","description":"Old format"}]',
			"notes.txt": "---\nname: text\nbaseAgentId: cline\ndescription: In a txt file\n---\n",
			"valid.md": "---\nname: valid\nbaseAgentId: cline\ndescription: The only valid one\n---\n",
		});
		const result = loadAgentSpecialists(tmpDir);
		expect(result).toHaveLength(1);
		expect(result[0]?.name).toBe("valid");
	});

	it("returns [] when directory exists but has no .md files", () => {
		const tmpDir = makeTmpAgentsDir({
			"readme.txt": "nothing here",
			"config.json": "{}",
		});
		expect(loadAgentSpecialists(tmpDir)).toHaveLength(0);
	});
});
