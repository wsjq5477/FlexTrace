import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { TraceRecord } from "./trace_record.js";
import { buildTimeline } from "./timeline.js";

export interface TraceSummary {
  totalRecords: number;
  totalSessions: number;
  totalTasks: number;
  errorTasks: number;
  totalTracepoints: number;
  totalCounters: number;
  avgTaskDurationMs: number;
  p95TaskDurationMs: number;
  topSlowTasks: Array<{ name: string; count: number; avgDurationMs: number; errorRate: number }>;
  byAgentActivity: Array<{
    agent: string;
    activity: string;
    count: number;
    totalMs: number;
    avgMs: number;
    errors: number;
  }>;
}

export async function loadTrace(path: string): Promise<TraceRecord[]> {
  const records: TraceRecord[] = [];
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    const text = line.trim();
    if (!text) continue;
    const parsed = JSON.parse(text) as TraceRecord;
    records.push(parsed);
  }
  return records;
}

export function analyzeTrace(records: TraceRecord[]): TraceSummary {
  const timeline = buildTimeline(records);
  const sessions = new Set<string>();
  const tasks = timeline.completedTasks;

  for (const record of records) {
    if ("sessionId" in record && record.sessionId) sessions.add(record.sessionId);
  }

  const durations: number[] = [];
  const stats = new Map<string, { count: number; totalDuration: number; errors: number }>();
  let errorTasks = 0;

  for (const end of tasks) {
    if (end.status === "error") errorTasks += 1;
    if (typeof end.durationMs === "number") durations.push(end.durationMs);
    const name = end.name ?? "unknown";
    const current = stats.get(name) ?? { count: 0, totalDuration: 0, errors: 0 };
    current.count += 1;
    current.totalDuration += end.durationMs ?? 0;
    if (end.status === "error") current.errors += 1;
    stats.set(name, current);
  }

  durations.sort((a, b) => a - b);
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const p95 = durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] : 0;

  const topSlowTasks = [...stats.entries()]
    .map(([name, s]) => ({
      name,
      count: s.count,
      avgDurationMs: s.count ? s.totalDuration / s.count : 0,
      errorRate: s.count ? s.errors / s.count : 0,
    }))
    .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
    .slice(0, 10);

  return {
    totalRecords: records.length,
    totalSessions: sessions.size,
    totalTasks: tasks.length,
    errorTasks,
    totalTracepoints: records.filter((r) => r.type === "tracepoint").length,
    totalCounters: records.filter((r) => r.type === "counter").length,
    avgTaskDurationMs: avg,
    p95TaskDurationMs: p95,
    topSlowTasks,
    byAgentActivity: timeline.byAgentActivity,
  };
}

export async function saveSummary(path: string, summary: TraceSummary): Promise<void> {
  await writeFile(path, JSON.stringify(summary, null, 2), "utf8");
}
