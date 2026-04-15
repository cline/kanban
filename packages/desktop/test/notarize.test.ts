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

	it("returns shouldNotarize true for mac with full env", () => {
		const result = shouldNotarize("mac", fullEnv);
		expect(result).toEqual({ shouldNotarize: true });
	});

	it("skips notarization for win platform", () => {
		const result = shouldNotarize("win", fullEnv);
		expect(result.shouldNotarize).toBe(false);
		if (!result.shouldNotarize) {
			expect(result.reason).toContain("win");
			expect(result.reason).toContain("not \"mac\"");
		}
	});

	it("skips notarization for linux platform", () => {
		const result = shouldNotarize("linux", fullEnv);
		expect(result.shouldNotarize).toBe(false);
		if (!result.shouldNotarize) {
			expect(result.reason).toContain("linux");
		}
	});

	it("skips notarization when env vars are missing on mac", () => {
		const result = shouldNotarize("mac", {});
		expect(result.shouldNotarize).toBe(false);
		if (!result.shouldNotarize) {
			expect(result.reason).toContain("missing env vars");
			expect(result.reason).toContain("APPLE_ID");
		}
	});

	it("skips notarization when only some env vars are set", () => {
		const partialEnv = { APPLE_ID: "dev@example.com" };
		const result = shouldNotarize("mac", partialEnv);
		expect(result.shouldNotarize).toBe(false);
		if (!result.shouldNotarize) {
			expect(result.reason).toContain("APPLE_ID_PASSWORD");
			expect(result.reason).toContain("APPLE_TEAM_ID");
		}
	});
});
