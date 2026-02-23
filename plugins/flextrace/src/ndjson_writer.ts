import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createWriteStream, type WriteStream } from "node:fs";
import type { TraceRecord } from "./trace_record.js";

export interface TraceWriter {
  write(record: TraceRecord): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export class NDJSONWriter implements TraceWriter {
  private stream?: WriteStream;
  private queue: Promise<void> = Promise.resolve();
  private opened = false;

  constructor(private readonly path: string) {}

  async open(): Promise<void> {
    if (this.opened) return;
    await mkdir(dirname(this.path), { recursive: true });
    this.stream = createWriteStream(this.path, { flags: "a" });
    this.opened = true;
  }

  write(record: TraceRecord): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (!this.opened) await this.open();
      const line = `${JSON.stringify(record)}\n`;
      await this.writeLine(line);
    });
    return this.queue;
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  async close(): Promise<void> {
    await this.queue;
    if (!this.stream) return;
    await new Promise<void>((resolve, reject) => {
      this.stream!.end((err?: Error | null) => {
        if (err) return reject(err);
        resolve();
      });
    });
    this.stream = undefined;
    this.opened = false;
  }

  private async writeLine(line: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (!this.stream) return reject(new Error("NDJSON stream not opened"));
      const ok = this.stream.write(line, "utf8", (err?: Error | null) => {
        if (err) return reject(err);
      });
      if (ok) {
        resolve();
      } else {
        this.stream.once("drain", resolve);
      }
    });
  }
}
