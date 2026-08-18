import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { listProjectSkillSlashCommands } from "../../../src/skills/project-skills";

describe("listProjectSkillSlashCommands", () => {
	const cleanups: Array<() => Promise<void>> = [];
	afterEach(async () => {
		await Promise.all(cleanups.splice(0).map((fn) => fn()));
	});

	it("lists nested skills and prefers .cline over .agents", async () => {
		const root = await mkdtemp(join(tmpdir(), "kanban-skill-list-"));
		cleanups.push(async () => {
			await rm(root, { recursive: true, force: true });
		});
		await mkdir(join(root, ".cline", "skills", "shared"), { recursive: true });
		await mkdir(join(root, ".agents", "skills", "shared"), { recursive: true });
		await mkdir(join(root, ".agents", "skills", "docs", "mdcp-doc-only"), { recursive: true });
		await writeFile(
			join(root, ".cline", "skills", "shared", "SKILL.md"),
			"---\nname: shared\ndescription: From cline\n---\n",
		);
		await writeFile(
			join(root, ".agents", "skills", "shared", "SKILL.md"),
			"---\nname: shared\ndescription: From agents\n---\n",
		);
		await writeFile(
			join(root, ".agents", "skills", "docs", "mdcp-doc-only", "SKILL.md"),
			"---\nname: mdcp-doc-only\ndescription: Author MDCP shards.\ndisable-model-invocation: true\n---\n",
		);
		const commands = listProjectSkillSlashCommands(root);
		const shared = commands.find((command) => command.name === "shared");
		const mdcp = commands.find((command) => command.name === "mdcp-doc-only");
		expect(shared?.description).toBe("From cline");
		expect(mdcp?.description).toBe("Author MDCP shards.");
	});
});
