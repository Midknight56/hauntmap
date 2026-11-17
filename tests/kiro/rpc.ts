import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import process from "node:process";

// A minimal JSON-RPC client over the newline-delimited stdio transport of MCP, used to talk to the
// built server (dist/index.js) without the SDK client, so that every byte on stdout can be checked.

export interface RpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

export class RpcProcess {
  readonly child: ChildProcessWithoutNullStreams;
  /** Every line the process wrote to stdout. */
  readonly stdoutLines: string[] = [];
  stderr = "";
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<number, (response: RpcResponse) => void>();
  private readonly failures = new Map<number, (error: Error) => void>();
  exited: string | null = null;

  constructor(script: string, cwd: string) {
    this.child = spawn(process.execPath, [script], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).replace(/\r$/, "");
        this.buffer = this.buffer.slice(newline + 1);
        if (line !== "") this.receive(line);
        newline = this.buffer.indexOf("\n");
      }
    });
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
    this.child.on("exit", (code) => {
      this.exited = `process exited with code ${String(code)}; stderr: ${this.stderr}`;
      for (const fail of this.failures.values()) fail(new Error(this.exited));
      this.failures.clear();
    });
  }

  private receive(line: string): void {
    this.stdoutLines.push(line);
    try {
      const message = JSON.parse(line) as RpcResponse;
      const resolve = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
      if (resolve !== undefined) {
        this.pending.delete(message.id);
        resolve(message);
      }
    } catch {
      // a line that is not JSON stays in stdoutLines for the purity assertions
    }
  }

  request(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<RpcResponse> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      if (this.exited !== null) {
        reject(new Error(this.exited));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.failures.delete(id);
        reject(new Error(`no response to ${method} within ${timeoutMs} ms; stderr: ${this.stderr}`));
      }, timeoutMs);
      this.pending.set(id, (response) => {
        clearTimeout(timer);
        this.failures.delete(id);
        resolve(response);
      });
      this.failures.set(id, (error) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize(): Promise<RpcResponse> {
    const response = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "hauntmap-tests", version: "0.0.0" },
    });
    this.notify("notifications/initialized");
    return response;
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
    this.child.stdin.end();
    this.child.kill();
    await exited;
  }
}
