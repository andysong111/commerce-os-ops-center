import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0331Package } from "../../v0331/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.32";

function replaceRequired(source: string, anchor: string, replacement: string, code: string) {
  const first = source.indexOf(anchor);
  if (first < 0) throw new Error(code);
  if (source.indexOf(anchor, first + anchor.length) >= 0) throw new Error(`${code}_ambiguous`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}

function assertScript(name: string, source: string) {
  try {
    new Function(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "syntax error");
    throw new Error(`shopling_market_sender_${name}_invalid: ${message}`);
  }
}

function rewriteBackground(source: string) {
  let rewritten = source;

  rewritten = replaceRequired(
    rewritten,
    "    registeredAt: text(raw?.registeredAt),\n  };\n}",
    "    registeredAt: text(raw?.registeredAt),\n    claimEpoch: text(raw?.claimEpoch),\n  };\n}",
    "v0332_background_claim_epoch_normalize_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    [
      "  const previous = await getWorkerMeta();",
      "  const existingGoodsKeys = new Set(previous?.runId === runId ? assignmentArray(previous).map((assignment) => text(assignment?.goodsKey)).filter(Boolean) : []);",
      "  const tasksToOpen = tasks.filter((task) => !existingGoodsKeys.has(task.goodsKey));",
      "  if (!tasksToOpen.length) {",
      "    return { ok: true, resumed: true, openedCount: 0, assignments: assignmentArray(previous) };",
      "  }",
    ].join("\n"),
    [
      "  const previous = await getWorkerMeta();",
      "  const reusableGoodsKeys = new Set();",
      "  if (previous?.runId === runId) {",
      "    const incomingByKey = new Map(tasks.map((task) => [task.goodsKey, task]));",
      "    for (const assignment of assignmentArray(previous)) {",
      "      const goodsKey = text(assignment?.goodsKey);",
      "      const incoming = incomingByKey.get(goodsKey);",
      "      if (!incoming || assignment?.status !== 'active') continue;",
      "      const incomingEpoch = text(incoming?.claimEpoch);",
      "      const assignmentEpoch = text(assignment?.task?.claimEpoch);",
      "      if (incomingEpoch && assignmentEpoch === incomingEpoch) { reusableGoodsKeys.add(goodsKey); continue; }",
      "      if (!incomingEpoch) {",
      "        const touchedAt = Number(assignment?.updatedAt || assignment?.openedAt || 0);",
      "        const age = Date.now() - touchedAt;",
      "        if (Number.isFinite(age) && age >= 0 && age < 30000) reusableGoodsKeys.add(goodsKey);",
      "      }",
      "    }",
      "  }",
      "  const tasksToOpen = tasks.filter((task) => !reusableGoodsKeys.has(task.goodsKey));",
      "  if (!tasksToOpen.length) {",
      "    return { ok: true, resumed: true, openedCount: 0, assignments: assignmentArray(previous) };",
      "  }",
    ].join("\n"),
    "v0332_background_stale_assignment_guard_missing",
  );

  assertScript("background-v0332", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  const rewritten = source.replace('const VERSION = "0.3.31";', 'const VERSION = "0.3.32";');
  assertScript("popup-v0332", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0331Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0331_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as {
    version?: string;
    name?: string;
    short_name?: string;
    description?: string;
  };
  if (manifest.version !== "0.3.31") throw new Error("shopling_market_sender_v0332_source_version_mismatch");

  manifest.version = VERSION;
  manifest.name = "Commerce OS Shopling Market Sender · 기간 미전송 전용";
  manifest.short_name = "Shopling Market Sender";
  manifest.description = "Shopling 업로드 기간의 미전송 상품을 전송하며, 재부팅·작업창 소실로 죽은 이전 Worker를 새 claim 세대로 구분해 안전하게 다시 여는 v0.3.32입니다.";

  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(strFromU8(entries["popup.html"]).replaceAll("0.3.31", VERSION));
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\nMarket only: title diversification excluded\nRetry identity: durable claimEpoch\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.32 FRESH WORKER CLAIM-EPOCH RECOVERY\n` +
      `- 서버가 같은 goods_key를 다시 claim하면 claimed_at 기반 claimEpoch가 새로 발급됩니다.\n` +
      `- Chrome에 이전 Worker assignment가 남아 있어도 claimEpoch가 다르면 죽은 작업으로 판단하고 새 A18 Worker 창을 엽니다.\n` +
      `- 같은 claimEpoch의 active Worker만 재사용하므로 중복 OPEN 메시지에는 기존 idempotency를 유지합니다.\n` +
      `- claimEpoch가 없는 구형 경로는 30초 이내 active assignment만 재사용하고 오래된 메타데이터는 새 Worker를 허용합니다.\n` +
      `- 상품명 변경 기능은 없으며 v0.3.31의 기간 미전송 전용 UI와 v0.3.30의 A18 exact 검증/submit lock/최대 3상품·18채널 병렬 안전장치를 유지합니다.\n\n` +
      previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.32.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
