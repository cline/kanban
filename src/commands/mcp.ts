import { runKanbanMcpServer } from "../mcp/server.js";

interface McpCliOptions {
	help: boolean;
}

export function isMcpSubcommand(argv: string[]): boolean {
	return argv[0] === "mcp";
}

function parseMcpCliOptions(args: string[]): McpCliOptions {
	let help = false;
	for (const arg of args) {
		if (arg === "--help" || arg === "-h") {
			help = true;
		}
	}
	return {
		help,
	};
}

function printMcpHelp(): void {
	process.stdout.write("kanban mcp\n");
	process.stdout.write("Run Kanban as a local MCP stdio server.\n");
	process.stdout.write("\n");
	process.stdout.write("Usage:\n");
	process.stdout.write("  kanban mcp\n");
	process.stdout.write("  kanban mcp --help\n");
}

export async function runMcpSubcommand(argv: string[]): Promise<void> {
	const options = parseMcpCliOptions(argv.slice(1));
	if (options.help) {
		printMcpHelp();
		return;
	}
	await runKanbanMcpServer(process.cwd());
}
