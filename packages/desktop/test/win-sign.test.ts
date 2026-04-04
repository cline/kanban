import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
	checkEnvVars,
	detectSigningMode,
	decodePfxToTempFile,
	AZURE_REQUIRED_ENV_VARS,
	PFX_REQUIRED_ENV_VARS,
	TIMESTAMP_SERVER,
} = require("../scripts/win-sign.cjs") as {
	checkEnvVars: (
		keys: readonly string[],
		env: Record<string, string | undefined>,
	) => { ok: true } | { ok: false; missing: string[] };
	detectSigningMode: (
		env: Record<string, string | undefined>,
	) =>
		| { mode: "azure" }
		| { mode: "pfx" }
		| { mode: "none"; reason: string };
	decodePfxToTempFile: (base64Content: string) => string;
	AZURE_REQUIRED_ENV_VARS: readonly string[];
	PFX_REQUIRED_ENV_VARS: readonly string[];
	TIMESTAMP_SERVER: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("AZURE_REQUIRED_ENV_VARS", () => {
	it("contains the expected Azure signing env vars", () => {
		expect(AZURE_REQUIRED_ENV_VARS).toContain("AZURE_SIGN_ENDPOINT");
		expect(AZURE_REQUIRED_ENV_VARS).toContain("AZURE_SIGN_CERT_PROFILE");
		expect(AZURE_REQUIRED_ENV_VARS).toContain("AZURE_SIGN_CODE_SIGNING_ACCOUNT");
	});
});

describe("PFX_REQUIRED_ENV_VARS", () => {
	it("contains WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD", () => {
		expect(PFX_REQUIRED_ENV_VARS).toContain("WIN_CSC_LINK");
		expect(PFX_REQUIRED_ENV_VARS).toContain("WIN_CSC_KEY_PASSWORD");
	});
});

describe("TIMESTAMP_SERVER", () => {
	it("points to the Microsoft timestamp server", () => {
		expect(TIMESTAMP_SERVER).toBe("http://timestamp.acs.microsoft.com");
	});
});

// ---------------------------------------------------------------------------
// checkEnvVars
// ---------------------------------------------------------------------------

describe("checkEnvVars", () => {
	it("returns ok when all env vars are present", () => {
		const env = { FOO: "a", BAR: "b" };
		expect(checkEnvVars(["FOO", "BAR"], env)).toEqual({ ok: true });
	});

	it("returns missing vars when some are absent", () => {
		const env = { FOO: "a" };
		expect(checkEnvVars(["FOO", "BAR"], env)).toEqual({ ok: false, missing: ["BAR"] });
	});

	it("returns all missing vars when env is empty", () => {
		expect(checkEnvVars(["FOO", "BAR", "BAZ"], {})).toEqual({
			ok: false,
			missing: ["FOO", "BAR", "BAZ"],
		});
	});

	it("treats empty string as missing", () => {
		expect(checkEnvVars(["FOO"], { FOO: "" })).toEqual({ ok: false, missing: ["FOO"] });
	});

	it("treats undefined as missing", () => {
		const env: Record<string, string | undefined> = { FOO: undefined };
		expect(checkEnvVars(["FOO"], env)).toEqual({ ok: false, missing: ["FOO"] });
	});
});

// ---------------------------------------------------------------------------
// detectSigningMode
// ---------------------------------------------------------------------------

describe("detectSigningMode", () => {
	const azureEnv: Record<string, string> = {
		AZURE_SIGN_ENDPOINT: "https://eus.codesigning.azure.net",
		AZURE_SIGN_CERT_PROFILE: "my-profile",
		AZURE_SIGN_CODE_SIGNING_ACCOUNT: "my-account",
	};

	const pfxEnv: Record<string, string> = {
		WIN_CSC_LINK: "base64encodedcert",
		WIN_CSC_KEY_PASSWORD: "secret",
	};

	it("returns azure mode when all Azure env vars are set", () => {
		expect(detectSigningMode(azureEnv)).toEqual({ mode: "azure" });
	});

	it("returns pfx mode when PFX env vars are set", () => {
		expect(detectSigningMode(pfxEnv)).toEqual({ mode: "pfx" });
	});

	it("prefers azure mode when both Azure and PFX vars are set", () => {
		expect(detectSigningMode({ ...azureEnv, ...pfxEnv })).toEqual({ mode: "azure" });
	});

	it("returns none mode when no signing env vars are set", () => {
		const result = detectSigningMode({});
		expect(result.mode).toBe("none");
		if (result.mode === "none") {
			expect(result.reason).toContain("No Windows signing env vars");
			expect(result.reason).toContain("AZURE_SIGN_ENDPOINT");
			expect(result.reason).toContain("WIN_CSC_LINK");
		}
	});

	it("returns none when Azure vars are partially set", () => {
		expect(detectSigningMode({ AZURE_SIGN_ENDPOINT: "https://x.com" }).mode).toBe("none");
	});

	it("returns none when only WIN_CSC_LINK is set without password", () => {
		expect(detectSigningMode({ WIN_CSC_LINK: "cert" }).mode).toBe("none");
	});
});

// ---------------------------------------------------------------------------
// decodePfxToTempFile
// ---------------------------------------------------------------------------

describe("decodePfxToTempFile", () => {
	it("writes base64-decoded content to a temporary .pfx file", () => {
		const content = "hello world";
		const base64 = Buffer.from(content).toString("base64");
		const pfxPath = decodePfxToTempFile(base64);

		try {
			expect(fs.existsSync(pfxPath)).toBe(true);
			expect(path.basename(pfxPath)).toBe("cert.pfx");
			expect(path.dirname(pfxPath)).toContain("win-sign-");
			expect(fs.readFileSync(pfxPath, "utf-8")).toBe(content);
		} finally {
			try { fs.unlinkSync(pfxPath); fs.rmdirSync(path.dirname(pfxPath)); } catch { /* ok */ }
		}
	});

	it("creates a unique temp directory each time", () => {
		const base64 = Buffer.from("test").toString("base64");
		const p1 = decodePfxToTempFile(base64);
		const p2 = decodePfxToTempFile(base64);

		try {
			expect(path.dirname(p1)).not.toBe(path.dirname(p2));
		} finally {
			try { fs.unlinkSync(p1); fs.rmdirSync(path.dirname(p1)); } catch { /* ok */ }
			try { fs.unlinkSync(p2); fs.rmdirSync(path.dirname(p2)); } catch { /* ok */ }
		}
	});
});
