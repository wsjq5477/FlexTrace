import { basename } from "node:path";
import { createFlexTracePlugin, type FlexTraceConfig } from "./flextrace_plugin.js";
import type { TraceToolRuntime } from "./plugin_types.js";
import { id } from "./utils.js";

interface OpenCodePluginContext {
  workingDirectory?: string;
}

interface OpenCodeExecContext {
  sessionID?: string;
  sessionId?: string;
}

interface OpenCodeToolDefinition {
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, execCtx: OpenCodeExecContext) => Promise<string>;
}

interface ToolBeforeInput {
  tool: string;
  sessionID: string;
  callID: string;
}

interface ToolBeforeOutput {
  args: Record<string, unknown>;
}

interface ToolAfterInput {
  tool: string;
  sessionID: string;
  callID: string;
  args: Record<string, unknown>;
}

interface ToolAfterOutput {
  title?: string;
  output?: string;
  metadata?: Record<string, unknown>;
}

interface EventEnvelope {
  event: {
    type: string;
    properties: Record<string, unknown>;
  };
}

interface SessionMeta {
  sessionId: string;
  parentSessionId?: string;
  rootSessionId: string;
  title?: string;
  slug?: string;
}

interface PartTaskState {
  state: "pending" | "running" | "ending";
  sessionId: string;
  attrs: Record<string, unknown>;
  taskId?: string;
  closeStatus?: "ok" | "error" | "unknown";
  closeTs?: number;
}

const CODING_TOOLS = new Set([
  "bash",
  "edit",
  "write",
  "multi_edit",
  "patch",
]);

export async function FlexTracePlugin(ctx: OpenCodePluginContext) {
  return createOpenCodeFlexTrace()(ctx);
}

export function createOpenCodeFlexTrace(config: FlexTraceConfig = {}) {
  return async (ctx: OpenCodePluginContext) => {
    const workingDirectory = ctx.workingDirectory ?? process.cwd();
    const projectId = process.env.FLEXTRACE_PROJECT_ID ?? basename(workingDirectory);
    const core = createFlexTracePlugin({
      projectId,
      ...config,
    });

    const eventTool = core.tools.find((t) => t.name === "trace_event");
    const taskTool = core.tools.find((t) => t.name === "trace_task");
    const captureUserMessages = config.captureUserMessages ?? true;
    const userMessagePreviewMax = Math.max(0, config.userMessagePreviewMax ?? 280);

    const agentBySession = new Map<string, string>();
    const sessionMetaBySession = new Map<string, SessionMeta>();
    const agentRunTaskBySession = new Map<string, string>();
    const partTaskByKey = new Map<string, PartTaskState>();

    function mergeCloseStatus(
      prev: "ok" | "error" | "unknown" | undefined,
      next: "ok" | "error" | "unknown",
    ): "ok" | "error" | "unknown" {
      const rank = (s: "ok" | "error" | "unknown"): number => (s === "error" ? 3 : s === "unknown" ? 2 : 1);
      if (!prev) return next;
      return rank(next) >= rank(prev) ? next : prev;
    }

    async function startPartTask(
      key: string,
      sessionId: string,
      name: string,
      attrs: Record<string, unknown>,
      startTs?: number,
    ): Promise<void> {
      const existing = partTaskByKey.get(key);
      if (existing && (existing.state === "pending" || existing.state === "running")) return;

      partTaskByKey.set(key, { state: "pending", sessionId, attrs });

      const taskId = await startTask(sessionId, name, attrs, startTs);
      const latest = partTaskByKey.get(key);
      if (!latest) return;
      if (!taskId) {
        partTaskByKey.delete(key);
        return;
      }

      if (latest.state === "ending") {
        await endTask(sessionId, taskId, latest.closeStatus ?? "unknown", attrs, latest.closeTs);
        partTaskByKey.delete(key);
        return;
      }

      partTaskByKey.set(key, {
        ...latest,
        state: "running",
        taskId,
      });
    }

    async function requestEndPartTask(
      key: string,
      status: "ok" | "error" | "unknown",
      endTs?: number,
    ): Promise<void> {
      const state = partTaskByKey.get(key);
      if (!state) return;

      if (state.state === "running" && state.taskId) {
        partTaskByKey.set(key, { ...state, state: "ending", closeStatus: status, closeTs: endTs });
        await endTask(state.sessionId, state.taskId, status, state.attrs, endTs);
        partTaskByKey.delete(key);
        return;
      }

      if (state.state === "pending" || state.state === "ending") {
        partTaskByKey.set(key, {
          ...state,
          state: "ending",
          closeStatus: mergeCloseStatus(state.closeStatus, status),
          closeTs: endTs ?? state.closeTs,
        });
      }
    }

    function getRootSessionId(sessionId: string): string | undefined {
      const visited = new Set<string>();
      let current: string | undefined = sessionId;
      while (current && !visited.has(current)) {
        visited.add(current);
        const meta = sessionMetaBySession.get(current);
        if (!meta) return undefined;
        if (!meta.parentSessionId) return meta.rootSessionId || meta.sessionId;
        current = meta.parentSessionId;
      }
      return undefined;
    }

    function recomputeAllRoots(): void {
      const resolving = new Set<string>();
      const resolveFor = (sessionId: string): string => {
        if (resolving.has(sessionId)) return sessionId;
        resolving.add(sessionId);
        const meta = sessionMetaBySession.get(sessionId);
        if (!meta) {
          resolving.delete(sessionId);
          return sessionId;
        }
        const root = meta.parentSessionId ? resolveFor(meta.parentSessionId) : sessionId;
        meta.rootSessionId = root;
        sessionMetaBySession.set(sessionId, meta);
        resolving.delete(sessionId);
        return root;
      };
      for (const sessionId of sessionMetaBySession.keys()) resolveFor(sessionId);
    }

    function upsertSessionMeta(input: {
      sessionId: string;
      parentSessionId?: string;
      title?: string;
      slug?: string;
    }): SessionMeta {
      const prev = sessionMetaBySession.get(input.sessionId);
      const parentSessionId = input.parentSessionId ?? prev?.parentSessionId;
      const rootSessionId = parentSessionId ? getRootSessionId(parentSessionId) ?? parentSessionId : input.sessionId;
      const merged: SessionMeta = {
        sessionId: input.sessionId,
        parentSessionId,
        rootSessionId,
        title: input.title ?? prev?.title,
        slug: input.slug ?? prev?.slug,
      };
      sessionMetaBySession.set(input.sessionId, merged);
      recomputeAllRoots();
      const refreshed = sessionMetaBySession.get(input.sessionId);
      if (refreshed) return refreshed;
      return merged;
    }

    async function ensureSessionMeta(input: {
      sessionId: string;
      parentSessionId?: string;
      title?: string;
      slug?: string;
    }): Promise<SessionMeta> {
      const meta = upsertSessionMeta(input);
      await core.api.emitSessionUpsert({
        sessionId: meta.sessionId,
        rootSessionId: meta.rootSessionId,
        parentSessionId: meta.parentSessionId,
        label: meta.title,
        attrs: {
          sessionTitle: meta.title,
          sessionSlug: meta.slug,
        },
      });
      return meta;
    }

    function runtimeForSession(sessionId: string, ts?: number): TraceToolRuntime | undefined {
      const rootSessionId = getRootSessionId(sessionId);
      if (!rootSessionId) {
        console.error("[flextrace] missing rootSessionId, drop record", { sessionId });
        return undefined;
      }
      return { sessionId, rootSessionId, ts: ts ?? Date.now() };
    }

    async function emitEvent(sessionId: string, name: string, attrs: Record<string, unknown>, ts?: number): Promise<void> {
      if (!eventTool) return;
      const runtime = runtimeForSession(sessionId, ts);
      if (!runtime) return;
      await eventTool.handler({ name, level: "info", attrs }, runtime);
    }

    async function startTask(
      sessionId: string,
      name: string,
      attrs: Record<string, unknown>,
      ts?: number,
    ): Promise<string | undefined> {
      if (!taskTool) return undefined;
      const runtime = runtimeForSession(sessionId, ts);
      if (!runtime) return undefined;
      const taskId = id();
      await taskTool.handler(
        {
          op: "start",
          taskId,
          name,
          kind: "manual",
          attrs,
        },
        runtime,
      );
      return taskId;
    }

    async function endTask(
      sessionId: string,
      taskId: string,
      status: "ok" | "error" | "unknown",
      attrs: Record<string, unknown>,
      ts?: number,
    ): Promise<void> {
      if (!taskTool) return;
      const runtime = runtimeForSession(sessionId, ts);
      if (!runtime) return;
      await taskTool.handler(
        {
          op: "end",
          taskId,
          status,
          attrs,
        },
        runtime,
      );
    }

    async function ensureAgentRun(sessionId: string, agent: string, ts?: number): Promise<void> {
      if (agentRunTaskBySession.has(sessionId)) return;
      const sessionTitle = sessionMetaBySession.get(sessionId)?.title;
      const taskId = await startTask(sessionId, `agent_run:${agent}`, { activity: "agent_run", agent, sessionTitle }, ts);
      if (taskId) agentRunTaskBySession.set(sessionId, taskId);
      agentBySession.set(sessionId, agent);
      await emitEvent(sessionId, "agent.run.start", { agent, sessionTitle }, ts);
    }

    async function finishAgentRun(sessionId: string, status: "ok" | "error" = "ok", ts?: number): Promise<void> {
      const taskId = agentRunTaskBySession.get(sessionId);
      const sessionTitle = sessionMetaBySession.get(sessionId)?.title;
      if (taskId) {
        await endTask(sessionId, taskId, status, { activity: "agent_run", agent: agentBySession.get(sessionId), sessionTitle }, ts);
        agentRunTaskBySession.delete(sessionId);
      }
      await emitEvent(sessionId, "agent.run.end", { agent: agentBySession.get(sessionId), status, sessionTitle }, ts);
      agentBySession.delete(sessionId);
    }

    async function closeDanglingSessionTasks(
      sessionId: string,
      status: "ok" | "error" | "unknown" = "unknown",
      ts?: number,
    ): Promise<void> {
      const pending = [...partTaskByKey.entries()].filter(([, state]) => state.sessionId === sessionId);
      for (const [key] of pending) {
        await requestEndPartTask(key, status, ts);
      }
    }

    return {
      name: "flextrace-opencode",
      event: async ({ event }: EventEnvelope) => {
        const type = event.type;
        const props = event.properties ?? {};

        if (type === "session.created") {
          const info = props.info as { id?: string; parentID?: string; title?: string; slug?: string } | undefined;
          const sessionId = String(info?.id ?? "unknown-session");
          const sessionTitle = typeof info?.title === "string" ? info.title.trim() : "";
          const meta = await ensureSessionMeta({
            sessionId,
            parentSessionId: info?.parentID,
            title: sessionTitle || undefined,
            slug: info?.slug,
          });
          await emitEvent(sessionId, "agent.session.created", {
            parentSessionId: info?.parentID,
            sessionTitle: sessionTitle || undefined,
            sessionSlug: info?.slug,
            rootSessionId: meta.rootSessionId,
          });
          if (sessionTitle) {
            await emitEvent(sessionId, "agent.session.meta", { sessionTitle, sessionSlug: info?.slug });
          }
          return;
        }

        if (type === "session.updated") {
          const info = props.info as { id?: string; title?: string; slug?: string } | undefined;
          const sessionId = String(info?.id ?? "unknown-session");
          const sessionTitle = typeof info?.title === "string" ? info.title.trim() : "";
          const meta = await ensureSessionMeta({
            sessionId,
            title: sessionTitle || undefined,
            slug: info?.slug,
          });
          await emitEvent(sessionId, "agent.session.updated", {
            sessionTitle: sessionTitle || undefined,
            sessionSlug: info?.slug,
            rootSessionId: meta.rootSessionId,
          });
          return;
        }

        if (type === "session.idle") {
          const sessionId = String((props as { sessionID?: string }).sessionID ?? "unknown-session");
          if (!sessionMetaBySession.has(sessionId)) await ensureSessionMeta({ sessionId });
          await closeDanglingSessionTasks(sessionId, "unknown");
          await finishAgentRun(sessionId, "ok");
          return;
        }

        if (type === "session.deleted") {
          const info = props.info as { id?: string } | undefined;
          const sessionId = String(info?.id ?? "unknown-session");
          if (!sessionMetaBySession.has(sessionId)) await ensureSessionMeta({ sessionId });
          await closeDanglingSessionTasks(sessionId, "unknown");
          await finishAgentRun(sessionId, "ok");
          return;
        }

        if (type === "session.error") {
          const sessionId = String((props as { sessionID?: string }).sessionID ?? "unknown-session");
          if (!sessionMetaBySession.has(sessionId)) await ensureSessionMeta({ sessionId });
          await closeDanglingSessionTasks(sessionId, "error");
          await finishAgentRun(sessionId, "error");
          return;
        }

        if (type === "message.updated") {
          const info = props.info as
            | {
                id?: string;
                sessionID?: string;
                role?: string;
                agent?: string;
                time?: { created?: number };
                text?: unknown;
                content?: unknown;
                prompt?: unknown;
                input?: unknown;
                parts?: unknown;
              }
            | undefined;
          if (!info) return;
          const sessionId = String(info.sessionID ?? "unknown-session");
          if (!sessionMetaBySession.has(sessionId)) await ensureSessionMeta({ sessionId });
          if (info.role === "assistant") {
            const agent = String(info.agent ?? "unknown-agent");
            await ensureAgentRun(sessionId, agent, info.time?.created);
            return;
          }
          if (info.role === "user") {
            const sessionTitle = sessionMetaBySession.get(sessionId)?.title;
            if (captureUserMessages) {
              await emitEvent(
                sessionId,
                "user.message",
                {
                  role: "user",
                  messageId: info.id,
                  preview: extractUserMessagePreview(info, userMessagePreviewMax),
                  sessionTitle,
                },
                info.time?.created,
              );
            }
          }
          return;
        }

        if (type === "message.part.updated") {
          const part = (props as { part?: Record<string, unknown> }).part;
          if (!part) return;

          const partType = String(part.type ?? "unknown");
          const sessionId = String(part.sessionID ?? "unknown-session");
          const partId = String(part.id ?? id());
          if (!sessionMetaBySession.has(sessionId)) await ensureSessionMeta({ sessionId });
          const agent = agentBySession.get(sessionId) ?? "unknown-agent";
          const sessionTitle = sessionMetaBySession.get(sessionId)?.title;

          if (partType === "reasoning") {
            const time = part.time as { start?: number; end?: number } | undefined;
            const key = `reasoning:${partId}`;
            const attrs = { activity: "reasoning", agent, sessionTitle };
            if (!partTaskByKey.has(key)) {
              await startPartTask(key, sessionId, "activity:reasoning", attrs, time?.start);
            }
            if (time?.end) {
              await requestEndPartTask(key, "ok", time.end);
            }
            return;
          }

          if (partType === "tool") {
            const toolPart = part as {
              tool?: string;
              callID?: string;
              state?: { status?: string; time?: { start?: number; end?: number } };
            };
            const toolName = String(toolPart.tool ?? "unknown-tool");
            const status = String(toolPart.state?.status ?? "unknown");
            const key = `tool:${toolPart.callID ?? partId}`;
            const isCoding = CODING_TOOLS.has(toolName);
            const activity = isCoding ? "coding" : "tool";
            const stateTime = toolPart.state?.time;

            if (status === "running") {
              const attrs = { activity, tool: toolName, agent, callID: toolPart.callID, sessionTitle };
              await startPartTask(key, sessionId, `activity:${activity}:${toolName}`, attrs, stateTime?.start);
              return;
            }

            if (status === "completed" || status === "error") {
              if (!partTaskByKey.has(key) && stateTime?.start) {
                const attrs = { activity, tool: toolName, agent, callID: toolPart.callID, sessionTitle };
                await startPartTask(key, sessionId, `activity:${activity}:${toolName}`, attrs, stateTime.start);
              }
              await requestEndPartTask(key, status === "error" ? "error" : "ok", stateTime?.end);
              return;
            }
          }
        }
      },

      "tool.execute.before": async (input: ToolBeforeInput, output: ToolBeforeOutput) => {
        if (!sessionMetaBySession.has(input.sessionID)) await ensureSessionMeta({ sessionId: input.sessionID });
        core.hooks.onToolStart({
          ts: Date.now(),
          sessionId: input.sessionID,
          rootSessionId: getRootSessionId(input.sessionID),
          toolName: input.tool,
          toolCallId: input.callID,
          input: output.args,
        });
      },

      "tool.execute.after": async (input: ToolAfterInput, output: ToolAfterOutput) => {
        if (!sessionMetaBySession.has(input.sessionID)) await ensureSessionMeta({ sessionId: input.sessionID });
        core.hooks.onToolEnd({
          ts: Date.now(),
          sessionId: input.sessionID,
          rootSessionId: getRootSessionId(input.sessionID),
          toolName: input.tool,
          toolCallId: input.callID,
          output: output.output,
          attrs: {
            title: output.title,
            metadata: output.metadata,
          },
        });
      },

      tool: {
        trace_event: defineTool({
          description: "Emit a tracepoint for current session",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string" },
              level: { type: "string", enum: ["info", "warn", "error"] },
              attrs: { type: "object", additionalProperties: true },
              links: { type: "array", items: { type: "object", additionalProperties: true } },
            },
            required: ["name"],
          },
          execute: async (args: Record<string, unknown>, execCtx: OpenCodeExecContext) => {
            const sessionId = String(execCtx.sessionID ?? execCtx.sessionId ?? "unknown-session");
            if (!sessionMetaBySession.has(sessionId)) await ensureSessionMeta({ sessionId });
            const runtime = runtimeForSession(sessionId);
            if (!runtime) return "trace_event dropped: missing rootSessionId";
            const emit = core.tools.find((t) => t.name === "trace_event");
            if (!emit) return "trace_event tool missing";
            const result = await emit.handler(args, runtime);
            return asText(result);
          },
        }),

        trace_counter: defineTool({
          description: "Emit a counter metric for current session",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string" },
              value: { type: "number" },
              attrs: { type: "object", additionalProperties: true },
            },
            required: ["name", "value"],
          },
          execute: async (args: Record<string, unknown>, execCtx: OpenCodeExecContext) => {
            const sessionId = String(execCtx.sessionID ?? execCtx.sessionId ?? "unknown-session");
            if (!sessionMetaBySession.has(sessionId)) await ensureSessionMeta({ sessionId });
            const runtime = runtimeForSession(sessionId);
            if (!runtime) return "trace_counter dropped: missing rootSessionId";
            const counter = core.tools.find((t) => t.name === "trace_counter");
            if (!counter) return "trace_counter tool missing";
            const result = await counter.handler(args, runtime);
            return asText(result);
          },
        }),

        trace_task: defineTool({
          description: "Create a manual task for phase tracking",
          parameters: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["start", "end"] },
              taskId: { type: "string" },
              name: { type: "string" },
              kind: { type: "string", enum: ["manual", "message", "model", "tool", "skill"] },
              status: { type: "string", enum: ["ok", "error", "unknown"] },
              attrs: { type: "object", additionalProperties: true },
            },
            required: ["op"],
          },
          execute: async (args: Record<string, unknown>, execCtx: OpenCodeExecContext) => {
            const sessionId = String(execCtx.sessionID ?? execCtx.sessionId ?? "unknown-session");
            if (!sessionMetaBySession.has(sessionId)) await ensureSessionMeta({ sessionId });
            const runtime = runtimeForSession(sessionId);
            if (!runtime) return "trace_task dropped: missing rootSessionId";
            const task = core.tools.find((t) => t.name === "trace_task");
            if (!task) return "trace_task tool missing";
            const result = await task.handler(args, runtime);
            return asText(result);
          },
        }),
      },
      shutdown: async () => {
        for (const [key] of [...partTaskByKey.entries()]) {
          await requestEndPartTask(key, "unknown");
        }
        await core.shutdown();
      },
    };
  };
}

function defineTool(toolDef: OpenCodeToolDefinition): OpenCodeToolDefinition {
  return toolDef;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractUserMessagePreview(
  info: {
  text?: unknown;
  content?: unknown;
  prompt?: unknown;
  input?: unknown;
  parts?: unknown;
},
  max: number,
): string | undefined {
  if (max <= 0) return undefined;
  const direct = firstText(info.text, info.content, info.prompt, info.input);
  if (direct) return truncatePreview(direct, max);
  if (Array.isArray(info.parts)) {
    for (const part of info.parts) {
      if (typeof part === "string" && part.trim()) return truncatePreview(part.trim(), max);
      if (!part || typeof part !== "object") continue;
      const obj = part as Record<string, unknown>;
      const nested = firstText(obj.text, obj.content, obj.input, obj.prompt, obj.value);
      if (nested) return truncatePreview(nested, max);
    }
  }
  return undefined;
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      const text = value.trim().replace(/\s+/g, " ");
      if (text) return text;
      continue;
    }
    if (Array.isArray(value)) {
      const combined = value
        .map((item) => (typeof item === "string" ? item : undefined))
        .filter((v): v is string => Boolean(v))
        .join(" ")
        .trim()
        .replace(/\s+/g, " ");
      if (combined) return combined;
    }
  }
  return undefined;
}

function truncatePreview(text: string, max = 280): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}
