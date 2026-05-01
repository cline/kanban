// electron-builder afterSign hook for macOS notarization.
// Requires: APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID env vars.
// @ts-check
"use strict";

/** @type {string[]} */
const REQUIRED_ENV_VARS = ["APPLE_ID", "APPLE_ID_PASSWORD", "APPLE_TEAM_ID"];

/**
 * Check whether all required environment variables are present.
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true } | { ok: false; missing: string[] }}
 */
function checkEnvironment(env) {
	const missing = REQUIRED_ENV_VARS.filter((key) => !env[key]);
	if (missing.length > 0) {
		return { ok: false, missing };
	}
	return { ok: true };
}

/**
 * Determine whether notarization should run based on platform and environment.
 *
 * NOTE ON PLATFORM NAMING: electron-builder's afterSign hook receives
 * `context.electronPlatformName`, which is the **Electron** platform string
 * (`"darwin"`, `"win32"`, `"linux"`) — *not* the electron-builder config name
 * (`"mac"`, `"win"`, `"linux"`). On macOS builds this value is always
 * `"darwin"`. We compare against `"darwin"` here; comparing against `"mac"`
 * would silently skip notarization on every real macOS build.
 *
 * @param {string} platformName — electronPlatformName from afterSign context (e.g. "darwin", "win32", "linux")
 * @param {Record<string, string | undefined>} env
 * @returns {{ shouldNotarize: true } | { shouldNotarize: false; reason: string }}
 */
function shouldNotarize(platformName, env) {
	if (platformName !== "darwin") {
		return {
			shouldNotarize: false,
			reason: `Skipping notarization: platform is "${platformName}", not "darwin".`,
		};
	}

	const check = checkEnvironment(env);
	if (!check.ok) {
		return {
			shouldNotarize: false,
			reason: `Skipping notarization: missing env vars: ${check.missing.join(", ")}.`,
		};
	}

	return { shouldNotarize: true };
}

/**
 * afterSign hook called by electron-builder.
 * @param {import("electron-builder").AfterPackContext} context
 */
async function afterSign(context) {
	const { electronPlatformName, appOutDir } = context;
	const productName =
		context.packager.appInfo.productFilename || context.packager.appInfo.name;

	const result = shouldNotarize(electronPlatformName, process.env);
	if (!result.shouldNotarize) {
		console.log(result.reason);
		return;
	}

	const appPath = `${appOutDir}/${productName}.app`;

	console.log(`Notarizing ${appPath} …`);

	const { notarize } = require("@electron/notarize");

	await notarize({
		appPath,
		appleId: /** @type {string} */ (process.env.APPLE_ID),
		appleIdPassword: /** @type {string} */ (process.env.APPLE_ID_PASSWORD),
		teamId: /** @type {string} */ (process.env.APPLE_TEAM_ID),
	});

	console.log("Notarization complete.");
}

// Export for electron-builder (default export)
module.exports = afterSign;

// Export helpers for testing
module.exports.checkEnvironment = checkEnvironment;
module.exports.shouldNotarize = shouldNotarize;
module.exports.REQUIRED_ENV_VARS = REQUIRED_ENV_VARS;
