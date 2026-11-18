import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILES = [
  "manifest.json",
  "background.js",
  "ondolpass-extractor.js",
  "content-ondolpass.js",
  "content-commerce-os.js",
  "README.txt",
] as const;

export async function GET() {
  try {
    const root = resolve(process.cwd(), "public/ondolpass-freight-bridge");
    const entries: Record<string, Uint8Array> = {};
    for (const name of FILES) {
      const buffer = await readFile(resolve(root, name));
      entries[name] = new Uint8Array(buffer);
    }

    const archive = zipSync(entries, { level: 7 });
    return new Response(Buffer.from(archive), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition":
          'attachment; filename="commerce-os-ondolpass-freight-bridge-v0.1.0.zip"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "온돌패스 브리지 ZIP을 만들지 못했습니다.",
      },
      { status: 500 },
    );
  }
}
