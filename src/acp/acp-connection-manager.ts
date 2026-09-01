// biome-ignore-all lint: ACP implementation
import { type ChildProcess, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { PrimeAcpClientImpl } from "./acp-client";
export interface PrimeAcpConnectionInfo {
	connection: ClientSideConnection;
	client: PrimeAcpClientImpl;
	child: ChildProcess;
	initResponse: any;
}
export interface CreatePrimeAcpConnectionManagerOptions {
	onSessionUpdate?: (params: { sessionId: string; update: any }) => void;
}
export class PrimeAcpConnectionManager {
	private connectionInfo: PrimeAcpConnectionInfo | null = null;
	private connecting: Promise<PrimeAcpConnectionInfo> | null = null;
	private onSessionUpdate: (params: { sessionId: string; update: any }) => void;
	constructor(options: CreatePrimeAcpConnectionManagerOptions = {}) {
		this.onSessionUpdate = options.onSessionUpdate ?? (() => {});
	}
	setSessionUpdateHandler(handler: (params: { sessionId: string; update: any }) => void): void {
		(this as any).onSessionUpdate = handler;
	}
	async getConnection(): Promise<PrimeAcpConnectionInfo> {
		if (this.connectionInfo) {
			if (this.connectionInfo.child.exitCode === null && !this.connectionInfo.child.killed)
				return this.connectionInfo;
			this.connectionInfo = null;
		}
		if (this.connecting) return this.connecting;
		this.connecting = this.connect().finally(() => {
			this.connecting = null;
		});
		return this.connecting;
	}
	private async connect(): Promise<PrimeAcpConnectionInfo> {
		const child: ChildProcess = spawn("prime-agent", ["--mode", "acp"], {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env },
		});
		if (!child.stdin || !child.stdout) throw new Error("Failed to spawn prime-agent --mode acp: missing stdio");
		child.stderr?.on("data", (d: Buffer) => {
			const text = d.toString("utf8").trim();
			if (text) console.error(`[prime-acp] stderr: ${text}`);
		});
		child.on("error", (err) => {
			console.error(`[prime-acp] spawn error: ${String(err)}`);
		});
		child.on("exit", (code, signal) => {
			console.error(`[prime-acp] process exited code=${code} signal=${signal}`);
			if (this.connectionInfo?.child === child) this.connectionInfo = null;
		});
		let writableWeb: WritableStream<Uint8Array>;
		let readableWeb: ReadableStream<Uint8Array>;
		try {
			const toWebWritable = (Writable as any).toWeb;
			const toWebReadable = (Readable as any).toWeb;
			if (toWebWritable && toWebReadable) {
				writableWeb = toWebWritable(child.stdin as Writable);
				readableWeb = toWebReadable(child.stdout as Readable);
			} else {
				writableWeb = new WritableStream<Uint8Array>({
					write(chunk) {
						return new Promise<void>((resolve, reject) => {
							(child.stdin as Writable).write(chunk, (err) => (err ? reject(err) : resolve()));
						});
					},
				});
				readableWeb = new ReadableStream<Uint8Array>({
					start(controller) {
						const onData = (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk));
						const onEnd = () => controller.close();
						const onError = (err: Error) => controller.error(err);
						(child.stdout as Readable).on("data", onData);
						(child.stdout as Readable).once("end", onEnd);
						(child.stdout as Readable).once("error", onError);
					},
				});
			}
		} catch {
			writableWeb = new WritableStream<Uint8Array>({
				write(chunk) {
					return new Promise<void>((resolve, reject) => {
						(child.stdin as Writable).write(chunk, (err) => (err ? reject(err) : resolve()));
					});
				},
			});
			readableWeb = new ReadableStream<Uint8Array>({
				start(controller) {
					const onData = (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk));
					const onEnd = () => controller.close();
					const onError = (err: Error) => controller.error(err);
					(child.stdout as Readable).on("data", onData);
					(child.stdout as Readable).once("end", onEnd);
					(child.stdout as Readable).once("error", onError);
				},
			});
		}
		const stream = ndJsonStream(writableWeb, readableWeb);
		const client = new PrimeAcpClientImpl((params) => this.onSessionUpdate(params));
		const connection = new ClientSideConnection((agent: any) => {
			(client as any)._agent = agent;
			return client as any;
		}, stream as any);
		const initResponse = await (connection as any).initialize({
			protocolVersion: 1,
			clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
			clientInfo: { name: "kanban", title: "Kanban", version: "0.1.70" },
		});
		const info: PrimeAcpConnectionInfo = { connection, client, child, initResponse };
		this.connectionInfo = info;
		(connection as any).closed
			?.then(() => {
				if (this.connectionInfo === info) this.connectionInfo = null;
			})
			.catch(() => {
				if (this.connectionInfo === info) this.connectionInfo = null;
			});
		return info;
	}
	async dispose(): Promise<void> {
		const info = this.connectionInfo;
		this.connectionInfo = null;
		this.connecting = null;
		if (!info) return;
		try {
			info.child.kill("SIGTERM");
			await new Promise<void>((resolve) => {
				const timer = setTimeout(() => {
					try {
						info.child.kill("SIGKILL");
					} catch {}
					resolve();
				}, 3000);
				info.child.once("exit", () => {
					clearTimeout(timer);
					resolve();
				});
			});
		} catch {}
	}
}
export function createPrimeAcpConnectionManager(
	options: CreatePrimeAcpConnectionManagerOptions = {},
): PrimeAcpConnectionManager {
	return new PrimeAcpConnectionManager(options);
}
