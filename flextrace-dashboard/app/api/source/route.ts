import { access, unlink } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as { path?: string };
    const input = typeof body.path === "string" ? body.path.trim() : "";
    if (!input) {
      return NextResponse.json({ ok: false, error: "Missing source file path." }, { status: 400 });
    }
    const resolved = path.resolve(input);
    if (!resolved.endsWith(".ndjson")) {
      return NextResponse.json({ ok: false, error: "Only .ndjson files can be deleted." }, { status: 400 });
    }
    await access(resolved);
    await unlink(resolved);
    return NextResponse.json({ ok: true, deleted: resolved });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
