import { getClineToolCallDisplay } from "@runtime-cline-tool-call-display";
import { describe, expect, it } from "vitest";
import {
	formatToolInputForDisplay,
	getToolDisplay,
	getToolSummary,
	parseToolMessageContent,
} from "@/components/detail-panels/cline-chat-message-utils";

describe("parseToolMessageContent", () => {
	it("parses tool name input output and duration", () => {
		const parsed = parseToolMessageContent(
			["Tool: Read", "Input:", '{"file":"src/index.ts"}', "Output:", '{"ok":true}', "Duration: 21ms"].join("\n"),
		);

		expect(parsed.toolName).toBe("Read");
		expect(parsed.input).toBe('{"file":"src/index.ts"}');
		expect(parsed.output).toBe('{"ok":true}');
		expect(parsed.error).toBeNull();
		expect(parsed.durationMs).toBe(21);
	});

	it("parses tool errors", () => {
		const parsed = parseToolMessageContent(
			["Tool: Execute", "Input:", "npm run test", "Error:", "Command failed"].join("\n"),
		);

		expect(parsed.toolName).toBe("Execute");
		expect(parsed.input).toBe("npm run test");
		expect(parsed.output).toBeNull();
		expect(parsed.error).toBe("Command failed");
		expect(parsed.durationMs).toBeNull();
	});

	it("strips ANSI escape codes from output", () => {
		const parsed = parseToolMessageContent(
			[
				"Tool: Bash",
				"Input:",
				"npm test",
				"Output:",
				"\x1b[1m\x1b[46m RUN \x1b[49m\x1b[22m src/app.test.ts",
				"\x1b[32m \u2713\x1b[39m should work",
			].join("\n"),
		);

		expect(parsed.output).toBe(" RUN  src/app.test.ts\n \u2713 should work");
	});

	it("strips ANSI escape codes from error", () => {
		const parsed = parseToolMessageContent(
			["Tool: Bash", "Input:", "npm test", "Error:", "\x1b[31mFailed\x1b[39m: test suite crashed"].join("\n"),
		);

		expect(parsed.error).toBe("Failed: test suite crashed");
	});
});

describe("getToolSummary", () => {
	it("parses structured tool calls through the shared runtime helper", () => {
		expect(
			getClineToolCallDisplay("fetch_web_content", {
				requests: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }],
			}),
		).toEqual({
			toolName: "fetch_web_content",
			inputSummary: "https://example.com/a (+1 more)",
		});
	});
	it("shows the full read_files path list from object input", () => {
		expect(
			getToolSummary(
				"read_files",
				JSON.stringify({
					file_paths: ["/tmp/a.ts", "/tmp/b.ts"],
				}),
			),
		).toBe("/tmp/a.ts, /tmp/b.ts");
	});

	it("shows the full readfiles path list from top level array input", () => {
		expect(getToolSummary("readfiles", JSON.stringify(["/tmp/a.ts", "/tmp/b.ts"]))).toBe("/tmp/a.ts, /tmp/b.ts");
	});

	it("shows ranged read_files requests from the SDK files payload", () => {
		expect(
			getToolSummary(
				"read_files",
				JSON.stringify({
					files: [
						{ path: "/tmp/a.ts", start_line: 3, end_line: 5 },
						{ path: "/tmp/b.ts", end_line: 20 },
					],
				}),
			),
		).toBe("/tmp/a.ts:3-5, /tmp/b.ts:1-20");
	});

	it("accepts filePath aliases in read_files requests", () => {
		expect(
			getToolSummary(
				"read_files",
				JSON.stringify({
					files: [{ filePath: "/tmp/a.ts", start_line: 2, end_line: 4 }],
				}),
			),
		).toBe("/tmp/a.ts:2-4");
	});
});

describe("formatToolInputForDisplay", () => {
	it("returns the full command list for run_commands", () => {
		const input = JSON.stringify({
			commands: ["find /some/very/long/path -type f -name '*.ts' | head -80", "cat /some/other/file.txt"],
		});
		expect(formatToolInputForDisplay("run_commands", input)).toBe(
			"find /some/very/long/path -type f -name '*.ts' | head -80\ncat /some/other/file.txt",
		);
	});

	it("returns the full command for a single run_commands entry", () => {
		const input = JSON.stringify({
			commands: ["git log --oneline --all --graph --decorate | head -50"],
		});
		expect(formatToolInputForDisplay("run_commands", input)).toBe(
			"git log --oneline --all --graph --decorate | head -50",
		);
	});

	it("returns null for non-run_commands tools", () => {
		const input = JSON.stringify({ file_paths: ["/tmp/a.ts"] });
		expect(formatToolInputForDisplay("read_files", input)).toBeNull();
	});

	it("returns null for null input", () => {
		expect(formatToolInputForDisplay("run_commands", null)).toBeNull();
	});

	it("returns null for invalid JSON input", () => {
		expect(formatToolInputForDisplay("run_commands", "not json")).toBeNull();
	});

	it("returns null for empty commands array", () => {
		const input = JSON.stringify({ commands: [] });
		expect(formatToolInputForDisplay("run_commands", input)).toBeNull();
	});
});

describe("kanban command display", () => {
	it("shows Creating task for kanban task create with simple prefix", () => {
		const display = getToolDisplay(
			"run_commands",
			JSON.stringify({ commands: ['kanban task create --prompt "Fix the login bug"'] }),
		);
		expect(display.toolName).toBe("Creating task");
		expect(display.inputSummary).toBe("Fix the login bug");
	});

	it("shows Creating task for kanban task create with full node path prefix", () => {
		const display = getToolDisplay(
			"run_commands",
			JSON.stringify({
				commands: [
					"'/opt/homebrew/Cellar/node/25.5.0/bin/node' '/opt/homebrew/lib/kanban/dist/cli.js' task create --prompt \"Add unit tests for auth module\"",
				],
			}),
		);
		expect(display.toolName).toBe("Creating task");
		expect(display.inputSummary).toBe("Add unit tests for auth module");
	});

	it("truncates long prompts in create display", () => {
		const longPrompt = "A".repeat(100);
		const display = getToolDisplay(
			"run_commands",
			JSON.stringify({ commands: [`kanban task create --prompt "${longPrompt}"`] }),
		);
		expect(display.toolName).toBe("Creating task");
		expect(display.inputSummary).toBe(`${"A".repeat(80)}\u2026`);
	});

	it("shows Linking tasks with short IDs", () => {
		const display = getToolDisplay(
			"run_commands",
			JSON.stringify({
				commands: ["kanban task link --task-id abc12345-6789 --linked-task-id def98765-4321"],
			}),
		);
		expect(display.toolName).toBe("Linking tasks");
		expect(display.inputSummary).toBe("abc123 \u2192 def987");
	});

	it("shows Trashing task with short task ID", () => {
		const display = getToolDisplay(
			"run_commands",
			JSON.stringify({ commands: ["kanban task trash --task-id abc12345-6789"] }),
		);
		expect(display.toolName).toBe("Trashing task");
		expect(display.inputSummary).toBe("abc123");
	});

	it("shows Trashing task with column target", () => {
		const display = getToolDisplay(
			"run_commands",
			JSON.stringify({ commands: ["kanban task trash --column in_progress"] }),
		);
		expect(display.toolName).toBe("Trashing task");
		expect(display.inputSummary).toBe("in_progress");
	});

	it("shows Starting task with short task ID", () => {
		const display = getToolDisplay(
			"run_commands",
			JSON.stringify({ commands: ["kanban task start --task-id abc12345-6789"] }),
		);
		expect(display.toolName).toBe("Starting task");
		expect(display.inputSummary).toBe("abc123");
	});

	it("shows Listing tasks with no inputSummary when no column filter", () => {
		const display = getToolDisplay("run_commands", JSON.stringify({ commands: ["kanban task list"] }));
		expect(display.toolName).toBe("Listing tasks");
		expect(display.inputSummary).toBeNull();
	});

	it("shows Listing tasks with column filter", () => {
		const display = getToolDisplay(
			"run_commands",
			JSON.stringify({ commands: ["kanban task list --column backlog"] }),
		);
		expect(display.toolName).toBe("Listing tasks");
		expect(display.inputSummary).toBe("backlog");
	});

	it("shows Updating task with short task ID", () => {
		const display = getToolDisplay(
			"run_commands",
			JSON.stringify({
				commands: ['kanban task update --task-id abc12345-6789 --prompt "New prompt"'],
			}),
		);
		expect(display.toolName).toBe("Updating task");
		expect(display.inputSummary).toBe("abc123");
	});

	it("shows Deleting task with short task ID", () => {
		const display = getToolDisplay(
			"run_commands",
			JSON.stringify({ commands: ["kanban task delete --task-id abc12345-6789"] }),
		);
		expect(display.toolName).toBe("Deleting task");
		expect(display.inputSummary).toBe("abc123");
	});

	it("shows Unlinking tasks with short dependency ID", () => {
		const display = getToolDisplay(
			"run_commands",
			JSON.stringify({ commands: ["kanban task unlink --dependency-id dep12345-6789"] }),
		);
		expect(display.toolName).toBe("Unlinking tasks");
		expect(display.inputSummary).toBe("dep123");
	});

	it("falls back to standard run_commands display for non-kanban commands", () => {
		const display = getToolDisplay("run_commands", JSON.stringify({ commands: ["git status"] }));
		expect(display.toolName).toBe("run_commands");
		expect(display.inputSummary).toBe("git status");
	});

	it("detects kanban command when it is not the first in a multi-command array", () => {
		const display = getToolDisplay(
			"run_commands",
			JSON.stringify({
				commands: ["git status", 'kanban task create --prompt "Fix the bug"'],
			}),
		);
		expect(display.toolName).toBe("Creating task");
		expect(display.inputSummary).toBe("Fix the bug");
	});

	it("does not match non-kanban tools that use task subcommands", () => {
		// A tool named 'grunt' or 'task' itself should not trigger kanban labels
		const display = getToolDisplay("run_commands", JSON.stringify({ commands: ["grunt task create --name foo"] }));
		expect(display.toolName).toBe("run_commands");
	});

	it("detects kanban commands with npx prefix", () => {
		const display = getToolDisplay(
			"run_commands",
			JSON.stringify({ commands: ['npx -y kanban task create --prompt "Test"'] }),
		);
		expect(display.toolName).toBe("Creating task");
		expect(display.inputSummary).toBe("Test");
	});

	it("works with getClineToolCallDisplay directly for kanban commands", () => {
		const display = getClineToolCallDisplay("run_commands", {
			commands: ['kanban task create --prompt "Build the feature"'],
		});
		expect(display.toolName).toBe("Creating task");
		expect(display.inputSummary).toBe("Build the feature");
	});

	it("shows Creating task with single-quoted prompt", () => {
		const display = getToolDisplay(
			"run_commands",
			JSON.stringify({ commands: ["kanban task create --prompt 'Fix the login bug'"] }),
		);
		expect(display.toolName).toBe("Creating task");
		expect(display.inputSummary).toBe("Fix the login bug");
	});
});
