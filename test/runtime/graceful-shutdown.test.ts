import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	type GracefulShutdownProcess,
	getExitCodeForSignal,
	type HandledShutdownSignal,
	installGracefulShutdownHandlers,
	shouldSuppressImmediateDuplicateShutdownSignals,
} from "../../src/core/graceful-shutdown";

function createDeferredPromise() {
	let resolvePromise!: () => void;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve: resolvePromise,
	};
}

function createProcessDouble(): GracefulShutdownProcess & { emitSignal: (signal: HandledShutdownSignal) => void } {
	const emitter = new EventEmitter();
	const processDouble: GracefulShutdownProcess & { emitSignal: (signal: HandledShutdownSignal) => void } = {
		on(signal, listener) {
			emitter.on(signal, listener);
			return processDouble;
		},
		off(signal, listener) {
			emitter.off(signal, listener);
			return processDouble;
		},
		emitSignal(signal) {
			emitter.emit(signal);
		},
	};
	return processDouble;
}

describe("installGracefulShutdownHandlers", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("suppresses an immediate duplicate SIGINT while shutdown is already in progress", async () => {
		vi.useFakeTimers();

		const processDouble = createProcessDouble();
		const exit = vi.fn();
		const onSecondSignal = vi.fn();
		const deferred = createDeferredPromise();

		installGracefulShutdownHandlers({
			process: processDouble,
			delayMs: 10_000,
			exit,
			onSecondSignal,
			onShutdown: async () => {
				await deferred.promise;
			},
			suppressImmediateDuplicateSignals: true,
		});

		processDouble.emitSignal("SIGINT");
		vi.advanceTimersByTime(100);
		processDouble.emitSignal("SIGINT");

		expect(onSecondSignal).not.toHaveBeenCalled();
		expect(exit).not.toHaveBeenCalled();

		deferred.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(exit).toHaveBeenCalledTimes(1);
		expect(exit).toHaveBeenCalledWith(130);
	});

	it("calls reraiseSignal instead of exit when provided and shutdown was signal-triggered", async () => {
		vi.useFakeTimers();

		const processDouble = createProcessDouble();
		const exit = vi.fn();
		const reraiseSignal = vi.fn();
		const deferred = createDeferredPromise();

		installGracefulShutdownHandlers({
			process: processDouble,
			delayMs: 10_000,
			exit,
			reraiseSignal,
			onShutdown: async () => {
				await deferred.promise;
			},
		});

		processDouble.emitSignal("SIGINT");

		deferred.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(reraiseSignal).toHaveBeenCalledTimes(1);
		expect(reraiseSignal).toHaveBeenCalledWith("SIGINT");
		expect(exit).not.toHaveBeenCalled();
	});

	it("still force-exits on a later second Ctrl+C", () => {
		vi.useFakeTimers();

		const processDouble = createProcessDouble();
		const exit = vi.fn();
		const onSecondSignal = vi.fn();
		const deferred = createDeferredPromise();

		installGracefulShutdownHandlers({
			process: processDouble,
			delayMs: 10_000,
			exit,
			onSecondSignal,
			onShutdown: async () => {
				await deferred.promise;
			},
			suppressImmediateDuplicateSignals: true,
		});

		processDouble.emitSignal("SIGINT");
		vi.advanceTimersByTime(1_000);
		processDouble.emitSignal("SIGINT");

		expect(onSecondSignal).toHaveBeenCalledTimes(1);
		expect(onSecondSignal).toHaveBeenCalledWith("SIGINT");
		expect(exit).toHaveBeenCalledTimes(1);
		expect(exit).toHaveBeenCalledWith(130);

		deferred.resolve();
	});
});

describe("shouldSuppressImmediateDuplicateShutdownSignals", () => {
	it("enables duplicate suppression for npm-style wrapper launches", () => {
		expect(
			shouldSuppressImmediateDuplicateShutdownSignals({
				argv: ["/usr/local/bin/node", "/repo/node_modules/kanban/dist/cli.js"],
				env: {
					npm_execpath: "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
				},
			}),
		).toBe(true);
	});

	it("enables duplicate suppression for transient npx cache entrypoints", () => {
		expect(
			shouldSuppressImmediateDuplicateShutdownSignals({
				argv: ["/usr/local/bin/node", "/Users/example/.npm/_npx/593b71878a7c70f2/node_modules/kanban/dist/cli.js"],
				env: {},
			}),
		).toBe(true);
	});

	it("leaves normal direct launches unchanged", () => {
		expect(
			shouldSuppressImmediateDuplicateShutdownSignals({
				argv: ["/usr/local/bin/node", "/repo/dist/cli.js"],
				env: {},
			}),
		).toBe(false);
	});
});

describe("getExitCodeForSignal", () => {
	it("maps handled shutdown signals to shell-standard exit codes", () => {
		expect(getExitCodeForSignal("SIGHUP")).toBe(129);
		expect(getExitCodeForSignal("SIGINT")).toBe(130);
		expect(getExitCodeForSignal("SIGTERM")).toBe(143);
	});
});
