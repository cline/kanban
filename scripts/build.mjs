import * as esbuild from "esbuild";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Modules that must stay external (native addons, large runtime deps that
 * don't bundle cleanly, or deps using dynamic require patterns).
 *
 * These are resolved at runtime via Node's node_modules lookup. For most
 * contexts (`npm i -g kanban`, monorepo dev) the enclosing node_modules/
 * satisfies resolution. For contexts that don't have one — notably the
 * Electron desktop app at `Resources/cli/` — this script can also stage the
 * externals into `dist/node_modules/` to produce a self-contained deployable
 * (opt-in via --stage, see the section at the bottom of this file).
 */
const external = [
	"node-pty",
	"@sentry/node",
	"proper-lockfile",
	"tree-kill",
	"ws",
	"open",
	"@trpc/client",
	"@trpc/server",
	"@modelcontextprotocol/sdk",
	"commander",
	"zod",
];

/** Bake OTEL telemetry env vars into the bundle at build time. */
const define = {
	"process.env.NODE_ENV": '"production"',
	"process.env.OTEL_TELEMETRY_ENABLED": JSON.stringify(process.env.OTEL_TELEMETRY_ENABLED ?? ""),
	"process.env.OTEL_EXPORTER_OTLP_ENDPOINT": JSON.stringify(process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? ""),
	"process.env.OTEL_METRICS_EXPORTER": JSON.stringify(process.env.OTEL_METRICS_EXPORTER ?? ""),
	"process.env.OTEL_LOGS_EXPORTER": JSON.stringify(process.env.OTEL_LOGS_EXPORTER ?? ""),
	"process.env.OTEL_EXPORTER_OTLP_PROTOCOL": JSON.stringify(process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? ""),
	"process.env.OTEL_METRIC_EXPORT_INTERVAL": JSON.stringify(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? ""),
	"process.env.OTEL_EXPORTER_OTLP_HEADERS": JSON.stringify(process.env.OTEL_EXPORTER_OTLP_HEADERS ?? ""),
};

/**
 * Bundled CJS dependencies call require() on Node built-ins (process, fs, etc.).
 * ESM output needs a real require() function for those calls to work.
 */
const cjsShimBanner = [
	'import { createRequire as __kanban_createRequire } from "node:module";',
	"const require = __kanban_createRequire(import.meta.url);",
].join("\n");

/** Shared esbuild options for both entry points. */
const shared = {
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node20",
	external,
	define,
	sourcemap: true,
	packages: "bundle",
	banner: { js: cjsShimBanner },
};

await Promise.all([
	// CLI binary
	esbuild.build({
		...shared,
		entryPoints: ["src/cli.ts"],
		outfile: "dist/cli.js",
		banner: { js: `#!/usr/bin/env node\n${cjsShimBanner}` },
	}),
	// Library export
	esbuild.build({
		...shared,
		entryPoints: ["src/index.ts"],
		outfile: "dist/index.js",
	}),
]);

console.log("esbuild: bundled dist/cli.js and dist/index.js");

// ---------------------------------------------------------------------------
// Optional: stage external runtime deps into dist/node_modules/
// ---------------------------------------------------------------------------
//
// cli.js has literal `import "zod"` / `require("ws")` statements for every
// name in `external`. Node resolves those via node_modules lookup starting
// from cli.js's location. In two contexts resolution is already handled:
//
//   1. `npm i -g kanban` — npm installs the package's production deps into
//      lib/node_modules/kanban/node_modules/, which satisfies resolution for
//      dist/cli.js one level up.
//   2. Monorepo dev (`npm run dev`) — root node_modules/ satisfies it.
//
// A third context, the Electron desktop app, ships `dist/` to a location
// (`Resources/cli/`) with no enclosing node_modules/. For that case this
// script can ALSO install the externals into `dist/node_modules/` to produce
// a self-contained deployable — opt in with --stage or KANBAN_STAGE_RUNTIME_DEPS=1.
//
// Staging is off by default because it pulls ~127 MB of transitive deps and
// would bloat every published npm tarball (the default `"files": ["dist"]`
// in package.json includes nested node_modules).

const stageRuntimeDeps =
	process.argv.includes("--stage") ||
	process.env.KANBAN_STAGE_RUNTIME_DEPS === "1";

if (!stageRuntimeDeps) {
	console.log(
		"skipping dist/node_modules staging (pass --stage or set KANBAN_STAGE_RUNTIME_DEPS=1 to enable)",
	);
	process.exit(0);
}

const rootPkg = JSON.parse(readFileSync("package.json", "utf-8"));
const rootDeps = { ...rootPkg.dependencies, ...rootPkg.devDependencies };
const runtimeDeps = Object.fromEntries(
	external
		.map((name) => [name, rootDeps[name]])
		.filter(([, v]) => typeof v === "string"),
);

const missing = external.filter((name) => !(name in runtimeDeps));
if (missing.length > 0) {
	throw new Error(
		`build.mjs: externals missing from root package.json: ${missing.join(", ")}`,
	);
}

mkdirSync("dist", { recursive: true });
writeFileSync(
	"dist/package.json",
	`${JSON.stringify(
		{
			name: "kanban-cli-runtime-deps",
			version: "0.0.0",
			private: true,
			type: "module",
			dependencies: runtimeDeps,
		},
		null,
		2,
	)}\n`,
);

console.log("staging runtime deps into dist/node_modules/ ...");
execSync("npm install --omit=dev --no-audit --no-fund --ignore-scripts", {
	cwd: "dist",
	stdio: "inherit",
});
console.log(`staged ${Object.keys(runtimeDeps).length} runtime deps`);
