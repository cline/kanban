import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
export interface PrimeAcpManagedTerminal {
  id: string;
  process: ReturnType<typeof spawn>;
  output: string;
  truncated: boolean;
  outputByteLimit: number;
  exitCode: number | null;
  signal: string | null;
  exited: boolean;
}
export type SessionUpdateHandler = (params: { sessionId: string; update: any }) => void;
export class PrimeAcpClientImpl {
  private terminals = new Map<string, PrimeAcpManagedTerminal>();
  private nextTerminalId = 1;
  constructor(private readonly onSessionUpdate: SessionUpdateHandler) {}
  async sessionUpdate(params: { sessionId: string; update: any }): Promise<void> { this.onSessionUpdate(params); }
  async requestPermission(params: { sessionId: string; toolCall?: any; tool_call?: any; options: Array<{ optionId: string; name: string; kind: string }> }): Promise<{ outcome: { outcome: string; optionId?: string } }> {
    const options = params.options ?? [];
    const preferred = options.find((o) => o.kind === "allow_once" || o.kind === "allow_always" || o.kind === "allow");
    if (preferred) return { outcome: { outcome: "selected", optionId: preferred.optionId } };
    if (options.length > 0) return { outcome: { outcome: "selected", optionId: options[0]!.optionId } };
    return { outcome: { outcome: "cancelled" } };
  }
  async readTextFile(params: { sessionId: string; path: string; line?: number; limit?: number }): Promise<{ content: string }> {
    try {
      const raw = await readFile(params.path, "utf8");
      if (params.line !== undefined || params.limit !== undefined) {
        const lines = raw.split("\n");
        const start = params.line ? Math.max(0, params.line - 1) : 0;
        const end = params.limit ? start + params.limit : undefined;
        return { content: lines.slice(start, end).join("\n") };
      }
      return { content: raw };
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); throw new Error(`readTextFile failed for ${params.path}: ${msg}`); }
  }
  async writeTextFile(params: { sessionId: string; path: string; content: string }): Promise<Record<string, never>> {
    await mkdir(dirname(params.path), { recursive: true });
    await writeFile(params.path, params.content, "utf8");
    return {};
  }
  async createTerminal(params: { sessionId: string; command: string; args?: string[]; cwd?: string; env?: Array<{ name: string; value: string }>; outputByteLimit?: number }): Promise<{ terminalId: string }> {
    const terminalId = `prime-acp-terminal-${this.nextTerminalId++}`;
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (params.env) for (const kv of params.env) env[kv.name] = kv.value;
    const outputByteLimit = params.outputByteLimit ?? 64 * 1024;
    const proc = spawn(params.command, params.args ?? [], { cwd: params.cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const terminal: PrimeAcpManagedTerminal = { id: terminalId, process: proc, output: "", truncated: false, outputByteLimit, exitCode: null, signal: null, exited: false };
    const append = (data: Buffer) => { const text = data.toString("utf8"); terminal.output += text; if (terminal.output.length > outputByteLimit) { terminal.truncated = true; terminal.output = terminal.output.slice(-outputByteLimit); } };
    proc.stdout?.on("data", append); proc.stderr?.on("data", append);
    proc.on("close", (code, signal) => { terminal.exitCode = code; terminal.signal = signal; terminal.exited = true; });
    proc.on("error", () => { terminal.exited = true; });
    this.terminals.set(terminalId, terminal);
    return { terminalId };
  }
  async terminalOutput(params: { sessionId: string; terminalId: string }): Promise<{ output: string; truncated: boolean; exitStatus?: { exitCode?: number | null; signal?: string | null } }> {
    const t = this.terminals.get(params.terminalId);
    if (!t) throw new Error(`Terminal not found: ${params.terminalId}`);
    return { output: t.output, truncated: t.truncated, ...(t.exited ? { exitStatus: { exitCode: t.exitCode, signal: t.signal } } : {}) };
  }
  async waitForTerminalExit(params: { sessionId: string; terminalId: string }): Promise<{ exitCode?: number | null; signal?: string | null }> {
    const t = this.terminals.get(params.terminalId);
    if (!t) throw new Error(`Terminal not found: ${params.terminalId}`);
    if (t.exited) return { exitCode: t.exitCode, signal: t.signal };
    await new Promise<void>((resolve) => { t.process.once("close", () => resolve()); t.process.once("error", () => resolve()); });
    return { exitCode: t.exitCode, signal: t.signal };
  }
  async killTerminal(params: { sessionId: string; terminalId: string }): Promise<Record<string, never>> {
    const t = this.terminals.get(params.terminalId);
    if (!t) return {};
    if (!t.exited) { try { t.process.kill("SIGTERM"); } catch {} }
    return {};
  }
  async releaseTerminal(params: { sessionId: string; terminalId: string }): Promise<Record<string, never>> {
    const t = this.terminals.get(params.terminalId);
    if (!t) return {};
    if (!t.exited) { try { t.process.kill("SIGTERM"); setTimeout(() => { try { if (!t.exited) t.process.kill("SIGKILL"); } catch {} }, 2000); } catch {} }
    this.terminals.delete(params.terminalId);
    return {};
  }
}
