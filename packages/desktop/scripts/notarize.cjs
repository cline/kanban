// ───────────────────────────────────────────────────────────────────────
// notarize.js — electron-builder afterSign hook for macOS notarization
//
// electron-builder invokes this script after code-signing the .app bundle.
// It calls Apple's notarytool (via @electron/notarize) to submit the app
// for notarization and staple the resulting ticket.
//
// Required environment variables:
//   APPLE_ID              — Apple Developer account email
//   APPLE_ID_PASSWORD     — App-specific password (NOT your Apple ID password)
//   APPLE_TEAM_ID         — 10-character Apple Developer Team ID
//
// The script is a no-op when:
//   - The target platform is not macOS
//   - Any required env var is missing (allows unsigned local dev builds)
// ───────────────────────────────────────────────────────────────────────
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
 * @param {string} platformName — electron-builder platform name (e.g. "mac", "win", "linux")
 * @param {Record<string, string | undefined>} env
 * @returns {{ shouldNotarize: true } | { shouldNotarize: false; reason: string }}
 */
function shouldNotarize(platformName, env) {
	if (platformName !== "mac") {
		return {
			shouldNotarize: false,
			reason: `Skipping notarization: platform is "${platformName}", not "mac".`,
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
