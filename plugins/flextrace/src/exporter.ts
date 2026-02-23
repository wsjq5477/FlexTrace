import { writeFile } from "node:fs/promises";
import type { TraceRecord } from "./trace_record.js";
import { buildTimeline } from "./timeline.js";

export type TraceExportFormat = "json" | "csv" | "chrome-trace";

export async function exportTrace(path: string, records: TraceRecord[], format: TraceExportFormat): Promise<void> {
  if (format === "json") {
    await writeFile(path, JSON.stringify(records, null, 2), "utf8");
    return;
  }

  if (format === "chrome-trace") {
    const timeline = buildTimeline(records);
    const sessionToPid = new Map<string, number>();
    let pidSeq = 1;

    const traceEvents = timeline.completedTasks.map((task) => {
      if (!sessionToPid.has(task.sessionId)) {
        sessionToPid.set(task.sessionId, pidSeq++);
      }
      return {
        name: task.name,
        cat: task.activity ?? task.kind ?? "task",
        ph: "X",
        ts: task.startTs * 1000,
        dur: task.durationMs * 1000,
        pid: sessionToPid.get(task.sessionId),
        tid: 1,
        args: {
          sessionId: task.sessionId,
          rootSessionId: task.rootSessionId,
          taskId: task.taskId,
          agent: task.agent,
          activity: task.activity,
          status: task.status,
          parentTaskId: task.parentTaskId,
        },
      };
    });

    await writeFile(path, JSON.stringify({ traceEvents }, null, 2), "utf8");
    return;
  }

  const header = [
    "type",
    "ts",
    "sessionId",
    "rootSessionId",
    "taskId",
    "parentTaskId",
    "name",
    "kind",
    "status",
    "durationMs",
    "level",
    "value",
  ];

  const rows = records.map((r) => {
    const base = r as Record<string, unknown>;
    return [
      base.type,
      base.ts,
      base.sessionId,
      base.rootSessionId,
      base.taskId,
      base.parentTaskId,
      base.name ?? base.label,
      base.kind,
      base.status,
      base.durationMs,
      base.level,
      base.value,
    ]
      .map(toCsvCell)
      .join(",");
  });

  await writeFile(path, `${header.join(",")}\n${rows.join("\n")}\n`, "utf8");
}

function toCsvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const str = String(value);
  if (!str.includes(",") && !str.includes('"') && !str.includes("\n")) return str;
  return `"${str.replace(/"/g, '""')}"`;
}
