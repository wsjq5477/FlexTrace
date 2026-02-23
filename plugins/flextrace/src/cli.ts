#!/usr/bin/env node
import { analyzeTrace, loadTrace } from "./analyzer.js";
import { exportTrace } from "./exporter.js";
import { serveTraceViewer } from "./viewer_server.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (cmd === "analyze") {
    const input = args[1];
    if (!input) throw new Error("missing input trace file path");
    const summaryPath = readFlag(args, "--summary");
    const records = await loadTrace(input);
    const summary = analyzeTrace(records);
    if (summaryPath) {
      const fs = await import("node:fs/promises");
      await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
    }
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  if (cmd === "export") {
    const input = args[1];
    const out = readFlag(args, "--out");
    const format = parseExportFormat(readFlag(args, "--format") ?? "json");
    if (!input || !out) {
      throw new Error("usage: tracectl export <trace.ndjson> --out <file> [--format json|csv|chrome-trace]");
    }
    const records = await loadTrace(input);
    await exportTrace(out, records, format);
    process.stdout.write(`exported ${records.length} records to ${out} (${format})\n`);
    return;
  }

  if (cmd === "serve") {
    const input = args[1];
    const port = Number(readFlag(args, "--port") ?? "7399");
    if (!input) throw new Error("usage: tracectl serve <trace.ndjson> [--port 7399]");
    await serveTraceViewer(input, port);
    return;
  }

  throw new Error(`unknown command: ${cmd}`);
}

function readFlag(args: string[], key: string): string | undefined {
  const idx = args.indexOf(key);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function parseExportFormat(format: string): "json" | "csv" | "chrome-trace" {
  const normalized = format.trim().toLowerCase();
  if (normalized === "json" || normalized === "csv" || normalized === "chrome-trace") {
    return normalized;
  }
  throw new Error(`invalid --format '${format}', expected one of: json, csv, chrome-trace`);
}

function printHelp(): void {
  process.stdout.write(
    [
      "tracectl - FlexTrace helper",
      "",
      "Commands:",
      "  tracectl analyze <trace.ndjson> [--summary summary.json]",
      "  tracectl export <trace.ndjson> --out <file> [--format json|csv|chrome-trace]",
      "  tracectl serve <trace.ndjson> [--port 7399]",
      "",
    ].join("\n"),
  );
}

main().catch((err) => {
  process.stderr.write(`tracectl failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
