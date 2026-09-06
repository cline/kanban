import { describe, expect, it } from "vitest";

import { buildKimiKanbanAgentFileContent } from "../../../src/terminal/kimi-agent-config";

describe("buildKimiKanbanAgentFileContent", () => {
	it("extends the default Kimi Code agent and injects Kanban sidebar instructions", () => {
		const content = buildKimiKanbanAgentFileContent("Kanban sidebar agent\nUse task create.");
		const parsed = JSON.parse(content) as {
			agent?: {
				extend?: string;
				name?: string;
				system_prompt_args?: {
					ROLE_ADDITIONAL?: string;
				};
			};
			version?: number;
		};

		expect(parsed.version).toBe(1);
		expect(parsed.agent?.extend).toBe("default");
		expect(parsed.agent?.name).toBe("kanban");
		expect(parsed.agent?.system_prompt_args?.ROLE_ADDITIONAL).toBe("Kanban sidebar agent\nUse task create.");
	});
});
