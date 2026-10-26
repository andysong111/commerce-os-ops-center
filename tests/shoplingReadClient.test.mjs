import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

async function loadShoplingClient() {
  const directory = await mkdtemp(
    join(process.cwd(), "tests", ".shopling-client-"),
  );
  try {
    const xmlSource = await readFile("src/lib/shopling/simpleXml.ts", "utf8");
    const clientSource = (
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
    const compile = (source, fileName) =>
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
        fileName,
      }).outputText;
    await writeFile(
      join(directory, "simpleXml.mjs"),
      compile(xmlSource, "simpleXml.ts"),
    );
    await writeFile(
      join(directory, "shoplingTlsTransport.mjs"),
      'export async function postShoplingXml() { throw new Error("SHOPLING_NETWORK_NOT_USED_IN_PARSER_TESTS"); }\n',
    );
    await writeFile(
      join(directory, "shoplingReadClient.mjs"),
      compile(clientSource, "shoplingReadClient.ts"),
    );
    return {
      xml: await import(
        `${pathToFileURL(join(directory, "simpleXml.mjs")).href}?v=${Date.now()}`
      ),
      client: await import(
        `${pathToFileURL(join(directory, "shoplingReadClient.mjs")).href}?v=${Date.now()}`
      ),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const loaded = await loadShoplingClient();
const normalize = await importTranspiledTypeScript(
  new URL("../src/lib/shopling/shoplingNormalize.ts", import.meta.url),
);

const { parseSimpleXml } = loaded.xml;
const {
  buildShoplingReadRequestXml,
  parseShoplingReadResponse,
  shoplingReadConfigFromEnv,
  splitShoplingDateRange,
} = loaded.client;
const {
  canonicalShoplingManagedCodeCandidate,
  classifyShoplingClaim,
  normalizeShoplingClaim,
  normalizeShoplingOrder,
  normalizeShoplingProduct,
  resolveKnownShoplingManagedCode,
} = normalize;

test("bounded XML parser supports declaration, CDATA, entities and repeated tags", () => {
  const parsed = parseSimpleXml(`<?xml version="1.0"?>
    <rspns><items>
      <row><name><![CDATA[A&B]]></name><value>1 &amp; 2</value></row>
      <row><name>Second</name><value>3</value></row>
    </items></rspns>`);
  assert.deepEqual(parsed, {
    rspns: {
      items: {
        row: [
          { name: "A&B", value: "1 & 2" },
          { name: "Second", value: "3" },
        ],
      },
    },
  });
});

test("product response flattens option dimensions into option rows", () => {
  const rows = parseShoplingReadResponse(
    "products",
    `<?xml version="1.0"?><rspns><apiProdGather><goodsInfo>
      <goods_key>1001</goods_key><prod_id>P1</prod_id><prod_nm>테스트 상품</prod_nm>
      <org_price>500</org_price><sale_status>B</sale_status>
      <options>
        <optList><title>색상</title><value>빨강,파랑</value></optList>
        <optId>O1,O2</optId><optBarcode>BAA1-1,BAA1-2</optBarcode>
        <optPtnOptCd>BAA1-1,BAA1-2</optPtnOptCd><optStatus>B,B</optStatus>
      </options>
    </goodsInfo></apiProdGather></rspns>`,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].optId, "O1");
  assert.equal(rows[0].optBarcode, "BAA1-1");
  assert.equal(rows[0].optionName, "색상: 빨강");
  assert.equal(rows[1].optionName, "색상: 파랑");
});

test("order and claim responses preserve repeated rows", () => {
  const orders = parseShoplingReadResponse(
    "orders",
    `<rspns><apiOrdGatherRst>
      <ordListRst><ord_no>A1</ord_no><opt_id>O1</opt_id></ordListRst>
      <ordListRst><ord_no>A2</ord_no><opt_id>O2</opt_id></ordListRst>
    </apiOrdGatherRst></rspns>`,
  );
  const claims = parseShoplingReadResponse(
    "claims",
    `<rspns><apiClaimGatherRst>
      <claimListRst><claim_key>C1</claim_key><ord_no>A1</ord_no></claimListRst>
      <claimListRst><claim_key>C2</claim_key><ord_no>A2</ord_no></claimListRst>
    </apiClaimGatherRst></rspns>`,
  );
  assert.deepEqual(orders.map((row) => row.ord_no), ["A1", "A2"]);
  assert.deepEqual(claims.map((row) => row.claim_key), ["C1", "C2"]);
});

test("request builder contains read gather fields and keeps credentials in CDATA", () => {
  const request = buildShoplingReadRequestXml(
    "orders",
    { loginId: "id&1", companyId: "company", authKey: "secret" },
    { start: "2026-08-01", end: "2026-08-05" },
  );
  assert.match(request, /<apiOrdGather>/);
  assert.match(request, /<login_id><!\[CDATA\[id&1\]\]><\/login_id>/);
  assert.match(request, /<start_dt>20260801<\/start_dt>/);
  assert.match(request, /mall_ord_cnt/);
});

test("date ranges enforce seven-day order chunks", () => {
  assert.deepEqual(splitShoplingDateRange("2026-07-20", "2026-08-05", 7), [
    { start: "2026-07-20", end: "2026-07-26" },
    { start: "2026-07-27", end: "2026-08-02" },
    { start: "2026-08-03", end: "2026-08-05" },
  ]);
  assert.throws(
    () => splitShoplingDateRange("2026-08-05", "2026-08-01", 7),
    /SHOPLING_DATE_RANGE_INVALID/,
  );
});

test("configuration fails closed when a credential is missing", () => {
  assert.throws(
    () =>
      shoplingReadConfigFromEnv({
        SHOPLING_LOGIN_ID: "id",
        SHOPLING_COMPANY_ID: "company",
      }),
    /SHOPLING_CREDENTIAL_REQUIRED:SHOPLING_API_AUTH_KEY/,
  );
});

test("normalization uses only managed option barcode and optionId identities", () => {
  const product = normalizeShoplingProduct({
    goods_key: "1001",
    prod_id: "P1",
    prod_nm: "테스트",
    optId: "O1",
    optBarcode: " baa1–1 ",
    optPtnOptCd: "OTHER-CODE",
    org_price: "1,200",
    optStatus: "B",
    sale_status: "B",
  });
  assert.equal(product.barcode, "BAA1-1");
  assert.equal(product.optionId, "O1");
  assert.equal(product.unitCost, 1200);

  const invalid = normalizeShoplingProduct({
    optId: "O2",
    optBarcode: "1234567890123",
    optPtnOptCd: "BAA1-9",
  });
  assert.equal(invalid.barcode, "");
});

test("order amount is quantity times unit price and claim severity follows known rules", () => {
  const order = normalizeShoplingOrder({
    ord_no: "A1",
    mall_ord_seq: "1",
    opt_id: "O1",
    mall_ord_dt: "20260805123000",
    mall_ord_cnt: "3",
    mall_unit_price: "700",
    mall_pay_amt: "999999",
    optPtnOptCd: "BBA3-3",
    ptn_goods_cd: "BBA2-1",
  });
  assert.equal(order.quantity, 3);
  assert.equal(order.paidAmount, 2100);
  assert.equal(order.barcode, "BBA3-3");
  assert.equal(order.orderedAt, "2026-08-05T12:30:00+09:00");

  assert.deepEqual(classifyShoplingClaim("상품 파손", "깨짐"), {
    category: "상품 문제",
    severityWeight: 1,
  });
  const claim = normalizeShoplingClaim({
    claim_key: "C1",
    mall_claim_rsn: "단순 변심",
    i_dt: "20260805130000",
  });
  assert.equal(claim.reasonCategory, "구매자 변심");
  assert.equal(claim.severityWeight, 0.3);
});

test("one trailing warehouse-location letter resolves only against a known canonical B-code", () => {
  const order = normalizeShoplingOrder({
    ord_no: "LOCATION-1",
    mall_ord_seq: "1",
    mall_ptn_opt_cd: " baf1–1e ",
  });
  assert.equal(order.partnerOptionCode, "BAF1-1E");
  assert.equal(order.barcode, "");

  const known = new Set(["BAF1-1", "BBA2-1"]);
  assert.equal(canonicalShoplingManagedCodeCandidate(" baf1–1e "), "BAF1-1");
  assert.equal(resolveKnownShoplingManagedCode("BAF1-1e", known), "BAF1-1");
  assert.equal(resolveKnownShoplingManagedCode("BAF1-1", known), "BAF1-1");
  assert.equal(resolveKnownShoplingManagedCode("BAF1-1EXTRA", known), "");
  assert.equal(resolveKnownShoplingManagedCode("BZZ9-9e", known), "");
});
