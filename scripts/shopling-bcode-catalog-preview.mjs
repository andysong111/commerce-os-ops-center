import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const directory = await mkdtemp(join(tmpdir(), "shopling-bcode-preview-"));

function compile(source, fileName) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName,
  }).outputText;
}

try {
  const simpleXml = await readFile("src/lib/shopling/simpleXml.ts", "utf8");
  const transport = await readFile(
    "src/lib/shopling/shoplingTlsTransport.ts",
    "utf8",
  );
  const client = (
    await readFile("src/lib/shopling/shoplingReadClient.ts", "utf8")
  )
    .replace(
      'import { parseSimpleXml } from "@/lib/shopling/simpleXml";',
      'import { parseSimpleXml } from "./simpleXml.mjs";',
    )
    .replace(
      'import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";',
      'import { postShoplingXml } from "./shoplingTlsTransport.mjs";',
    );
  await Promise.all([
    writeFile(join(directory, "simpleXml.mjs"), compile(simpleXml, "simpleXml.ts")),
    writeFile(
      join(directory, "shoplingTlsTransport.mjs"),
      compile(transport, "shoplingTlsTransport.ts"),
    ),
    writeFile(
      join(directory, "shoplingReadClient.mjs"),
      compile(client, "shoplingReadClient.ts"),
    ),
  ]);
  const shoplingModule = await import(
    `${pathToFileURL(join(directory, "shoplingReadClient.mjs")).href}?v=${Date.now()}`
  );
  const start = process.argv[2] || new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const end = process.argv[3] || new Date().toISOString().slice(0, 10);
  const ranges = shoplingModule.splitShoplingDateRange(start, end, 90);
  const shopling = new shoplingModule.ShoplingReadClient(
    shoplingModule.shoplingReadConfigFromEnv(process.env),
  );
  const rows = [];
  for (const [index, range] of ranges.entries()) {
    rows.push(
      ...(await shopling.read("products", range, {
        productSearchType: "등록일",
      })),
    );
    if ((index + 1) % 5 === 0 || index + 1 === ranges.length) {
      process.stderr.write(`read-only ranges ${index + 1}/${ranges.length}\n`);
    }
  }
  const goodsKeys = new Set();
  const bCodeGoodsKeys = new Set();
  const saleStatuses = {};
  const goodsKeyStatuses = new Map();
  const bCodeGoodsKeyStatuses = new Map();
  const bCodeProfileGoodsKeys = new Map();
  const directProductGroupGoodsKeys = new Set();
  const directProductGroupValueGoodsKeys = new Map();
  for (const row of rows) {
    const goodsKey = String(row.goods_key ?? "").trim();
    const bCode = String(row.optPtnOptCd ?? "")
      .normalize("NFKC")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    const saleStatus = String(row.sale_status ?? "").trim().toUpperCase() || "UNKNOWN";
    if (/^\d+$/.test(goodsKey)) goodsKeys.add(goodsKey);
    if (/^\d+$/.test(goodsKey)) {
      const statuses = goodsKeyStatuses.get(goodsKey) ?? new Set();
      statuses.add(saleStatus);
      goodsKeyStatuses.set(goodsKey, statuses);
    }
    if (/^\d+$/.test(goodsKey) && /^B[A-Z]{1,2}\d+-\d+$/.test(bCode)) {
      bCodeGoodsKeys.add(goodsKey);
      const statuses = bCodeGoodsKeyStatuses.get(goodsKey) ?? new Set();
      statuses.add(saleStatus);
      bCodeGoodsKeyStatuses.set(goodsKey, statuses);
      const suffix = String(row.ptn_goods_cd ?? "").trim().slice(-1).toLowerCase();
      const directProfile = String(row.prod_group ?? "").trim();
      if (directProfile) {
        directProductGroupGoodsKeys.add(goodsKey);
        const directValues = directProductGroupValueGoodsKeys.get(directProfile) ?? new Set();
        directValues.add(goodsKey);
        directProductGroupValueGoodsKeys.set(directProfile, directValues);
      }
      const normalizedDirectProfile = directProfile
        .replace(/\s+/g, "")
        .replace(/^(도매[1-4]|소매[1-2])번$/, "$1");
      const profileKey = ["도매1", "도매2", "도매3", "도매4", "소매1", "소매2"].includes(normalizedDirectProfile)
        ? normalizedDirectProfile
        : /^[a-f]$/.test(suffix)
          ? suffix
          : "";
      if (profileKey) {
        const profileGoodsKeys = bCodeProfileGoodsKeys.get(profileKey) ?? new Set();
        profileGoodsKeys.add(goodsKey);
        bCodeProfileGoodsKeys.set(profileKey, profileGoodsKeys);
      }
    }
    saleStatuses[saleStatus] = (saleStatuses[saleStatus] ?? 0) + 1;
  }
  process.stdout.write(
    `${JSON.stringify({
      readOnly: true,
      externalWrite: false,
      searchType: "등록일",
      start,
      end,
      rangeCount: ranges.length,
      sourceRowCount: rows.length,
      goodsKeyCount: goodsKeys.size,
      bCodeGoodsKeyCount: bCodeGoodsKeys.size,
      saleStatusRowCounts: saleStatuses,
      goodsKeyStatusCounts: Object.fromEntries(
        [...goodsKeyStatuses.values()].flatMap((statuses) =>
          [...statuses].map((status) => [status, 1]),
        ).reduce((counts, [status]) => {
          counts.set(status, (counts.get(status) ?? 0) + 1);
          return counts;
        }, new Map()),
      ),
      bCodeGoodsKeyStatusCounts: Object.fromEntries(
        [...bCodeGoodsKeyStatuses.values()].flatMap((statuses) =>
          [...statuses].map((status) => [status, 1]),
        ).reduce((counts, [status]) => {
          counts.set(status, (counts.get(status) ?? 0) + 1);
          return counts;
        }, new Map()),
      ),
      bCodeProfileGoodsKeyCounts: Object.fromEntries(
        [...bCodeProfileGoodsKeys].map(([suffix, values]) => [suffix, values.size]),
      ),
      directProductGroupGoodsKeyCount: directProductGroupGoodsKeys.size,
      topDirectProductGroupGoodsKeyCounts: Object.fromEntries(
        [...directProductGroupValueGoodsKeys]
          .map(([value, values]) => [value, values.size])
          .sort((left, right) => right[1] - left[1])
          .slice(0, 20),
      ),
    })}\n`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
