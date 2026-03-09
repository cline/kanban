import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTempDir(prefix = "kanban-test-"): { path: string; cleanup: () => void } {
	const path = mkdtempSync(join(tmpdir(), prefix));
	return {
		path,
		cleanup: () => rmSync(path, { recursive: true, force: true }),
	};
}
