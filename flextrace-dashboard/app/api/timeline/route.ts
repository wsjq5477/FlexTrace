import { NextRequest, NextResponse } from "next/server";
import { buildTimeline, loadTraceFiles, resolveTraceSource } from "@/lib/trace";
import { stat } from "node:fs/promises";

export const dynamic = "force-dynamic";

const DEFAULT_STALE_MS = 15_000;
const SOURCE_ACTIVE_WINDOW_MS = 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const excludeParams = request.nextUrl.searchParams.getAll("exclude");
    const excludeSet = new Set(
      excludeParams
        .flatMap((v) => v.split(","))
        .map((v) => v.trim())
        .filter(Boolean),
    );
    const resolved = await resolveTraceSource({
      path: request.nextUrl.searchParams.get("path"),
      root: request.nextUrl.searchParams.get("root"),
      project: request.nextUrl.searchParams.get("project"),
      limit: Number(request.nextUrl.searchParams.get("limit") ?? "50"),
    });
    const discoveredSources = resolved.sources;
    const activeSources = discoveredSources.filter((source) => !excludeSet.has(source));
    const { records, malformedLines, sources } = await loadTraceFiles(activeSources);
    const timeline = buildTimeline(records);
    const generatedAt = Date.now();
    const lagMs = Math.max(0, generatedAt - timeline.latestTs);
    const staleThresholdMs = Number(process.env.TRACE_STALE_MS ?? DEFAULT_STALE_MS);
    const isStale = lagMs >= staleThresholdMs;

    const latestCapture = [...records]
      .reverse()
      .find((r) => r.type === "capture_start") as
      | { type: "capture_start"; attrs?: Record<string, unknown> }
      | undefined;
    const captureAttrs = latestCapture?.attrs ?? {};
    const settings = {
      rootDir: typeof captureAttrs.rootDir === "string" ? captureAttrs.rootDir : resolved.rootDir,
      maxProjectBytes: typeof captureAttrs.maxProjectBytes === "number" ? captureAttrs.maxProjectBytes : undefined,
      captureUserMessages:
        typeof captureAttrs.captureUserMessages === "boolean" ? captureAttrs.captureUserMessages : undefined,
      userMessagePreviewMax:
        typeof captureAttrs.userMessagePreviewMax === "number" ? captureAttrs.userMessagePreviewMax : undefined,
    };

    const sourceInfos = await Promise.all(
      discoveredSources.map(async (source) => {
        const s = await stat(source).catch(() => undefined);
        const mtimeMs = s?.mtimeMs ?? 0;
        const ageMs = mtimeMs > 0 ? Math.max(0, generatedAt - mtimeMs) : Number.POSITIVE_INFINITY;
        const excluded = excludeSet.has(source);
        const loaded = !excluded;
        const active = loaded && ageMs <= SOURCE_ACTIVE_WINDOW_MS;
        return {
          path: source,
          loaded,
          excluded,
          mtimeMs,
          ageMs,
          status: active ? "active" : "idle",
        };
      }),
    );

    return NextResponse.json({
      ok: true,
      tracePath: resolved.mode === "single" ? resolved.tracePath : `${resolved.rootDir} (${sources.length} root sessions)`,
      traceMode: resolved.mode,
      traceRoot: resolved.rootDir,
      projectFilter: resolved.projectFilter,
      loadedSessions: sources.length,
      discoveredSessions: discoveredSources.length,
      sourceFiles: sources,
      discoveredSourceFiles: discoveredSources,
      sourceInfos,
      settings,
      excludedSourceFiles: [...excludeSet],
      generatedAt,
      totalRecords: records.length,
      malformedLines,
      lagMs,
      staleThresholdMs,
      isStale,
      ...timeline,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
