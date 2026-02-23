import type { TraceWriter } from "./ndjson_writer.js";
import type { TaskContext } from "./task_context.js";
import type { TraceToolDefinition } from "./plugin_types.js";
import { id } from "./utils.js";

export function makeTraceTaskTool(writer: TraceWriter, ctx: TaskContext): TraceToolDefinition {
  return {
    name: "trace_task",
    description: "Start or end a manual task to capture custom business phases.",
    inputSchema: {
      type: "object",
      properties: {
        op: { type: "string", enum: ["start", "end"] },
        taskId: { type: "string" },
        name: { type: "string" },
        kind: { type: "string", enum: ["manual", "message", "model", "tool", "skill"], default: "manual" },
        status: { type: "string", enum: ["ok", "error", "unknown"], default: "ok" },
        attrs: { type: "object" },
      },
      required: ["op"],
    },
    async handler(args, runtime) {
      const ts = runtime.ts ?? Date.now();
      const sessionId = String(runtime.sessionId ?? runtime.agentId ?? "unknown-session");
      const rootSessionId = runtime.rootSessionId;
      if (!rootSessionId) {
        console.error("[flextrace] drop trace_task without rootSessionId", { sessionId, op: args.op });
        return { ok: false, dropped: true, reason: "missing_rootSessionId" };
      }
      const op = String(args.op);

      if (op === "start") {
        const taskId = String(args.taskId ?? id());
        const parentTaskId = ctx.current(sessionId)?.taskId;
        const kind = (args.kind as "manual" | "message" | "model" | "tool" | "skill") ?? "manual";
        const name = String(args.name ?? "manual-task");
        writer.write({
          type: "task_start",
          ts,
          taskId,
          sessionId,
          rootSessionId,
          parentTaskId,
          kind,
          name,
          attrs: (args.attrs as Record<string, unknown> | undefined) ?? {},
        });
        ctx.push(sessionId, { taskId, kind, name, startedAt: ts });
        return { ok: true, taskId };
      }

      const explicitTaskId = args.taskId ? String(args.taskId) : undefined;
      const currentTaskId = ctx.current(sessionId)?.taskId;
      const taskId = explicitTaskId ?? currentTaskId ?? id();
      const frame = currentTaskId ? ctx.pop(sessionId, taskId) : undefined;

      writer.write({
        type: "task_end",
        ts,
        taskId,
        sessionId,
        rootSessionId,
        status: (args.status as "ok" | "error" | "unknown") ?? "ok",
        durationMs: frame ? ts - frame.startedAt : undefined,
        attrs: (args.attrs as Record<string, unknown> | undefined) ?? {},
      });
      return { ok: true, taskId };
    },
  };
}
