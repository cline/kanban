#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_DURATION_MS = 30_000;
const DEFAULT_INTERVAL_MS = 250;

function parsePositiveNumber(value, optionName) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${optionName} must be a positive number.`);
	}
	return parsed;
}

function parseArguments(argv) {
	const options = {
		durationMs: DEFAULT_DURATION_MS,
		intervalMs: DEFAULT_INTERVAL_MS,
		outputPath: null,
		pids: [],
		quiet: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--help" || argument === "-h") {
			options.help = true;
			continue;
		}
		if (argument === "--quiet") {
			options.quiet = true;
			continue;
		}
		const [name, inlineValue] = argument.split("=", 2);
		const value = inlineValue ?? argv[++index];
		if (!value) {
			throw new Error(`${name} requires a value.`);
		}
		switch (name) {
			case "--pid":
				options.pids.push(Math.floor(parsePositiveNumber(value, name)));
				break;
			case "--duration":
				options.durationMs = parsePositiveNumber(value, name) * 1_000;
				break;
			case "--interval":
				options.intervalMs = parsePositiveNumber(value, name);
				break;
			case "--output":
				options.outputPath = path.resolve(value);
				break;
			default:
				throw new Error(`Unknown option: ${name}`);
		}
	}

	return options;
}

function printHelp() {
	process.stdout.write(`Usage: node scripts/monitor-performance.mjs [options]\n\n`);
	process.stdout.write(`Options:\n`);
	process.stdout.write(`  --pid <pid>       Monitor a Kanban runtime PID (repeatable)\n`);
	process.stdout.write(`  --duration <sec>  Sampling duration (default: 30)\n`);
	process.stdout.write(`  --interval <ms>   Sampling interval (default: 250)\n`);
	process.stdout.write(`  --output <path>   JSON report path\n`);
	process.stdout.write(`  --quiet           Suppress periodic sample output\n`);
	process.stdout.write(`  --help            Show this help\n`);
}

function parseCpuTime(value) {
	const dayParts = value.split("-");
	const clock = dayParts.at(-1) ?? "0";
	const days = dayParts.length === 2 ? Number(dayParts[0]) : 0;
	const parts = clock.split(":").map(Number);
	if (parts.some((part) => !Number.isFinite(part))) {
		return 0;
	}
	const seconds = parts.pop() ?? 0;
	const minutes = parts.pop() ?? 0;
	const hours = parts.pop() ?? 0;
	return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

function parseProcessTable(stdout) {
	const processes = [];
	for (const line of stdout.split("\n")) {
		const match = line.match(
			/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/,
		);
		if (!match) {
			continue;
		}
		processes.push({
			pid: Number(match[1]),
			ppid: Number(match[2]),
			psCpuPercent: Number(match[3]),
			memoryPercent: Number(match[4]),
			rssBytes: Number(match[5]) * 1_024,
			cpuSeconds: parseCpuTime(match[6]),
			elapsed: match[7],
			command: match[8],
		});
	}
	return processes;
}

async function readProcesses() {
	const { stdout } = await execFileAsync("ps", [
		"-axo",
		"pid=,ppid=,%cpu=,%mem=,rss=,time=,etime=,command=",
	], { maxBuffer: 16 * 1024 * 1024 });
	return parseProcessTable(stdout);
}

function isKanbanRuntime(command) {
	return (
		/(?:src\/cli\.ts|dist\/cli\.js)(?:\s|$)/.test(command) &&
		!/(?:\shooks\s|\stask\s)/.test(command)
	);
}

function isKanbanHook(command) {
	return (
		/(?:src\/codex-hook-cli\.ts|dist\/codex-hook\.js)(?:\s|$)/.test(command) ||
		/(?:src\/cli\.ts|dist\/cli\.js)\s+hooks(?:\s|$)/.test(command)
	);
}

function findRuntimePids(processes) {
	return processes.filter((entry) => isKanbanRuntime(entry.command)).map((entry) => entry.pid);
}

function collectDescendantPids(processes, rootPids) {
	const childrenByParent = new Map();
	for (const entry of processes) {
		const children = childrenByParent.get(entry.ppid) ?? [];
		children.push(entry.pid);
		childrenByParent.set(entry.ppid, children);
	}

	const descendants = new Set(rootPids);
	const pending = [...rootPids];
	while (pending.length > 0) {
		const parentPid = pending.pop();
		for (const childPid of childrenByParent.get(parentPid) ?? []) {
			if (descendants.has(childPid)) {
				continue;
			}
			descendants.add(childPid);
			pending.push(childPid);
		}
	}
	return descendants;
}

function categorizeProcess(entry, rootPids, processByPid, categoryByPid) {
	const cachedCategory = categoryByPid.get(entry.pid);
	if (cachedCategory) {
		return cachedCategory;
	}

	let category;
	if (rootPids.has(entry.pid)) {
		category = "runtime";
	} else if (isKanbanHook(entry.command)) {
		category = "hook";
	} else if (/(?:codex|claude|cline|opencode|gemini|kiro|droid)/i.test(entry.command)) {
		category = "agent";
	} else {
		const parent = processByPid.get(entry.ppid);
		const parentCategory = parent ? categorizeProcess(parent, rootPids, processByPid, categoryByPid) : null;
		if (parentCategory === "hook") {
			category = "hook";
		} else if (parentCategory === "agent") {
			category = "agent";
		} else if (/(?:^|\/|\()(?:git)(?:\)|\s|$)/.test(entry.command)) {
			category = "git";
		} else if (/(?:node-pty|pty-host|login\s+-|\/bin\/(?:zsh|bash|fish))(?:\s|$)/.test(entry.command)) {
			category = "terminal";
		} else {
			category = "other-child";
		}
	}

	categoryByPid.set(entry.pid, category);
	return category;
}

function getExecutableName(command) {
	const executable = command.trim().split(/\s+/, 1)[0] ?? "unknown";
	return path.basename(executable.replace(/^\(|\)$/g, "")) || "unknown";
}

function round(value, digits = 2) {
	const scale = 10 ** digits;
	return Math.round(value * scale) / scale;
}

function percentile(values, ratio) {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

function summarize(samples, seenProcesses) {
	const categories = new Set(samples.flatMap((sample) => Object.keys(sample.categories)));
	const categorySummary = {};
	for (const category of categories) {
		const cpuValues = samples.map((sample) => sample.categories[category]?.cpuPercent ?? 0);
		const rssValues = samples.map((sample) => sample.categories[category]?.rssBytes ?? 0);
		categorySummary[category] = {
			averageCpuPercent: round(cpuValues.reduce((sum, value) => sum + value, 0) / cpuValues.length),
			p95CpuPercent: round(percentile(cpuValues, 0.95)),
			maximumCpuPercent: round(Math.max(...cpuValues)),
			averageRssMiB: round(rssValues.reduce((sum, value) => sum + value, 0) / rssValues.length / 1024 / 1024),
			maximumRssMiB: round(Math.max(...rssValues) / 1024 / 1024),
		};
	}

	const processCounts = {};
	for (const processInfo of seenProcesses.values()) {
		processCounts[processInfo.category] = (processCounts[processInfo.category] ?? 0) + 1;
	}

	return { categories: categorySummary, uniqueProcessesSeen: processCounts };
}

function defaultOutputPath() {
	const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
	return path.join(os.tmpdir(), "kanban-performance-reports", `kanban-performance-${timestamp}.json`);
}

function sleep(durationMs) {
	return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function main() {
	const options = parseArguments(process.argv.slice(2));
	if (options.help) {
		printHelp();
		return;
	}

	const initialProcesses = await readProcesses();
	const detectedPids = options.pids.length > 0 ? options.pids : findRuntimePids(initialProcesses);
	if (detectedPids.length === 0) {
		throw new Error("No Kanban runtime process found. Pass --pid with the runtime PID.");
	}

	const rootPids = new Set(detectedPids);
	const samples = [];
	const seenProcesses = new Map();
	const previousCpuByPid = new Map();
	let previousSampleTime = null;
	const startedAt = new Date();
	const deadline = performance.now() + options.durationMs;

	process.stdout.write(
		`Monitoring Kanban runtime PID${rootPids.size === 1 ? "" : "s"} ${[...rootPids].join(", ")} for ${options.durationMs / 1_000}s\n`,
	);

	while (performance.now() < deadline) {
		const sampleStartedAt = performance.now();
		const processes = await readProcesses();
		const processByPid = new Map(processes.map((entry) => [entry.pid, entry]));
		const descendantPids = collectDescendantPids(processes, rootPids);
		const monitorPids = collectDescendantPids(processes, new Set([process.pid]));
		const elapsedSeconds = previousSampleTime === null ? null : (sampleStartedAt - previousSampleTime) / 1_000;
		const categories = {};
		const categoryByPid = new Map();

		for (const pid of descendantPids) {
			if (monitorPids.has(pid)) {
				continue;
			}
			const entry = processByPid.get(pid);
			if (!entry) {
				continue;
			}
			const category = categorizeProcess(entry, rootPids, processByPid, categoryByPid);
			const previousCpuSeconds = previousCpuByPid.get(pid);
			const measuredCpuPercent =
				previousCpuSeconds === undefined || elapsedSeconds === null
					? entry.psCpuPercent
					: Math.max(0, ((entry.cpuSeconds - previousCpuSeconds) / elapsedSeconds) * 100);
			previousCpuByPid.set(pid, entry.cpuSeconds);
			const aggregate = categories[category] ?? { cpuPercent: 0, rssBytes: 0, processCount: 0 };
			aggregate.cpuPercent += measuredCpuPercent;
			aggregate.rssBytes += entry.rssBytes;
			aggregate.processCount += 1;
			categories[category] = aggregate;
			if (!seenProcesses.has(pid)) {
				seenProcesses.set(pid, {
					pid,
					ppid: entry.ppid,
					category,
					executable: getExecutableName(entry.command),
				});
			}
		}

		for (const aggregate of Object.values(categories)) {
			aggregate.cpuPercent = round(aggregate.cpuPercent);
		}
		const sample = {
			timestamp: new Date().toISOString(),
			loadAverage: os.loadavg().map((value) => round(value)),
			freeMemoryBytes: os.freemem(),
			categories,
		};
		samples.push(sample);
		previousSampleTime = sampleStartedAt;

		if (!options.quiet && (samples.length === 1 || samples.length % Math.max(1, Math.round(1_000 / options.intervalMs)) === 0)) {
			const runtime = categories.runtime ?? { cpuPercent: 0, rssBytes: 0 };
			const childrenCpu = Object.entries(categories)
				.filter(([category]) => category !== "runtime")
				.reduce((sum, [, value]) => sum + value.cpuPercent, 0);
			process.stdout.write(
				`${sample.timestamp} runtime=${round(runtime.cpuPercent)}%/${round(runtime.rssBytes / 1024 / 1024)}MiB children=${round(childrenCpu)}%\n`,
			);
		}

		const sampleDurationMs = performance.now() - sampleStartedAt;
		await sleep(Math.max(0, options.intervalMs - sampleDurationMs));
	}

	const outputPath = options.outputPath ?? defaultOutputPath();
	const report = {
		metadata: {
			startedAt: startedAt.toISOString(),
			finishedAt: new Date().toISOString(),
			durationMs: options.durationMs,
			intervalMs: options.intervalMs,
			logicalCpuCount: os.cpus().length,
			platform: process.platform,
			rootPids: [...rootPids],
		},
		summary: summarize(samples, seenProcesses),
		processes: [...seenProcesses.values()],
		samples,
	};
	await mkdir(path.dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

	process.stdout.write(`\nSummary\n`);
	for (const [category, values] of Object.entries(report.summary.categories)) {
		process.stdout.write(
			`${category.padEnd(12)} avg CPU ${String(values.averageCpuPercent).padStart(6)}%  p95 ${String(values.p95CpuPercent).padStart(6)}%  avg RSS ${String(values.averageRssMiB).padStart(8)} MiB\n`,
		);
	}
	process.stdout.write(`Report: ${outputPath}\n`);
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
