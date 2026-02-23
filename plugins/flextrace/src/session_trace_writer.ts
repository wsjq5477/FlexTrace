import { readdir, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { NDJSONWriter, type TraceWriter } from "./ndjson_writer.js";
import type { TraceRecord } from "./trace_record.js";

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class SessionTraceWriter implements TraceWriter {
  private readonly writers = new Map<string, NDJSONWriter>();
  private metaWriter?: NDJSONWriter;
  private readonly maxProjectBytes: number;
  private maintenance: Promise<void> = Promise.resolve();
  private readonly projectDir: string;
  private readonly activePaths = new Set<string>();

  constructor(
    private readonly rootDir: string,
    private readonly projectId: string,
    options: { maxProjectBytes?: number } = {},
  ) {
    this.maxProjectBytes = Math.max(0, Number(options.maxProjectBytes ?? 1024 ** 3));
    this.projectDir = resolve(this.rootDir, safeName(this.projectId));
  }

  write(record: TraceRecord): Promise<void> {
    const appendMaintenance = () => {
      if (this.maxProjectBytes <= 0) return;
      this.maintenance = this.maintenance
        .then(() => this.enforceProjectSizeLimit())
        .catch((error) => {
          console.error("[flextrace] failed to enforce project size limit", { error });
        });
    };

    if ("type" in record && record.type !== "capture_start" && record.type !== "capture_end") {
      if (!("rootSessionId" in record) || typeof record.rootSessionId !== "string" || !record.rootSessionId) {
        console.error("[flextrace] drop record without rootSessionId", {
          type: record.type,
          sessionId: "sessionId" in record ? record.sessionId : undefined,
        });
        return Promise.resolve();
      }
      const writer = this.getRootWriter(record.rootSessionId);
      return writer.write(record).then(() => appendMaintenance());
    }
    return this.getMetaWriter().write(record).then(() => appendMaintenance());
  }

  async flush(): Promise<void> {
    const tasks: Array<Promise<void>> = [];
    for (const writer of this.writers.values()) tasks.push(writer.flush());
    if (this.metaWriter) tasks.push(this.metaWriter.flush());
    await Promise.all(tasks);
    await this.maintenance;
  }

  async close(): Promise<void> {
    const tasks: Array<Promise<void>> = [];
    for (const writer of this.writers.values()) tasks.push(writer.close());
    if (this.metaWriter) tasks.push(this.metaWriter.close());
    await Promise.all(tasks);
    await this.maintenance;
  }

  private getRootWriter(rootSessionId: string): NDJSONWriter {
    const key = safeName(rootSessionId);
    const existing = this.writers.get(key);
    if (existing) return existing;
    const path = resolve(this.rootDir, safeName(this.projectId), `${key}.ndjson`);
    const writer = new NDJSONWriter(path);
    this.writers.set(key, writer);
    this.activePaths.add(path);
    return writer;
  }

  private getMetaWriter(): NDJSONWriter {
    if (this.metaWriter) return this.metaWriter;
    const path = resolve(this.rootDir, safeName(this.projectId), "_capture.ndjson");
    this.metaWriter = new NDJSONWriter(path);
    this.activePaths.add(path);
    return this.metaWriter;
  }

  private async enforceProjectSizeLimit(): Promise<void> {
    const entries = await readdir(this.projectDir, { withFileTypes: true }).catch(() => []);
    const files: Array<{ path: string; size: number; mtimeMs: number; active: boolean }> = [];
    let total = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".ndjson")) continue;
      const path = resolve(this.projectDir, entry.name);
      const s = await stat(path).catch(() => undefined);
      if (!s) continue;
      const item = {
        path,
        size: s.size,
        mtimeMs: s.mtimeMs,
        active: this.activePaths.has(path),
      };
      files.push(item);
      total += item.size;
    }
    if (total <= this.maxProjectBytes) return;

    const deletable = files.filter((file) => !file.active).sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const file of deletable) {
      if (total <= this.maxProjectBytes) break;
      await unlink(file.path).catch(() => undefined);
      total -= file.size;
    }
  }
}
