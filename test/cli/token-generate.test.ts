import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

import { generateToken, registerTokenCommand } from "../../src/commands/token";

describe("generateToken", () => {
	it("returns a 64-character hex string", () => {
		const token = generateToken();
		expect(token).toMatch(/^[0-9a-f]{64}$/);
	});

	it("returns a different token on each call", () => {
		const a = generateToken();
		const b = generateToken();
		expect(a).not.toBe(b);
	});
});

describe("registerTokenCommand", () => {
	it("registers a token command with a generate subcommand", () => {
		const program = new Command();
		program.exitOverride();
		registerTokenCommand(program);

		const tokenCmd = program.commands.find((cmd) => cmd.name() === "token");
		expect(tokenCmd).toBeDefined();

		const generateCmd = tokenCmd?.commands.find((cmd) => cmd.name() === "generate");
		expect(generateCmd).toBeDefined();
	});

	it("writes a 64-char hex token followed by a newline to stdout", async () => {
		const program = new Command();
		program.exitOverride();
		registerTokenCommand(program);

		const written: string[] = [];
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
			written.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
			return true;
		});

		try {
			await program.parseAsync(["token", "generate"], { from: "user" });
		} finally {
			writeSpy.mockRestore();
		}

		expect(written).toHaveLength(1);
		const output = written[0] ?? "";
		expect(output).toMatch(/^[0-9a-f]{64}\n$/);
	});

	it("produces raw output with no labels or extra text", async () => {
		const program = new Command();
		program.exitOverride();
		registerTokenCommand(program);

		const written: string[] = [];
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
			written.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
			return true;
		});

		try {
			await program.parseAsync(["token", "generate"], { from: "user" });
		} finally {
			writeSpy.mockRestore();
		}

		const output = written.join("");
		// Should be exactly: 64 hex chars + newline — nothing else
		expect(output.length).toBe(65);
		expect(output[64]).toBe("\n");
		expect(output.slice(0, 64)).toMatch(/^[0-9a-f]{64}$/);
	});
});
