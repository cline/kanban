import { randomBytes } from "node:crypto";

import type { Command } from "commander";

export function generateToken(): string {
	return randomBytes(32).toString("hex");
}

export function registerTokenCommand(program: Command): void {
	const token = program.command("token").description("Auth token utilities.");

	token
		.command("generate")
		.description("Generate a random auth token and print it to stdout.")
		.action(() => {
			process.stdout.write(`${generateToken()}\n`);
		});
}
