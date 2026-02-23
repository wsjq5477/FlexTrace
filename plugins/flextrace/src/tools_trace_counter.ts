import type { TraceWriter } from "./ndjson_writer.js";
import type { TraceToolDefinition } from "./plugin_types.js";

export function makeTraceCounterTool(writer: TraceWriter): TraceToolDefinition {
  return {
    name: "trace_counter",
    description: "Emit a numeric counter metric for current session.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        value: { type: "number" },
        attrs: { type: "object" },
      },
      required: ["name", "value"],
    },
    async handler(args, runtime) {
      const sessionId = runtime.sessionId ?? runtime.agentId ?? "unknown-session";
      const rootSessionId = runtime.rootSessionId;
      if (!rootSessionId) {
        console.error("[flextrace] drop trace_counter without rootSessionId", { sessionId, name: args.name });
        return { ok: false, dropped: true, reason: "missing_rootSessionId" };
      }
      writer.write({
        type: "counter",
        ts: runtime.ts ?? Date.now(),
        sessionId,
        rootSessionId,
        name: String(args.name),
        value: Number(args.value),
        attrs: (args.attrs as Record<string, unknown> | undefined) ?? {},
      });
      return { ok: true };
    },
  };
}
