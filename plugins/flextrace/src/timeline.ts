import type { TraceRecord } from "./trace_record.js";

export interface TaskView {
  taskId: string;
  sessionId: string;
  rootSessionId: string;
  parentTaskId?: string;
  name: string;
  kind?: string;
  agent?: string;
  activity?: string;
  status: "ok" | "error" | "unknown" | "running";
  startTs: number;
  endTs: number;
  durationMs: number;
  attrs?: Record<string, unknown>;
}

export interface TimelineData {
  latestTs: number;
  activeTasks: TaskView[];
  completedTasks: TaskView[];
  tracepoints: Array<Extract<TraceRecord, { type: "tracepoint" }>>;
  counters: Array<Extract<TraceRecord, { type: "counter" }>>;
  byAgentActivity: Array<{
    agent: string;
    activity: string;
    count: number;
    totalMs: number;
    avgMs: number;
    errors: number;
  }>;
}

export function buildTimeline(records: TraceRecord[], nowTs = Date.now()): TimelineData {
  const latestTs = records.reduce((max, r) => {
    if ("ts" in r && typeof r.ts === "number") return Math.max(max, r.ts);
    return max;
  }, 0);
  const effectiveNowTs = latestTs > 0 ? latestTs : nowTs;

  const starts = new Map<string, Extract<TraceRecord, { type: "task_start" }>>();
  const completedTasks: TaskView[] = [];
  const endedTaskIds = new Set<string>();

  for (const record of records) {
    if (record.type === "task_start") {
      starts.set(record.taskId, record);
    }
  }

  for (const record of records) {
    if (record.type !== "task_end") continue;
    endedTaskIds.add(record.taskId);
    const start = starts.get(record.taskId);
    const startTs = start?.ts ?? (typeof record.durationMs === "number" ? record.ts - record.durationMs : record.ts);
    const durationMs = typeof record.durationMs === "number" ? record.durationMs : Math.max(0, record.ts - startTs);
    completedTasks.push({
      taskId: record.taskId,
      sessionId: record.sessionId,
      rootSessionId: record.rootSessionId,
      parentTaskId: start?.parentTaskId ?? record.attrs?.parentTaskId?.toString(),
      name: start?.name ?? String(record.attrs?.toolName ?? "unknown"),
      kind: start?.kind,
      agent: asString(start?.attrs?.agent ?? record.attrs?.agent),
      activity: asString(start?.attrs?.activity ?? record.attrs?.activity),
      status: record.status,
      startTs,
      endTs: record.ts,
      durationMs,
      attrs: mergeAttrs(start?.attrs, record.attrs),
    });
  }

  const activeTasks: TaskView[] = [];
  for (const [taskId, start] of starts) {
    if (endedTaskIds.has(taskId)) continue;
    const durationMs = Math.max(0, effectiveNowTs - start.ts);
    activeTasks.push({
      taskId: start.taskId,
      sessionId: start.sessionId,
      rootSessionId: start.rootSessionId,
      parentTaskId: start.parentTaskId,
      name: start.name,
      kind: start.kind,
      agent: asString(start.attrs?.agent),
      activity: asString(start.attrs?.activity),
      status: "running",
      startTs: start.ts,
      endTs: effectiveNowTs,
      durationMs,
      attrs: mergeAttrs(start.attrs),
    });
  }

  const dedupedCompletedTasks = dedupeTaskViews(completedTasks);
  const dedupedActiveTasks = dedupeTaskViews(activeTasks);

  const byAgentActivityMap = new Map<string, { agent: string; activity: string; count: number; totalMs: number; errors: number }>();
  for (const task of dedupedCompletedTasks) {
    const agent = task.agent ?? "unknown-agent";
    const activity = task.activity ?? "unknown-activity";
    const key = `${agent}|${activity}`;
    const current = byAgentActivityMap.get(key) ?? { agent, activity, count: 0, totalMs: 0, errors: 0 };
    current.count += 1;
    current.totalMs += task.durationMs;
    if (task.status === "error") current.errors += 1;
    byAgentActivityMap.set(key, current);
  }

  const byAgentActivity = [...byAgentActivityMap.values()]
    .map((row) => ({
      ...row,
      avgMs: row.count ? row.totalMs / row.count : 0,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

  return {
    latestTs: effectiveNowTs,
    activeTasks: dedupedActiveTasks.sort((a, b) => b.durationMs - a.durationMs),
    completedTasks: dedupedCompletedTasks.sort((a, b) => b.endTs - a.endTs),
    tracepoints: records.filter((r): r is Extract<TraceRecord, { type: "tracepoint" }> => r.type === "tracepoint"),
    counters: records.filter((r): r is Extract<TraceRecord, { type: "counter" }> => r.type === "counter"),
    byAgentActivity,
  };
}

function mergeAttrs(...parts: Array<Record<string, unknown> | undefined>): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {};
  for (const part of parts) {
    if (!part) continue;
    for (const [key, value] of Object.entries(part)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

function dedupeTaskViews(tasks: TaskView[]): TaskView[] {
  // Keep semantic activity tracks; hide mirrored raw tool tasks:
  // kind=tool, taskId=call_xxx  <->  manual activity:* with parentTaskId/callID = call_xxx
  const mirroredToolTaskIds = new Set<string>();
  for (const task of tasks) {
    if (task.kind !== "manual") continue;
    if (!task.name.startsWith("activity:")) continue;
    const viaAttr = asString(task.attrs?.callID);
    const viaParent = task.parentTaskId?.startsWith("call_") ? task.parentTaskId : undefined;
    const callId = viaAttr ?? viaParent;
    if (callId) mirroredToolTaskIds.add(callId);
  }
  if (mirroredToolTaskIds.size === 0) return tasks;
  return tasks.filter((task) => task.kind !== "tool" || !mirroredToolTaskIds.has(task.taskId));
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}
