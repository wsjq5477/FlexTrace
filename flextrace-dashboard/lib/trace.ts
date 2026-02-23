import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type TraceKind = "tool" | "skill" | "model" | "message" | "manual";
export type TraceStatus = "ok" | "error" | "unknown";

export type TraceRecord =
  | { type: "capture_start"; captureId: string; ts: number; attrs?: Record<string, unknown> }
  | { type: "capture_end"; captureId: string; ts: number; attrs?: Record<string, unknown> }
  | {
      type: "session";
      op: "upsert";
      ts: number;
      sessionId: string;
      rootSessionId: string;
      parentSessionId?: string;
      label?: string;
      attrs?: Record<string, unknown>;
    }
  | {
      type: "task_start";
      ts: number;
      taskId: string;
      sessionId: string;
      rootSessionId: string;
      parentTaskId?: string;
      kind: TraceKind;
      name: string;
      attrs?: Record<string, unknown>;
    }
  | {
      type: "task_end";
      ts: number;
      taskId: string;
      sessionId: string;
      rootSessionId: string;
      status: TraceStatus;
      durationMs?: number;
      attrs?: Record<string, unknown>;
    }
  | {
      type: "tracepoint";
      ts: number;
      tpId: string;
      sessionId: string;
      rootSessionId: string;
      parentTaskId?: string;
      name: string;
      level?: "info" | "warn" | "error";
      attrs?: Record<string, unknown>;
    }
  | {
      type: "counter";
      ts: number;
      name: string;
      value: number;
      sessionId: string;
      rootSessionId: string;
      attrs?: Record<string, unknown>;
    };

export interface TaskView {
  taskId: string;
  sessionId: string;
  rootSessionId: string;
  parentTaskId?: string;
  name: string;
  kind?: string;
  agent?: string;
  activity: string;
  status: "ok" | "error" | "unknown" | "running";
  startTs: number;
  endTs: number;
  durationMs: number;
  attrs?: Record<string, unknown>;
}

export interface SessionNode {
  sessionId: string;
  rootSessionId: string;
  parentSessionId?: string;
  title: string;
  children: string[];
}

export interface RootSessionView {
  rootSessionId: string;
  title: string;
  sessionIds: string[];
}

export interface TimelineData {
  latestTs: number;
  activeTasks: TaskView[];
  completedTasks: TaskView[];
  tracepoints: Array<Extract<TraceRecord, { type: "tracepoint" }>>;
  counters: Array<Extract<TraceRecord, { type: "counter" }>>;
  sessions: SessionNode[];
  roots: RootSessionView[];
  byAgentActivity: Array<{
    agent: string;
    activity: string;
    count: number;
    totalMs: number;
    avgMs: number;
    errors: number;
  }>;
}

export interface TraceLoadResult {
  records: TraceRecord[];
  malformedLines: number;
  sources: string[];
}

export interface TraceResolveResult {
  mode: "single" | "multi";
  tracePath?: string;
  rootDir?: string;
  projectFilter?: string;
  limit: number;
  sources: string[];
}

export async function resolveTracePath(inputPath?: string | null): Promise<string> {
  const preferred = (inputPath ?? "").trim();
  const candidates = [
    preferred,
    process.env.TRACE_FILE ?? "",
    path.resolve(process.cwd(), "trace.ndjson"),
    path.resolve(process.cwd(), "../trace.ndjson"),
  ].filter(Boolean);

  for (const filePath of candidates) {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    try {
      await access(resolved, constants.R_OK);
      return resolved;
    } catch {
      continue;
    }
  }

  throw new Error("No readable trace file found. Set TRACE_FILE or pass ?path=/abs/path/trace.ndjson");
}

export async function resolveTraceSource(input: {
  path?: string | null;
  root?: string | null;
  project?: string | null;
  limit?: number | null;
}): Promise<TraceResolveResult> {
  const preferredPath = (input.path ?? "").trim();
  const limit = Math.max(1, Number(input.limit ?? 50));
  if (preferredPath) {
    const tracePath = await resolveTracePath(preferredPath);
    return { mode: "single", tracePath, limit, sources: [tracePath] };
  }

  const configuredRoot = input.root?.trim() || process.env.FLEXTRACE_ROOT || `${homedir()}/.flextrace`;
  const rootDir = path.resolve(expandHome(configuredRoot));
  const projectFilter = (input.project ?? "all").trim() || "all";
  const sources = await discoverRootFiles(rootDir, projectFilter, limit);
  if (sources.length === 0) {
    throw new Error(`No trace root-session files found under ${rootDir}.`);
  }
  return { mode: "multi", rootDir, projectFilter, limit, sources };
}

export async function loadTrace(tracePath: string): Promise<TraceLoadResult> {
  return loadTraceFiles([tracePath]);
}

export async function loadTraceFiles(tracePaths: string[]): Promise<TraceLoadResult> {
  const records: TraceRecord[] = [];
  let malformedLines = 0;
  const sources: string[] = [];

  for (const tracePath of tracePaths) {
    const text = await readFile(tracePath, "utf8");
    const lines = text.split("\n");
    sources.push(tracePath);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (isTraceRecord(parsed)) records.push(parsed);
      } catch {
        malformedLines += 1;
      }
    }
  }

  return { records, malformedLines, sources };
}

export function buildTimeline(records: TraceRecord[], nowTs = Date.now()): TimelineData {
  const latestTs = records.reduce((max, r) => (typeof r.ts === "number" ? Math.max(max, r.ts) : max), 0);
  // Keep active task duration moving with wall clock time even when trace ingestion is idle.
  // `latestTs` is still returned for lag/stale calculation in API routes.
  const effectiveNowTs = nowTs;

  const starts = new Map<string, Extract<TraceRecord, { type: "task_start" }>>();
  const completedTasks: TaskView[] = [];
  const endedTaskIds = new Set<string>();

  const sessionMap = new Map<string, SessionNode>();
  const rootsMap = new Map<string, RootSessionView>();

  for (const record of records) {
    if (record.type === "task_start") starts.set(record.taskId, record);
    if (record.type === "session" && record.op === "upsert") {
      const title = asString(record.attrs?.sessionTitle) ?? asString(record.label) ?? shortenSessionId(record.sessionId);
      const node: SessionNode = {
        sessionId: record.sessionId,
        rootSessionId: record.rootSessionId,
        parentSessionId: record.parentSessionId,
        title,
        children: [],
      };
      sessionMap.set(record.sessionId, node);
      const root = rootsMap.get(record.rootSessionId) ?? {
        rootSessionId: record.rootSessionId,
        title: record.rootSessionId === record.sessionId ? title : shortenSessionId(record.rootSessionId),
        sessionIds: [],
      };
      if (!root.sessionIds.includes(record.sessionId)) root.sessionIds.push(record.sessionId);
      if (record.rootSessionId === record.sessionId && title) root.title = title;
      rootsMap.set(record.rootSessionId, root);
    }
  }

  for (const record of records) {
    if (!("sessionId" in record) || !("rootSessionId" in record)) continue;
    if (!rootsMap.has(record.rootSessionId)) {
      rootsMap.set(record.rootSessionId, {
        rootSessionId: record.rootSessionId,
        title: shortenSessionId(record.rootSessionId),
        sessionIds: [record.rootSessionId],
      });
    }
    const root = rootsMap.get(record.rootSessionId);
    if (root && !root.sessionIds.includes(record.sessionId)) root.sessionIds.push(record.sessionId);
    if (!sessionMap.has(record.sessionId)) {
      sessionMap.set(record.sessionId, {
        sessionId: record.sessionId,
        rootSessionId: record.rootSessionId,
        title: shortenSessionId(record.sessionId),
        children: [],
      });
    }
  }

  for (const node of sessionMap.values()) {
    if (!node.parentSessionId) continue;
    const parent = sessionMap.get(node.parentSessionId);
    if (!parent) continue;
    if (!parent.children.includes(node.sessionId)) parent.children.push(node.sessionId);
  }

  const resolveAgent = createAgentResolver(starts);

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
      parentTaskId: start?.parentTaskId ?? asString(record.attrs?.parentTaskId),
      name: start?.name ?? asString(record.attrs?.toolName) ?? "unknown",
      kind: start?.kind,
      agent: resolveAgent(start, record),
      activity: normalizeActivity(start?.attrs?.activity, start?.name, start?.kind),
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
    const endTs = Math.max(effectiveNowTs, start.ts);
    const durationMs = Math.max(0, endTs - start.ts);
    activeTasks.push({
      taskId: start.taskId,
      sessionId: start.sessionId,
      rootSessionId: start.rootSessionId,
      parentTaskId: start.parentTaskId,
      name: start.name,
      kind: start.kind,
      agent: resolveAgent(start),
      activity: normalizeActivity(start.attrs?.activity, start.name, start.kind),
      status: "running",
      startTs: start.ts,
      endTs,
      durationMs,
      attrs: mergeAttrs(start.attrs),
    });
  }

  const enrichedCompletedTasks = enrichMirroredToolTasks(completedTasks, completedTasks, activeTasks);
  const enrichedActiveTasks = enrichMirroredToolTasks(activeTasks, completedTasks, activeTasks);
  const dedupedCompletedTasks = dedupeTaskViews(enrichedCompletedTasks);
  const dedupedActiveTasks = dedupeTaskViews(enrichedActiveTasks);

  const byAgentActivityMap = new Map<string, { agent: string; activity: string; count: number; totalMs: number; errors: number }>();
  for (const task of dedupedCompletedTasks) {
    const agent = task.agent ?? "unknown-agent";
    const activity = task.activity || "unknown-activity";
    const key = `${agent}|${activity}`;
    const current = byAgentActivityMap.get(key) ?? { agent, activity, count: 0, totalMs: 0, errors: 0 };
    current.count += 1;
    current.totalMs += task.durationMs;
    if (task.status === "error") current.errors += 1;
    byAgentActivityMap.set(key, current);
  }
  const byAgentActivity = [...byAgentActivityMap.values()]
    .map((row) => ({ ...row, avgMs: row.count ? row.totalMs / row.count : 0 }))
    .sort((a, b) => b.totalMs - a.totalMs);

  const sessions = [...sessionMap.values()].sort((a, b) => a.title.localeCompare(b.title));
  const roots = [...rootsMap.values()].sort((a, b) => a.title.localeCompare(b.title));

  return {
    latestTs,
    activeTasks: dedupedActiveTasks.sort((a, b) => b.durationMs - a.durationMs),
    completedTasks: dedupedCompletedTasks.sort((a, b) => b.endTs - a.endTs),
    tracepoints: records.filter((r): r is Extract<TraceRecord, { type: "tracepoint" }> => r.type === "tracepoint"),
    counters: records.filter((r): r is Extract<TraceRecord, { type: "counter" }> => r.type === "counter"),
    sessions,
    roots,
    byAgentActivity,
  };
}

function dedupeTaskViews(tasks: TaskView[]): TaskView[] {
  // We intentionally keep activity-task rows and hide mirrored raw tool rows:
  // kind=tool taskId=call_xxx  <-> manual attrs.callID=call_xxx
  const activityCallIds = new Set<string>();
  for (const task of tasks) {
    const callID = asString(task.attrs?.callID);
    if (!callID) continue;
    if (task.kind === "manual" && task.name.startsWith("activity:")) {
      activityCallIds.add(callID);
    }
  }

  if (activityCallIds.size === 0) return tasks;
  return tasks.filter((task) => {
    if (task.kind !== "tool") return true;
    return !activityCallIds.has(task.taskId);
  });
}

function enrichMirroredToolTasks(tasks: TaskView[], completed: TaskView[], active: TaskView[]): TaskView[] {
  const toolByCallId = new Map<string, TaskView>();
  for (const task of [...completed, ...active]) {
    if (task.kind !== "tool") continue;
    if (!task.taskId.startsWith("call_")) continue;
    toolByCallId.set(task.taskId, task);
  }

  return tasks.map((task) => {
    const callIdFromAttr = asString(task.attrs?.callID);
    const callIdFromParent = task.parentTaskId?.startsWith("call_") ? task.parentTaskId : undefined;
    const callId = callIdFromAttr ?? callIdFromParent;
    if (!callId) return task;
    const toolTask = toolByCallId.get(callId);
    if (!toolTask) return task;

    const toolName = asString(toolTask.attrs?.toolName) ?? toolTask.name;
    const inputPreview = asString(toolTask.attrs?.inputPreview);
    const outputPreview = asString(toolTask.attrs?.outputPreview);
    const metadata = asObject(toolTask.attrs?.metadata);
    const childSessionId =
      asString(metadata?.sessionId) ??
      asString((task.attrs as Record<string, unknown> | undefined)?.childSessionId) ??
      findSessionIdInOutput(outputPreview);
    const doing = deriveToolIntent(toolName, inputPreview);

    return {
      ...task,
      attrs: mergeAttrs(task.attrs, {
        toolTaskId: toolTask.taskId,
        toolName,
        toolInputPreview: inputPreview,
        toolOutputPreview: outputPreview,
        toolChildSessionId: childSessionId,
        doing,
      }),
    };
  });
}

function deriveToolIntent(toolName: string, inputPreview?: string): string | undefined {
  const payload = parsePreviewObject(inputPreview);
  if (toolName === "bash") {
    const command = asString(payload?.command) ?? extractPreviewField(inputPreview, "command");
    return command ? truncateHead(command, 140) : undefined;
  }
  if (toolName === "task") {
    const subagent = asString(payload?.subagent_type) ?? extractPreviewField(inputPreview, "subagent_type");
    const description = asString(payload?.description) ?? extractPreviewField(inputPreview, "description");
    const combined = [subagent, description].filter(Boolean).join(" / ");
    return combined ? truncateHead(combined, 140) : undefined;
  }
  const filePath = asString(payload?.filePath) ?? extractPreviewField(inputPreview, "filePath");
  if (filePath) return truncateHead(filePath, 140);
  const pattern = asString(payload?.pattern) ?? extractPreviewField(inputPreview, "pattern");
  if (pattern) return truncateHead(pattern, 140);
  return inputPreview ? truncateHead(inputPreview, 140) : undefined;
}

function parsePreviewObject(inputPreview?: string): Record<string, unknown> | undefined {
  if (!inputPreview) return undefined;
  try {
    const parsed = JSON.parse(inputPreview) as unknown;
    return asObject(parsed);
  } catch {
    return undefined;
  }
}

function extractPreviewField(inputPreview: string | undefined, field: string): string | undefined {
  if (!inputPreview) return undefined;
  const re = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"])*)"`);
  const m = inputPreview.match(re);
  if (!m?.[1]) return undefined;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1];
  }
}

function findSessionIdInOutput(outputPreview?: string): string | undefined {
  if (!outputPreview) return undefined;
  const m = outputPreview.match(/task_id:\s*(ses_[A-Za-z0-9]+)/);
  return m?.[1];
}

function truncateHead(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}...`;
}

function mergeAttrs(...parts: Array<Record<string, unknown> | undefined>): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {};
  for (const part of parts) {
    if (!part) continue;
    for (const [key, value] of Object.entries(part)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function createAgentResolver(starts: Map<string, Extract<TraceRecord, { type: "task_start" }>>) {
  const cache = new Map<string, string | undefined>();
  const sessionDefault = new Map<string, string>();

  for (const start of starts.values()) {
    const fromAttrs = asString(start.attrs?.agent);
    if (fromAttrs) {
      if (!sessionDefault.has(start.sessionId)) sessionDefault.set(start.sessionId, fromAttrs);
      continue;
    }
    const fromName = parseAgentFromName(start.name);
    if (fromName && !sessionDefault.has(start.sessionId)) sessionDefault.set(start.sessionId, fromName);
  }

  const resolveStart = (start?: Extract<TraceRecord, { type: "task_start" }>): string | undefined => {
    if (!start) return undefined;
    const cached = cache.get(start.taskId);
    if (cached !== undefined) return cached;
    const fromAttrs = asString(start.attrs?.agent);
    if (fromAttrs) {
      cache.set(start.taskId, fromAttrs);
      return fromAttrs;
    }
    const fromName = parseAgentFromName(start.name);
    if (fromName) {
      cache.set(start.taskId, fromName);
      return fromName;
    }
    const fromParent = resolveStart(start.parentTaskId ? starts.get(start.parentTaskId) : undefined);
    if (fromParent) {
      cache.set(start.taskId, fromParent);
      return fromParent;
    }
    const fallback = sessionDefault.get(start.sessionId);
    cache.set(start.taskId, fallback);
    return fallback;
  };

  return (start?: Extract<TraceRecord, { type: "task_start" }>, end?: Extract<TraceRecord, { type: "task_end" }>) => {
    return asString(end?.attrs?.agent) ?? resolveStart(start) ?? undefined;
  };
}

function parseAgentFromName(name?: string): string | undefined {
  const text = asString(name);
  if (!text) return undefined;
  const lower = text.toLowerCase();
  if (lower.startsWith("agent_run:")) return text.slice("agent_run:".length).trim() || undefined;
  if (lower.startsWith("agent:")) return text.slice("agent:".length).trim() || undefined;
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function normalizeActivity(raw: unknown, name?: string, kind?: string): string {
  const explicit = asString(raw);
  if (explicit) return explicit;
  const sample = `${name ?? ""}|${kind ?? ""}`.toLowerCase();
  if (kind === "tool" || /(tool|mcp|grep|search|fetch)/.test(sample)) return "tool";
  if (/(code|edit|write|patch|compile|test|build|fix|编码)/.test(sample)) return "coding";
  if (/(reason|think|analysis|plan|reflect|推理|思考)/.test(sample)) return "reasoning";
  if (/(agent|session|skill)/.test(sample)) return "agent_run";
  return "unknown-activity";
}

function shortenSessionId(sessionId: string): string {
  if (sessionId.length <= 14) return sessionId;
  return `${sessionId.slice(0, 6)}...${sessionId.slice(-4)}`;
}

function isTraceRecord(value: unknown): value is TraceRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const t = v.type;
  if (typeof t !== "string") return false;
  if (t === "capture_start" || t === "capture_end") return true;

  if (typeof v.rootSessionId !== "string" || !v.rootSessionId) return false;
  if (typeof v.sessionId !== "string" || !v.sessionId) return false;

  if (t === "session") return v.op === "upsert";
  if (t === "task_start") return typeof v.taskId === "string" && typeof v.name === "string";
  if (t === "task_end") return typeof v.taskId === "string" && typeof v.status === "string";
  if (t === "tracepoint") return typeof v.tpId === "string" && typeof v.name === "string";
  if (t === "counter") return typeof v.name === "string" && typeof v.value === "number";
  return false;
}

async function discoverRootFiles(rootDir: string, projectFilter: string, limit: number): Promise<string[]> {
  const projects = await listProjectDirs(rootDir, projectFilter);
  const files: Array<{ file: string; mtimeMs: number }> = [];
  for (const projectPath of projects) {
    const entries = await readdir(projectPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".ndjson")) continue;
      if (entry.name.startsWith("_")) continue;
      const file = path.join(projectPath, entry.name);
      const s = await stat(file);
      files.push({ file, mtimeMs: s.mtimeMs });
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.slice(0, limit).map((item) => item.file);
}

async function listProjectDirs(rootDir: string, projectFilter: string): Promise<string[]> {
  try {
    await access(rootDir, constants.R_OK);
  } catch {
    return [];
  }
  if (projectFilter !== "all") {
    const candidate = path.join(rootDir, projectFilter);
    try {
      const s = await stat(candidate);
      return s.isDirectory() ? [candidate] : [];
    } catch {
      return [];
    }
  }
  const entries = await readdir(rootDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(rootDir, e.name));
}

function expandHome(input: string): string {
  if (!input) return input;
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return path.join(homedir(), input.slice(2));
  return input;
}
