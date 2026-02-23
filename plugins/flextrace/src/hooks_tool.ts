import type { TraceWriter } from "./ndjson_writer.js";
import type { TaskContext } from "./task_context.js";
import type { TraceUsage } from "./trace_record.js";
import { asRecord, id, preview, safeError } from "./utils.js";

export interface ToolStartEvent {
  ts?: number;
  sessionId?: string;
  rootSessionId?: string;
  agentId?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  attrs?: Record<string, unknown>;
}

export interface ToolEndEvent {
  ts?: number;
  sessionId?: string;
  rootSessionId?: string;
  agentId?: string;
  toolName?: string;
  toolCallId?: string;
  output?: unknown;
  error?: unknown;
  usage?: TraceUsage;
  attrs?: Record<string, unknown>;
}

export function makeToolHooks(writer: TraceWriter, ctx: TaskContext) {
  function onToolStart(ev: ToolStartEvent): void {
    const ts = ev.ts ?? Date.now();
    const sessionId = ev.sessionId ?? ev.agentId ?? "unknown-session";
    const rootSessionId = ev.rootSessionId;
    if (!rootSessionId) {
      console.error("[flextrace] drop tool_start without rootSessionId", { tool: ev.toolName, sessionId });
      return;
    }
    const taskId = ev.toolCallId ?? id();
    const parentTaskId = ctx.current(sessionId)?.taskId;
    const isSkill = ev.toolName === "skill";
    const skillInput = asRecord(ev.input);

    const attrs: Record<string, unknown> = {
      toolName: ev.toolName ?? "unknown-tool",
      inputPreview: preview(ev.input),
      ...ev.attrs,
    };
    if (isSkill) {
      attrs.skill = {
        name: skillInput?.name,
        path: skillInput?.path,
        version: skillInput?.version,
      };
    }

    writer.write({
      type: "task_start",
      ts,
      taskId,
      sessionId,
      rootSessionId,
      parentTaskId,
      kind: isSkill ? "skill" : "tool",
      name: isSkill ? `skill:${String(skillInput?.name ?? "unknown")}` : String(ev.toolName ?? "unknown-tool"),
      attrs,
    });

    ctx.push(sessionId, {
      taskId,
      kind: isSkill ? "skill" : "tool",
      name: String(ev.toolName ?? "unknown-tool"),
      startedAt: ts,
    });
  }

  function onToolEnd(ev: ToolEndEvent): void {
    const ts = ev.ts ?? Date.now();
    const sessionId = ev.sessionId ?? ev.agentId ?? "unknown-session";
    const rootSessionId = ev.rootSessionId;
    if (!rootSessionId) {
      console.error("[flextrace] drop tool_end without rootSessionId", { tool: ev.toolName, sessionId });
      return;
    }
    const taskId = ev.toolCallId ?? ctx.current(sessionId)?.taskId ?? "unknown-task";
    const frame = ctx.pop(sessionId, taskId);

    writer.write({
      type: "task_end",
      ts,
      taskId,
      sessionId,
      rootSessionId,
      status: ev.error ? "error" : "ok",
      durationMs: frame ? ts - frame.startedAt : undefined,
      tokensIn: ev.usage?.promptTokens,
      tokensOut: ev.usage?.completionTokens,
      attrs: {
        toolName: ev.toolName ?? frame?.name ?? "unknown-tool",
        outputPreview: preview(ev.output),
        error: ev.error ? safeError(ev.error) : undefined,
        ...ev.attrs,
      },
    });
  }

  return { onToolStart, onToolEnd };
}
