import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0330Package } from "../../v0330/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.31";

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

function rewritePopup(source: string) {
  let rewritten = source.replace('const VERSION = "0.3.30";', 'const VERSION = "0.3.31";');

  rewritten = replaceRequired(
    rewritten,
    [
      'const uploadDate = document.getElementById("uploadDate");',
      'const dateSearch = document.getElementById("dateSearch");',
      'const dateReset = document.getElementById("dateReset");',
    ].join("\n"),
    [
      'const fromDate = document.getElementById("fromDate");',
      'const toDate = document.getElementById("toDate");',
      'const dateSearch = document.getElementById("dateSearch");',
      'const dateReset = document.getElementById("dateReset");',
      '',
      'function kstToday() {',
      '  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);',
      '}',
      'if (fromDate && !fromDate.value) fromDate.value = kstToday();',
      'if (toDate && !toDate.value) toDate.value = kstToday();',
    ].join("\n"),
    "v0331_popup_period_nodes_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    [
      'function listUrl() {',
      '  const params = new URLSearchParams({ bridge: BRIDGE });',
      '  const day = text(uploadDate && uploadDate.value);',
      '  if (day) {',
      '    const start = new Date(day + "T00:00:00");',
      '    const end = new Date(start);',
      '    end.setDate(end.getDate() + 1);',
      '    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {',
      '      params.set("from", start.toISOString());',
      '      params.set("to", end.toISOString());',
      '    }',
      '  }',
      '  return LIST_ENDPOINT + "?" + params.toString();',
      '}',
    ].join("\n"),
    [
      'function kstStartIso(day) {',
      '  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(day)) return "";',
      '  const value = new Date(day + "T00:00:00+09:00");',
      '  return Number.isNaN(value.getTime()) ? "" : value.toISOString();',
      '}',
      '',
      'function kstExclusiveEndIso(day) {',
      '  const start = kstStartIso(day);',
      '  if (!start) return "";',
      '  return new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();',
      '}',
      '',
      'function listUrl() {',
      '  const params = new URLSearchParams({ bridge: BRIDGE, strict_pending: "1" });',
      '  const fromDay = text(fromDate && fromDate.value);',
      '  const toDay = text(toDate && toDate.value);',
      '  const fromIso = kstStartIso(fromDay);',
      '  const toIso = kstExclusiveEndIso(toDay);',
      '  if (fromIso) params.set("from", fromIso);',
      '  if (toIso) params.set("to", toIso);',
      '  return LIST_ENDPOINT + "?" + params.toString();',
      '}',
    ].join("\n"),
    "v0331_popup_period_url_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    [
      'dateSearch.addEventListener("click", loadItems);',
      'dateReset.addEventListener("click", function () { uploadDate.value = ""; loadItems(); });',
      'uploadDate.addEventListener("change", loadItems);',
    ].join("\n"),
    [
      'dateSearch.addEventListener("click", loadItems);',
      'dateReset.addEventListener("click", function () {',
      '  const today = kstToday();',
      '  fromDate.value = today;',
      '  toDate.value = today;',
      '  loadItems();',
      '});',
      'fromDate.addEventListener("change", function () {',
      '  if (toDate.value && fromDate.value > toDate.value) toDate.value = fromDate.value;',
      '});',
      'toDate.addEventListener("change", function () {',
      '  if (fromDate.value && toDate.value < fromDate.value) fromDate.value = toDate.value;',
      '});',
    ].join("\n"),
    "v0331_popup_period_events_missing",
  );

  assertScript("popup-v0331", rewritten);
  return rewritten;
}

function rewritePopupHtml(source: string) {
  let rewritten = source.replaceAll("0.3.30", VERSION);
  rewritten = replaceRequired(
    rewritten,
    '<div class="datebar"><input id="uploadDate" type="date" title="SEO 대량등록 Shopling 업로드 날짜"><button id="dateSearch" type="button">날짜조회</button><button id="dateReset" type="button">최근</button></div>',
    '<div class="datebar"><input id="fromDate" type="date" title="Shopling 업로드 완료 시작일"><span>~</span><input id="toDate" type="date" title="Shopling 업로드 완료 종료일"><button id="dateSearch" type="button">기간조회</button><button id="dateReset" type="button">오늘</button></div>',
    "v0331_popup_period_html_missing",
  );
  rewritten = rewritten.replace(
    "날짜별 업로드 조회 · 동일 B코드는 업로드 배치ID/시간으로 구분 · 과거건은 A18 미등록 검색으로 실등록 자동확인",
    "Shopling 업로드 완료일 기간조회 · 미전송 대기채널만 선택 · 확인필요/처리중은 자동 제외",
  );
  return rewritten;
}

export async function GET() {
  const response = await getV0330Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0330_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as {
    version?: string;
    name?: string;
    short_name?: string;
    description?: string;
  };
  if (manifest.version !== "0.3.30") throw new Error("shopling_market_sender_v0331_source_version_mismatch");

  manifest.version = VERSION;
  manifest.name = "Commerce OS Shopling Market Sender · 기간 미전송 전용";
  manifest.short_name = "Shopling Market Sender";
  manifest.description = "상품명 변경 없이 Shopling 업로드 완료일 기간으로 상품을 조회하고, 마켓 미전송 대기채널만 기존 A18 안전검증 후 최대 3상품/18채널 병렬 전송합니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(rewritePopupHtml(strFromU8(entries["popup.html"])));
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\nMarket only: title diversification excluded\nDate basis: Shopling upload completed_at, KST inclusive range\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.31 MARKET-ONLY PERIOD FILTER\n` +
      `- 상품명 분산/수정 기능은 포함하지 않습니다. 이 확장은 마켓전송 전용입니다.\n` +
      `- 시작일~종료일을 대한민국 시간(KST) 기준으로 지정해 Shopling 업로드 완료 건을 조회합니다. 종료일은 해당 날짜 23:59:59까지 포함됩니다.\n` +
      `- 조회 기준 시각은 product_launch_upload_jobs.completed_at이며, 운영 데이터에서 shopling_product_group_registry.registered_at과 동일한 Shopling 업로드 완료 시각으로 기록됩니다.\n` +
      `- 자동 선택은 최신 성공 배치 + Shopling 6/6 + fresh pending 채널이 있는 상품만 허용합니다. sent/already_registered는 제외합니다.\n` +
      `- claimed/submit_armed/confirm_needed/legacy_ignored 등 중단·불명확 상태가 섞인 상품은 자동선택에서 제외해 별도 확인 대상으로 남깁니다.\n` +
      `- 실제 송신은 v0.3.30의 goods_key+자사상품코드 A18 정확검증, 영구 submit lock, 최대 3상품/18채널 병렬 엔진을 그대로 사용합니다.\n` +
      `- 기존 SEO 클라우드 원클릭 handoff/재부팅 복구 에이전트는 그대로 유지합니다.\n\n` +
      previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.31.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
