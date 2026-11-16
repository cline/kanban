import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { getDaemonLogPath } from "../../src/cli/daemon-logs";
import {
	getOptionWasProvided,
	normalizeLaunchOptions,
	parseCliPortValue,
	registerLaunchOptions,
	toLaunchArgs,
} from "../../src/cli/launch-options";
import { getProcessStartedAt, isProcessAlive } from "../../src/cli/process-control";

describe("daemon launch options", () => {
	it("parses fixed and automatic ports", () => {
		expect(parseCliPortValue("4000")).toEqual({ mode: "fixed", value: 4000 });
		expect(parseCliPortValue("AUTO")).toEqual({ mode: "auto" });
		expect(() => parseCliPortValue("0")).toThrow("Invalid port value");
	});

	it("round-trips shared launch flags into child arguments", async () => {
		const program = new Command().enablePositionalOptions();
		const start = program.command("start");
		registerLaunchOptions(start);
		let received: ReturnType<typeof normalizeLaunchOptions> | undefined;
		let command: Command | undefined;
		start.action((options, actionCommand) => {
			received = normalizeLaunchOptions(options);
			command = actionCommand;
		});

		await program.parseAsync(
			["start", "--host", "0.0.0.0", "--port", "auto", "--no-open", "--https", "--cert", "cert.pem"],
			{ from: "user" },
		);

		expect(received).toMatchObject({
			host: "0.0.0.0",
			port: { mode: "auto" },
			open: false,
			https: true,
			cert: "cert.pem",
		});
		expect(command).toBeDefined();
		expect(getOptionWasProvided(command as Command, "host")).toBe(true);
		expect(getOptionWasProvided(command as Command, "key")).toBe(false);
		expect(toLaunchArgs(received as ReturnType<typeof normalizeLaunchOptions>)).toEqual([
			"--host",
			"0.0.0.0",
			"--port",
			"auto",
			"--no-open",
			"--https",
			"--cert",
			"cert.pem",
		]);
	});
});

describe("daemon support utilities", () => {
	it("uses the local date in the daemon log filename", () => {
		expect(getDaemonLogPath(new Date(2026, 8, 7))).toMatch(/daemon-20260907\.log$/u);
	});

	it("can inspect the current process lifetime", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
		expect(getProcessStartedAt(process.pid)).toBeInstanceOf(Date);
	});
});
