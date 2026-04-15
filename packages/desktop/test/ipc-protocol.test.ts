import { describe, expect, it } from "vitest";
import type {
	ChildToParentMessage,
	ParentToChildMessage,
} from "../src/ipc-protocol.js";

describe("IPC Protocol Types", () => {
	describe("ParentToChildMessage", () => {
		it("accepts a start message", () => {
			const msg: ParentToChildMessage = {
				type: "start",
				config: {
					host: "127.0.0.1",
					port: "auto",
					authToken: "abc123",
				},
			};
			expect(msg.type).toBe("start");
		});

		it("accepts a shutdown message", () => {
			const msg: ParentToChildMessage = { type: "shutdown" };
			expect(msg.type).toBe("shutdown");
		});

		it("accepts a heartbeat-ack message", () => {
			const msg: ParentToChildMessage = { type: "heartbeat-ack" };
			expect(msg.type).toBe("heartbeat-ack");
		});

		it("discriminates on type field", () => {
			const msg: ParentToChildMessage = {
				type: "start",
				config: { host: "localhost", port: 3484, authToken: "token" },
			};

			if (msg.type === "start") {
				// TypeScript narrows to StartMessage — config is accessible
				expect(msg.config.host).toBe("localhost");
			} else {
				expect.unreachable("Expected start message");
			}
		});
	});

	describe("ChildToParentMessage", () => {
		it("accepts a ready message", () => {
			const msg: ChildToParentMessage = {
				type: "ready",
				url: "http://localhost:52341",
			};
			expect(msg.type).toBe("ready");
		});

		it("accepts an error message", () => {
			const msg: ChildToParentMessage = {
				type: "error",
				message: "Failed to start runtime",
			};
			expect(msg.type).toBe("error");
		});

		it("accepts a shutdown-complete message", () => {
			const msg: ChildToParentMessage = { type: "shutdown-complete" };
			expect(msg.type).toBe("shutdown-complete");
		});

		it("accepts a heartbeat message", () => {
			const msg: ChildToParentMessage = { type: "heartbeat" };
			expect(msg.type).toBe("heartbeat");
		});

		it("discriminates on type field", () => {
			const msg: ChildToParentMessage = {
				type: "ready",
				url: "http://localhost:9999",
			};

			if (msg.type === "ready") {
				// TypeScript narrows to ReadyMessage — url is accessible
				expect(msg.url).toBe("http://localhost:9999");
			} else {
				expect.unreachable("Expected ready message");
			}
		});
	});
});
