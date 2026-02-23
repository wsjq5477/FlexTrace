import { NextRequest, NextResponse } from "next/server";
import { loadTraceFiles, resolveTraceSource } from "@/lib/trace";

export const dynamic = "force-dynamic";

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
      excludedSourceFiles: [...excludeSet],
      totalRecords: records.length,
      malformedLines,
      records,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
