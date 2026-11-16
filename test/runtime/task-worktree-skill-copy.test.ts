import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { copyProjectSkillTrees } from "../../src/workspace/task-worktree";

describe("copyProjectSkillTrees", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		await Promise.all(cleanups.splice(0).map((fn) => fn()));
	});

	it("copies skill trees as real directories, overwriting stale worktree copies", async () => {
		const root = await mkdtemp(join(tmpdir(), "kanban-skill-copy-"));
		cleanups.push(async () => {
			await rm(root, { recursive: true, force: true });
		});
		const repo = join(root, "repo");
		const worktree = join(root, "worktree");
		await mkdir(join(repo, ".cline", "skills", "boot"), { recursive: true });
		await mkdir(join(repo, ".agents", "skills", "mdcp"), { recursive: true });
		await writeFile(join(repo, ".cline", "skills", "boot", "SKILL.md"), "parent boot\n");
		await writeFile(join(repo, ".agents", "skills", "mdcp", "SKILL.md"), "parent mdcp\n");
		await mkdir(join(worktree, ".cline", "skills", "boot"), { recursive: true });
		await writeFile(join(worktree, ".cline", "skills", "boot", "SKILL.md"), "stale\n");

		const copied = await copyProjectSkillTrees(repo, worktree);

		expect(copied.sort()).toEqual([".agents", ".cline/skills"]);
		expect(await readFile(join(worktree, ".cline", "skills", "boot", "SKILL.md"), "utf8")).toBe("parent boot\n");
		expect(await readFile(join(worktree, ".agents", "skills", "mdcp", "SKILL.md"), "utf8")).toBe("parent mdcp\n");
		const st = await lstat(join(worktree, ".agents"));
		expect(st.isSymbolicLink()).toBe(false);
	});
});
