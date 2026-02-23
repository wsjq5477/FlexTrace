import type { TraceWriter } from "./ndjson_writer.js";
import type { TaskContext } from "./task_context.js";
import type { TraceToolDefinition } from "./plugin_types.js";
import { id } from "./utils.js";

export function makeTraceEventTool(writer: TraceWriter, ctx: TaskContext): TraceToolDefinition {
  return {
    name: "trace_event",
    description: "Emit a tracepoint event attached to the current active task.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        level: { type: "string", enum: ["info", "warn", "error"], default: "info" },
        attrs: { type: "object" },
        links: { type: "array" },
      },
      required: ["name"],
    },
    async handler(args, runtime) {
      const sessionId = String(runtime.sessionId ?? runtime.agentId ?? "unknown-session");
      const rootSessionId = runtime.rootSessionId;
      if (!rootSessionId) {
        console.error("[flextrace] drop trace_event without rootSessionId", { sessionId, name: args.name });
        return { ok: false, dropped: true, reason: "missing_rootSessionId" };
      }
      const tpId = id();
      writer.write({
        type: "tracepoint",
        ts: runtime.ts ?? Date.now(),
        tpId,
        sessionId,
        rootSessionId,
        parentTaskId: ctx.current(sessionId)?.taskId,
        name: String(args.name),
        level: (args.level as "info" | "warn" | "error") ?? "info",
        attrs: (args.attrs as Record<string, unknown> | undefined) ?? {},
        links: (args.links as Array<Record<string, unknown>> | undefined) ?? [],
      });
      return { ok: true, tpId };
    },
  };
}
