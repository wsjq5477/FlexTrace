import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { NDJSONWriter, type TraceWriter } from "./ndjson_writer.js";
import { SessionTraceWriter } from "./session_trace_writer.js";
import { TaskContext } from "./task_context.js";
import { makeSessionHooks, type SessionEndEvent, type SessionStartEvent } from "./hooks_session.js";
import { makeToolHooks, type ToolEndEvent, type ToolStartEvent } from "./hooks_tool.js";
import { makeTraceCounterTool } from "./tools_trace_counter.js";
import { makeTraceEventTool } from "./tools_trace_event.js";
import { makeTraceTaskTool } from "./tools_trace_task.js";
import { id } from "./utils.js";
import type { TraceToolDefinition } from "./plugin_types.js";

export interface FlexTraceConfig {
  enabled?: boolean;
  rootDir?: string;
  projectId?: string;
  outPath?: string;
  includeCounterTool?: boolean;
  includeTaskTool?: boolean;
  captureUserMessages?: boolean;
  userMessagePreviewMax?: number;
  maxProjectBytes?: number;
  attrs?: Record<string, unknown>;
}

export interface FlexTracePlugin {
  hooks: {
    onToolStart: (ev: ToolStartEvent) => void;
    onToolEnd: (ev: ToolEndEvent) => void;
    onSessionStart: (ev: SessionStartEvent) => void;
    onSessionEnd: (ev: SessionEndEvent) => void;
  };
  tools: TraceToolDefinition[];
  shutdown: () => Promise<void>;
  api: {
    emitSessionUpsert: (input: {
      sessionId: string;
      rootSessionId: string;
      parentSessionId?: string;
      label?: string;
      attrs?: Record<string, unknown>;
      ts?: number;
    }) => Promise<void>;
    emitEvent: (input: {
      sessionId: string;
      rootSessionId: string;
      name: string;
      level?: "info" | "warn" | "error";
      attrs?: Record<string, unknown>;
      links?: Array<Record<string, unknown>>;
      ts?: number;
    }) => Promise<string>;
  };
}

export function createFlexTracePlugin(config: FlexTraceConfig = {}): FlexTracePlugin {
  const enabled = config.enabled ?? true;
  const rootDir = resolve(config.rootDir ?? process.env.FLEXTRACE_ROOT ?? `${homedir()}/.flextrace`);
  const projectId = config.projectId ?? process.env.FLEXTRACE_PROJECT_ID ?? basename(process.cwd());
  const outPath = config.outPath ? resolve(config.outPath) : undefined;
  const maxProjectBytes = Math.max(0, Number(config.maxProjectBytes ?? process.env.FLEXTRACE_MAX_PROJECT_BYTES ?? 1024 ** 3));
  const writer: TraceWriter = outPath
    ? new NDJSONWriter(outPath)
    : new SessionTraceWriter(rootDir, projectId, { maxProjectBytes });
  const ctx = new TaskContext();
  const captureId = id();

  if (enabled) {
    writer.write({
      type: "capture_start",
      captureId,
      ts: Date.now(),
      attrs: {
        plugin: "flextrace",
        outPath: outPath ?? `${rootDir}/${projectId}/*.ndjson`,
        rootDir,
        projectId,
        captureUserMessages: config.captureUserMessages ?? true,
        userMessagePreviewMax: config.userMessagePreviewMax ?? 280,
        maxProjectBytes,
        ...config.attrs,
      },
    });
  }

  const toolHooks = makeToolHooks(writer, ctx);
  const sessionHooks = makeSessionHooks(writer, ctx);

  const tools: TraceToolDefinition[] = [makeTraceEventTool(writer, ctx)];
  if (config.includeCounterTool ?? true) tools.push(makeTraceCounterTool(writer));
  if (config.includeTaskTool ?? true) tools.push(makeTraceTaskTool(writer, ctx));

  return {
    hooks: {
      onToolStart: enabled ? toolHooks.onToolStart : () => undefined,
      onToolEnd: enabled ? toolHooks.onToolEnd : () => undefined,
      onSessionStart: enabled ? sessionHooks.onSessionStart : () => undefined,
      onSessionEnd: enabled ? sessionHooks.onSessionEnd : () => undefined,
    },
    tools,
    shutdown: async () => {
      if (!enabled) return;
      await writer.write({ type: "capture_end", captureId, ts: Date.now() });
      await writer.flush();
      await writer.close();
    },
    api: {
      emitSessionUpsert: async (input) => {
        await writer.write({
          type: "session",
          op: "upsert",
          ts: input.ts ?? Date.now(),
          sessionId: input.sessionId,
          rootSessionId: input.rootSessionId,
          parentSessionId: input.parentSessionId,
          label: input.label,
          attrs: input.attrs ?? {},
        });
      },
      emitEvent: async (input) => {
        const tpId = id();
        if (!input.rootSessionId) {
          console.error("[flextrace] drop api.emitEvent without rootSessionId", {
            sessionId: input.sessionId,
            name: input.name,
          });
          return tpId;
        }
        await writer.write({
          type: "tracepoint",
          ts: input.ts ?? Date.now(),
          tpId,
          sessionId: input.sessionId,
          rootSessionId: input.rootSessionId,
          parentTaskId: ctx.current(input.sessionId)?.taskId,
          name: input.name,
          level: input.level ?? "info",
          attrs: input.attrs ?? {},
          links: input.links ?? [],
        });
        return tpId;
      },
    },
  };
}
