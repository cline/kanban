import { describe, expect, it } from "vitest";

// The notarize script is CJS (.cjs) — use createRequire to load it in ESM context.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
	checkEnvironment,
	shouldNotarize,
	REQUIRED_ENV_VARS,
} = require("../scripts/notarize.cjs") as {
	checkEnvironment: (
		env: Record<string, string | undefined>,
	) => { ok: true } | { ok: false; missing: string[] };
	shouldNotarize: (
		platformName: string,
		env: Record<string, string | undefined>,
	) =>
		| { shouldNotarize: true }
		| { shouldNotarize: false; reason: string };
	REQUIRED_ENV_VARS: string[];
};

// ---------------------------------------------------------------------------
// REQUIRED_ENV_VARS
// ---------------------------------------------------------------------------

describe("REQUIRED_ENV_VARS", () => {
	it("contains APPLE_ID, APPLE_ID_PASSWORD, and APPLE_TEAM_ID", () => {
		expect(REQUIRED_ENV_VARS).toContain("APPLE_ID");
		expect(REQUIRED_ENV_VARS).toContain("APPLE_ID_PASSWORD");
		expect(REQUIRED_ENV_VARS).toContain("APPLE_TEAM_ID");
	});
});

// ---------------------------------------------------------------------------
// checkEnvironment
// ---------------------------------------------------------------------------

describe("checkEnvironment", () => {
	const fullEnv: Record<string, string> = {
		APPLE_ID: "dev@example.com",
		APPLE_ID_PASSWORD: "xxxx-xxxx-xxxx-xxxx",
		APPLE_TEAM_ID: "ABC1234567",
	};

	it("returns ok when all env vars are present", () => {
		const result = checkEnvironment(fullEnv);
		expect(result).toEqual({ ok: true });
	});

	it("returns missing vars when APPLE_ID is absent", () => {
		const env = { ...fullEnv, APPLE_ID: undefined };
		const result = checkEnvironment(env);
		expect(result).toEqual({ ok: false, missing: ["APPLE_ID"] });
	});

	it("returns missing vars when APPLE_ID_PASSWORD is absent", () => {
		const env = { ...fullEnv, APPLE_ID_PASSWORD: undefined };
		const result = checkEnvironment(env);
		expect(result).toEqual({ ok: false, missing: ["APPLE_ID_PASSWORD"] });
	});

	it("returns missing vars when APPLE_TEAM_ID is absent", () => {
		const env = { ...fullEnv, APPLE_TEAM_ID: undefined };
		const result = checkEnvironment(env);
		expect(result).toEqual({ ok: false, missing: ["APPLE_TEAM_ID"] });
	});

	it("returns all missing vars when env is empty", () => {
		const result = checkEnvironment({});
		expect(result).toEqual({
			ok: false,
			missing: ["APPLE_ID", "APPLE_ID_PASSWORD", "APPLE_TEAM_ID"],
		});
	});

	it("treats empty string as missing", () => {
		const env = { ...fullEnv, APPLE_ID: "" };
		const result = checkEnvironment(env);
		expect(result).toEqual({ ok: false, missing: ["APPLE_ID"] });
	});
});

// ---------------------------------------------------------------------------
// shouldNotarize
// ---------------------------------------------------------------------------

describe("shouldNotarize", () => {
	const fullEnv: Record<string, string> = {
		APPLE_ID: "dev@example.com",
		APPLE_ID_PASSWORD: "xxxx-xxxx-xxxx-xxxx",
		APPLE_TEAM_ID: "ABC1234567",
	};

	// NOTE: The platform string passed to shouldNotarize is
	// `context.electronPlatformName` from electron-builder's afterSign hook.
	// It is the **Electron** platform name ("darwin"/"win32"/"linux"), NOT the
	// electron-builder config alias ("mac"/"win"/"linux"). Tests use the
	// actual runtime contract, not the config-file aliases.

	it("returns shouldNotarize true for darwin (macOS) with full env", () => {
		const result = shouldNotarize("darwin", fullEnv);
		expect(result).toEqual({ shouldNotarize: true });
	});

	it("skips notarization for win32 platform", () => {
		const result = shouldNotarize("win32", fullEnv);
		expect(result.shouldNotarize).toBe(false);
		if (!result.shouldNotarize) {
			expect(result.reason).toContain("win32");
			expect(result.reason).toContain("not \"darwin\"");
		}
	});

	it("skips notarization for linux platform", () => {
		const result = shouldNotarize("linux", fullEnv);
		expect(result.shouldNotarize).toBe(false);
		if (!result.shouldNotarize) {
			expect(result.reason).toContain("linux");
		}
	});

	// Regression guard: the electron-builder config alias "mac" must NOT be
	// treated as the runtime platform string. If this test ever starts
	// passing, it means someone re-introduced the "mac" check — which would
	// silently disable notarization on every real macOS release build.
	it("treats the config alias \"mac\" as a non-matching platform (regression guard)", () => {
		const result = shouldNotarize("mac", fullEnv);
		expect(result.shouldNotarize).toBe(false);
		if (!result.shouldNotarize) {
			expect(result.reason).toContain("not \"darwin\"");
		}
	});

	it("skips notarization when env vars are missing on darwin", () => {
		const result = shouldNotarize("darwin", {});
		expect(result.shouldNotarize).toBe(false);
		if (!result.shouldNotarize) {
			expect(result.reason).toContain("missing env vars");
			expect(result.reason).toContain("APPLE_ID");
		}
	});

	it("skips notarization when only some env vars are set", () => {
		const partialEnv = { APPLE_ID: "dev@example.com" };
		const result = shouldNotarize("darwin", partialEnv);
		expect(result.shouldNotarize).toBe(false);
		if (!result.shouldNotarize) {
			expect(result.reason).toContain("APPLE_ID_PASSWORD");
			expect(result.reason).toContain("APPLE_TEAM_ID");
		}
	});
});
