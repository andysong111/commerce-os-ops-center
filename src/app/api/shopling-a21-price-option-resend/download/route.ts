import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.5.11";
const ROOT = "shopling-a21-price-option-resend";
const FILES = [
  "manifest.json",
  "background-monthly-price.js",
  "monthly-price-dom.js",
  "monthly-price-page-bridge.js",
  "background-v020.js",
  "background-v041.js",
  "background-v042.js",
  "background-v043.js",
  "background-v044.js",
  "content-a21.js",
  "main-a21-v024.js",
  "content-a21-v024.js",
  "monthly-status-main-v053.js",
  "monthly-status-popup-v053.js",
  "popup-run.html",
  "popup-run.js",
  "README.txt",
] as const;

function assertJavaScript(name: string, source: string) {
  try {
    new Function(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "syntax error");
    throw new Error(`shopling_a21_resend_${name}_invalid:${message}`);
  }
}

export async function GET() {
  const publicRoot = path.join(process.cwd(), "public", ROOT);
  const entries: Record<string, Uint8Array> = {};
  for (const fileName of FILES) {
    const source = await readFile(path.join(publicRoot, fileName), "utf8");
    if (fileName.endsWith(".js")) assertJavaScript(fileName, source);
    if (fileName === "manifest.json") {
      const manifest = JSON.parse(source) as {
        manifest_version?: number;
        version?: string;
        permissions?: string[];
        background?: { service_worker?: string };
        action?: { default_popup?: string };
        content_scripts?: Array<{ js?: string[]; exclude_matches?: string[]; world?: string }>;
      };
      if (manifest.manifest_version !== 3) throw new Error("shopling_a21_resend_manifest_v3_required");
      if (manifest.version !== VERSION) throw new Error("shopling_a21_resend_manifest_version_mismatch");
      if (manifest.background?.service_worker !== "background-monthly-price.js") throw new Error("shopling_a21_resend_background_v044_required");
      if (manifest.action?.default_popup !== "popup-run.html") throw new Error("shopling_a21_resend_run_popup_missing");
      const listRuntime = manifest.content_scripts?.find((item) => item.js?.includes("content-a21.js"));
      if (!listRuntime?.exclude_matches?.some((match) => match.includes("goods_mallMdfy_trsmt.phtml"))) {
        throw new Error("shopling_a21_resend_list_popup_separation_missing");
      }
      const mainRuntime = manifest.content_scripts?.find((item) => item.js?.includes("main-a21-v024.js") && item.world === "MAIN");
      if (!mainRuntime) throw new Error("shopling_a21_resend_v044_native_submit_required");
      if (!mainRuntime.js?.includes("monthly-status-main-v053.js")) throw new Error("shopling_a21_resend_monthly_status_main_missing");
      const statusRuntime = manifest.content_scripts?.find((item) => item.js?.includes("content-a21-v024.js") && item.js?.includes("monthly-status-popup-v053.js"));
      if (!statusRuntime) throw new Error("shopling_a21_resend_monthly_status_popup_missing");
      if (manifest.content_scripts?.some((item) => item.js?.some((name) => name.includes("result-watch")))) {
        throw new Error("shopling_a21_resend_v044_static_result_observer_forbidden");
      }
      for (const permission of ["windows", "tabs", "scripting", "webNavigation", "debugger"]) {
        if (!manifest.permissions?.includes(permission)) throw new Error(`shopling_a21_resend_permission_missing:${permission}`);
      }
    }
    entries[fileName] = strToU8(source);
  }
  const zip = zipSync(entries, { level: 9 });
  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="commerce-os-shopling-a21-resend-v${VERSION}.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
