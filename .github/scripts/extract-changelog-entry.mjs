import { appendFileSync, existsSync, readFileSync } from "node:fs";

function parseArgs(argv) {
	const options = {
		version: "",
		changelog: "CHANGELOG.md",
		outputKey: "body",
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--version") {
			options.version = argv[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (arg === "--changelog") {
			options.changelog = argv[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (arg === "--output-key") {
			options.outputKey = argv[index + 1] ?? "";
			index += 1;
		}
	}

	return options;
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fail(message) {
	throw new Error(message);
}

function main() {
	const { version, changelog, outputKey } = parseArgs(process.argv.slice(2));
	if (!version) {
		fail("--version is required");
	}
	if (!outputKey) {
		fail("--output-key cannot be empty");
	}
	const outputPath = process.env.GITHUB_OUTPUT;
	if (!outputPath) {
		fail("GITHUB_OUTPUT is required");
	}
	if (!existsSync(changelog)) {
		fail(`${changelog} is required for releases`);
	}

	const headingRegex = new RegExp(`^##\\s+\\[?v?${escapeRegex(version)}\\]?\\b`);
	const lines = readFileSync(changelog, "utf8").split(/\r?\n/u);
	const headingIndex = lines.findIndex((line) => headingRegex.test(line.trim()));
	if (headingIndex === -1) {
		fail(`No changelog section found for version ${version}`);
	}

	let endIndex = lines.length;
	for (let index = headingIndex + 1; index < lines.length; index += 1) {
		if (/^##\s+/u.test(lines[index])) {
			endIndex = index;
			break;
		}
	}

	const body = lines.slice(headingIndex + 1, endIndex).join("\n").trim();
	if (!body) {
		fail(`Changelog section for version ${version} is empty`);
	}

	appendFileSync(outputPath, `${outputKey}<<EOF\n${body}\nEOF\n`);
}

main();
