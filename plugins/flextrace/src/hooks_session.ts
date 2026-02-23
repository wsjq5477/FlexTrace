import type { TraceWriter } from "./ndjson_writer.js";
import type { TaskContext } from "./task_context.js";

export interface SessionStartEvent {
  ts?: number;
  sessionId: string;
  rootSessionId: string;
  parentSessionId?: string;
  label?: string;
  attrs?: Record<string, unknown>;
}

export interface SessionEndEvent {
  ts?: number;
  sessionId: string;
  rootSessionId: string;
  attrs?: Record<string, unknown>;
}

export function makeSessionHooks(writer: TraceWriter, ctx: TaskContext) {
  function onSessionStart(ev: SessionStartEvent): void {
    writer.write({
      type: "session",
      op: "upsert",
      ts: ev.ts ?? Date.now(),
      sessionId: ev.sessionId,
      rootSessionId: ev.rootSessionId,
      parentSessionId: ev.parentSessionId,
      label: ev.label,
      attrs: ev.attrs,
    });
  }

  function onSessionEnd(ev: SessionEndEvent): void {
    writer.write({
      type: "marker",
      ts: ev.ts ?? Date.now(),
      sessionId: ev.sessionId,
      rootSessionId: ev.rootSessionId,
      label: "session.completed",
      attrs: ev.attrs,
    });
    ctx.clear(ev.sessionId);
  }

  return { onSessionStart, onSessionEnd };
}
