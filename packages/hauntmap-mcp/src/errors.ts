// The error vocabulary shared by the MCP server and the command line tool. One code list, so that a
// hook log and a Kiro transcript say the same thing (design.md, "Error Handling").

export type ToolErrorCode =
  | "invalid-arguments"
  | "invalid-preset"
  | "root-outside-workspace"
  | "root-not-found"
  | "cap-reached"
  | "module-not-found"
  | "analysis-failed";

export interface ToolError {
  error: { code: ToolErrorCode; message: string };
}

export type ToolResult<T> = { ok: true; value: T } | { ok: false; error: ToolError["error"] };

export function failure(code: ToolErrorCode, message: string): { ok: false; error: ToolError["error"] } {
  return { ok: false, error: { code, message } };
}

/** The message of a thrown value, without a stack and without a trailing full stop. */
export function messageOf(thrown: unknown): string {
  const text = thrown instanceof Error ? thrown.message : String(thrown);
  return text.replace(/\.+$/, "");
}

/** The text a tool error carries as an MCP result: `{"error":{"code":…,"message":…}}`. */
export function errorText(error: ToolError["error"]): string {
  return JSON.stringify({ error } satisfies ToolError);
}
