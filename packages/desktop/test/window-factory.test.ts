import { describe, expect, it } from "vitest";

import { pickRecoveryUrl } from "../src/window-factory.js";

describe("pickRecoveryUrl", () => {
	const runtimeUrl = "http://127.0.0.1:55555/";

	it("returns runtimeUrl when lastUrl is empty", () => {
		expect(pickRecoveryUrl("", runtimeUrl)).toBe(runtimeUrl);
	});

	it("returns runtimeUrl when lastUrl is unparseable", () => {
		expect(pickRecoveryUrl("not a url", runtimeUrl)).toBe(runtimeUrl);
	});

	it("falls back to runtimeUrl for file:// URLs (e.g. disconnected screen)", () => {
		expect(
			pickRecoveryUrl(
				"file:///Applications/Kanban.app/Contents/Resources/disconnected.html",
				runtimeUrl,
			),
		).toBe(runtimeUrl);
	});

	it("falls back to runtimeUrl when origins differ (runtime restarted on new port)", () => {
		expect(
			pickRecoveryUrl("http://127.0.0.1:44444/some-project", runtimeUrl),
		).toBe(runtimeUrl);
	});

	it("falls back when scheme differs (https vs http)", () => {
		expect(
			pickRecoveryUrl("https://127.0.0.1:55555/some-project", runtimeUrl),
		).toBe(runtimeUrl);
	});

	it("preserves lastUrl when it shares the runtime origin", () => {
		const lastUrl = "http://127.0.0.1:55555/my-project/board";
		expect(pickRecoveryUrl(lastUrl, runtimeUrl)).toBe(lastUrl);
	});

	it("preserves lastUrl with query and hash on the same origin", () => {
		const lastUrl = "http://127.0.0.1:55555/my-project?tab=tasks#row-12";
		expect(pickRecoveryUrl(lastUrl, runtimeUrl)).toBe(lastUrl);
	});

	it("falls back when runtimeUrl itself is unparseable", () => {
		expect(
			pickRecoveryUrl("http://127.0.0.1:55555/some-project", "garbage"),
		).toBe("garbage");
	});
});
