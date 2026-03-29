import { describe, expect, it, vi } from "vitest";

import {
	createTerminalProtocolFilterState,
	disableOscColorQueryIntercept,
	filterTerminalProtocolOutput,
} from "../../../src/terminal/terminal-protocol-filter";

describe("terminal protocol filter", () => {
	it("suppresses primary and secondary device attribute queries when enabled", () => {
		const state = createTerminalProtocolFilterState({
			suppressDeviceAttributeQueries: true,
		});

		const filtered = filterTerminalProtocolOutput(
			state,
			Buffer.from("before\u001b[c middle \u001b[>0c after", "utf8"),
		);

		expect(filtered.toString("utf8")).toBe("before middle  after");
	});

	it("preserves device attribute queries when suppression is disabled", () => {
		const state = createTerminalProtocolFilterState();

		const filtered = filterTerminalProtocolOutput(state, Buffer.from("\u001b[c", "utf8"));

		expect(filtered.toString("utf8")).toBe("\u001b[c");
	});

	it("handles split device attribute queries across chunks", () => {
		const state = createTerminalProtocolFilterState({
			suppressDeviceAttributeQueries: true,
		});

		const firstChunk = filterTerminalProtocolOutput(state, Buffer.from("before\u001b[", "utf8"));
		const secondChunk = filterTerminalProtocolOutput(state, Buffer.from("cafter", "utf8"));

		expect(firstChunk.toString("utf8")).toBe("before");
		expect(secondChunk.toString("utf8")).toBe("after");
		expect(state.pendingChunk).toBeNull();
	});

	it("handles OSC 11 queries split between ESC and the OSC introducer", () => {
		const onOsc11BackgroundQuery = vi.fn();
		const state = createTerminalProtocolFilterState({
			interceptOscColorQueries: true,
		});

		const firstChunk = filterTerminalProtocolOutput(state, Buffer.from("before\u001b", "utf8"), {
			onOsc11BackgroundQuery,
		});
		const secondChunk = filterTerminalProtocolOutput(state, Buffer.from("]11;?\u0007after", "utf8"), {
			onOsc11BackgroundQuery,
		});

		expect(firstChunk.toString("utf8")).toBe("before");
		expect(secondChunk.toString("utf8")).toBe("after");
		expect(onOsc11BackgroundQuery).toHaveBeenCalledTimes(1);
		expect(state.pendingChunk).toBeNull();
	});

	it("intercepts OSC 10 foreground color queries", () => {
		const onOsc10ForegroundQuery = vi.fn();
		const state = createTerminalProtocolFilterState({
			interceptOscColorQueries: true,
		});

		const filtered = filterTerminalProtocolOutput(state, Buffer.from("before\u001b]10;?\u0007after", "utf8"), {
			onOsc10ForegroundQuery,
		});

		expect(filtered.toString("utf8")).toBe("beforeafter");
		expect(onOsc10ForegroundQuery).toHaveBeenCalledTimes(1);
	});

	it("handles device attribute queries split between ESC and the CSI introducer", () => {
		const state = createTerminalProtocolFilterState({
			suppressDeviceAttributeQueries: true,
		});

		const firstChunk = filterTerminalProtocolOutput(state, Buffer.from("before\u001b", "utf8"));
		const secondChunk = filterTerminalProtocolOutput(state, Buffer.from("[cafter", "utf8"));

		expect(firstChunk.toString("utf8")).toBe("before");
		expect(secondChunk.toString("utf8")).toBe("after");
		expect(state.pendingChunk).toBeNull();
	});

	it("disables color query interception without affecting device attribute suppression", () => {
		const onOsc10ForegroundQuery = vi.fn();
		const onOsc11BackgroundQuery = vi.fn();
		const state = createTerminalProtocolFilterState({
			interceptOscColorQueries: true,
			suppressDeviceAttributeQueries: true,
		});

		disableOscColorQueryIntercept(state);

		const filtered = filterTerminalProtocolOutput(
			state,
			Buffer.from("\u001b]10;?\u0007\u001b]11;?\u0007\u001b[c", "utf8"),
			{ onOsc10ForegroundQuery, onOsc11BackgroundQuery },
		);

		expect(filtered.toString("utf8")).toBe("\u001b]10;?\u0007\u001b]11;?\u0007");
		expect(onOsc10ForegroundQuery).not.toHaveBeenCalled();
		expect(onOsc11BackgroundQuery).not.toHaveBeenCalled();
		expect(state.suppressDeviceAttributeQueries).toBe(true);
	});

	it("preserves pending CSI state when disabling color query interception", () => {
		const state = createTerminalProtocolFilterState({
			interceptOscColorQueries: true,
			suppressDeviceAttributeQueries: true,
		});

		const firstChunk = filterTerminalProtocolOutput(state, Buffer.from("before\u001b[", "utf8"));

		disableOscColorQueryIntercept(state);

		const secondChunk = filterTerminalProtocolOutput(state, Buffer.from("cafter", "utf8"));

		expect(firstChunk.toString("utf8")).toBe("before");
		expect(secondChunk.toString("utf8")).toBe("after");
		expect(state.pendingChunk).toBeNull();
	});
});
