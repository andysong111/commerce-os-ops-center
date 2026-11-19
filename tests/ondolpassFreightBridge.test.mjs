import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { unzipSync } from "fflate";

import { GET } from "../src/app/api/ondolpass-freight-bridge/download/route.ts";
import { parseFreightApplicationText } from "../src/lib/freightApplicationParser.ts";
import {
  ONDOLPASS_FREIGHT_BRIDGE_CHANNEL,
  ONDOLPASS_FREIGHT_EXTENSION_SOURCE,
  buildOndolpassFreightDateRangeImport,
  buildOndolpassFreightImport,
  getOndolpassFreightBridgeErrorMessage,
  parseOndolpassFreightExtensionMessage,
} from "../src/lib/ondolpassFreightBridge.ts";
import { assignPastedImagesToItems } from "../src/lib/richPasteExtractor.ts";

const VALID_PAYLOAD = {
  applicationNo: "673626",
  sourceUrl:
    "https://www.ondolpass.co.kr/order/order_view.php?order_no=673626",
  items: [
    {
      rowNo: 2,
      text: `제품정보:(2)[입고]
품목
Tape Measure
옵션(색상,사이즈)
型号: 2米/13MM
상품상세url
https://detail.1688.com/offer/613677636508.html
hs_code
9017801000
단가
3.4
수량
10
트레킹번호
613677636508
오픈마켓 주문번호
3317018629199027099`,
      imageUrl:
        "https://cbu01.alicdn.com/img/ibank/O1CN01-example-2.jpg",
    },
    {
      rowNo: 1,
      text: `제품정보:(1)[입고]
품목
Tape Measure
옵션(색상,사이즈)
型号: 1米/13MM
상품상세url
https://detail.1688.com/offer/613677636508.html
hs_code
9017801000
단가
2.6
수량
15
트레킹번호
613677636508
오픈마켓 주문번호
3317018629199027099`,
      imageUrl:
        "https://cbu01.alicdn.com/img/ibank/O1CN01-example-1.jpg",
    },
  ],
};

test("validated Ondolpass payload feeds the existing parser and image matcher", () => {
  const imported = buildOndolpassFreightImport(VALID_PAYLOAD, "673626");
  const parsed = parseFreightApplicationText(imported.rawText);
  const items = assignPastedImagesToItems(
    parsed.items,
    imported.pastedImages,
  );

  assert.equal(imported.applicationNo, "673626");
  assert.equal(imported.itemCount, 2);
  assert.equal(parsed.applicationNo, "673626");
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].quantity, 15);
  assert.equal(parsed.items[1].quantity, 10);
  assert.match(items[0].pastedImageUrl, /example-1\.jpg$/);
  assert.match(items[1].pastedImageUrl, /example-2\.jpg$/);
});

test("bridge payload fails closed on identity, duplicate row, and personal data", () => {
  assert.throws(
    () => buildOndolpassFreightImport(VALID_PAYLOAD, "673625"),
    /신청서 번호가 다릅니다/,
  );
  assert.throws(
    () =>
      buildOndolpassFreightImport(
        {
          ...VALID_PAYLOAD,
          sourceUrl:
            "https://www.ondolpass.co.kr/order/order_view.php?order_no=999999",
        },
        "673626",
      ),
    /다른 온돌패스 페이지/,
  );
  assert.throws(
    () =>
      buildOndolpassFreightImport(
        {
          ...VALID_PAYLOAD,
          items: [VALID_PAYLOAD.items[0], VALID_PAYLOAD.items[0]],
        },
        "673626",
      ),
    /중복된 제품정보 번호/,
  );
  assert.throws(
    () =>
      buildOndolpassFreightImport(
        {
          ...VALID_PAYLOAD,
          items: [
            {
              ...VALID_PAYLOAD.items[0],
              text: `${VALID_PAYLOAD.items[0].text}\n수취인정보\n홍길동`,
            },
          ],
        },
        "673626",
      ),
    /개인정보 영역/,
  );
});

test("page accepts only the versioned extension response envelope", () => {
  assert.deepEqual(
    parseOndolpassFreightExtensionMessage({
      channel: ONDOLPASS_FREIGHT_BRIDGE_CHANNEL,
      source: ONDOLPASS_FREIGHT_EXTENSION_SOURCE,
      type: "READY",
    }),
    {
      channel: ONDOLPASS_FREIGHT_BRIDGE_CHANNEL,
      source: ONDOLPASS_FREIGHT_EXTENSION_SOURCE,
      type: "READY",
    },
  );
  assert.equal(
    parseOndolpassFreightExtensionMessage({
      channel: ONDOLPASS_FREIGHT_BRIDGE_CHANNEL,
      source: "untrusted-page",
      type: "READY",
    }),
    undefined,
  );
  assert.match(
    getOndolpassFreightBridgeErrorMessage("ONDOLPASS_LOGIN_REQUIRED"),
    /로그인/,
  );
  assert.equal(
    parseOndolpassFreightExtensionMessage({
      channel: ONDOLPASS_FREIGHT_BRIDGE_CHANNEL,
      source: ONDOLPASS_FREIGHT_EXTENSION_SOURCE,
      type: "DATE_RANGE_RESULT",
      requestId: "range-1",
      startDate: "2026-11-18",
      endDate: "2026-11-18",
      payload: {},
    })?.type,
    "DATE_RANGE_RESULT",
  );
});

test("validated Ondolpass date range returns only the exact application rows", () => {
  const imported = buildOndolpassFreightDateRangeImport(
    {
      sourceUrl:
        "https://www.ondolpass.co.kr/mypage/ship_lcl_list.php?date_type=order_date&s_date=2026-11-18&e_date=2026-11-18&searchType=addressee&page_line=500&page_choice=1",
      startDate: "2026-11-18",
      endDate: "2026-11-18",
      applications: [
        { applicationNo: "673626", applicationDate: "2026-11-18" },
        { applicationNo: "673624", applicationDate: "2026-11-18" },
        { applicationNo: "673623", applicationDate: "2026-11-18" },
        { applicationNo: "673622", applicationDate: "2026-11-18" },
      ],
    },
    "2026-11-18",
    "2026-11-18",
  );

  assert.deepEqual(imported.applicationNos, ["673626", "673624", "673623", "673622"]);
  assert.throws(
    () =>
      buildOndolpassFreightDateRangeImport(
        {
          sourceUrl:
            "https://www.ondolpass.co.kr/mypage/ship_lcl_list.php?date_type=order_date&s_date=2026-11-18&e_date=2026-11-18&page_line=500",
          startDate: "2026-11-18",
          endDate: "2026-11-18",
          applications: [
            { applicationNo: "673592", applicationDate: "2026-11-17" },
          ],
        },
        "2026-11-18",
        "2026-11-18",
      ),
    /조회 범위를 벗어났습니다/,
  );
});

test("browser extractor reads only exact product blocks and restores full 1688 URLs", async () => {
  const source = await readFile(
    new URL(
      "../public/ondolpass-freight-bridge/ondolpass-extractor.js",
      import.meta.url,
    ),
    "utf8",
  );
  const context = vm.createContext({ URL });
  vm.runInContext(source, context);

  function itemElement(rowNo, detailUrl, imageUrl) {
    return {
      id: `div_item_${rowNo}`,
      innerText: `제품정보:(${rowNo})[입고]\n품목\nTape Measure\n상품상세url\nhttps://detail.1688.com/offer/613...html\nhs_code\n9017801000\n수량\n${rowNo}`,
      querySelector(selector) {
        return selector.includes("detail.1688.com") ? { href: detailUrl } : null;
      },
      querySelectorAll(selector) {
        return selector === "img"
          ? [
              {
                currentSrc: imageUrl,
                src: imageUrl,
                getAttribute() {
                  return null;
                },
              },
            ]
          : [];
      },
    };
  }

  const documentLike = {
    location: {
      href: "https://www.ondolpass.co.kr/order/order_view.php?order_no=673626",
    },
    body: {
      innerText:
        "신청번호:673626\n수취인정보\n홍길동\n휴대전화\n010-0000-0000",
    },
    querySelectorAll() {
      return [
        itemElement(
          2,
          "https://detail.1688.com/offer/222222222222.html",
          "https://cbu01.alicdn.com/img/two.jpg",
        ),
        itemElement(
          1,
          "https://detail.1688.com/offer/111111111111.html",
          "https://cbu01.alicdn.com/img/one.jpg",
        ),
      ];
    },
  };

  const extracted = context.OndolpassFreightExtractor.extract(documentLike);
  assert.equal(extracted.applicationNo, "673626");
  assert.deepEqual(
    Array.from(extracted.items, (item) => item.rowNo),
    [1, 2],
  );
  assert.match(extracted.items[0].text, /111111111111\.html/);
  assert.doesNotMatch(extracted.items[0].text, /홍길동|휴대전화/);
  assert.equal(
    extracted.items[0].imageUrl,
    "https://cbu01.alicdn.com/img/one.jpg",
  );
});

test("browser date-range extractor reads the verified Ondolpass list row structure", async () => {
  const source = await readFile(
    new URL(
      "../public/ondolpass-freight-bridge/ondolpass-range-extractor.js",
      import.meta.url,
    ),
    "utf8",
  );
  const context = vm.createContext({ URL });
  vm.runInContext(source, context);
  const rows = ["673626", "673624", "673623", "673622"].map(
    (applicationNo) => ({
      value: applicationNo,
      closest() {
        return { innerText: `2026-11-18 [L배]${applicationNo} 송승준` };
      },
    }),
  );
  const payload = context.OndolpassFreightRangeExtractor.extract({
    location: {
      href: "https://www.ondolpass.co.kr/mypage/ship_lcl_list.php?date_type=order_date&s_date=2026-11-18&e_date=2026-11-18&searchType=addressee&page_line=500&page_choice=1",
    },
    querySelectorAll(selector) {
      assert.equal(selector, 'div.row.order_list input[name="ckbox"]');
      return rows;
    },
  });

  assert.deepEqual(
    Array.from(payload.applications, (row) => row.applicationNo),
    ["673626", "673624", "673623", "673622"],
  );
});

test("extension manifest stays read-only and narrowly scoped", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL(
        "../public/ondolpass-freight-bridge/manifest.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(manifest.permissions, ["tabs", "scripting"]);
  assert.equal(manifest.version, "0.2.0");
  assert.deepEqual(manifest.host_permissions, [
    "https://ondolpass.co.kr/*",
    "https://www.ondolpass.co.kr/*",
    "https://commerce-os-ops-center.vercel.app/*",
  ]);

  for (const fileName of [
    "background.js",
    "ondolpass-extractor.js",
    "ondolpass-capture.js",
    "ondolpass-range-extractor.js",
    "ondolpass-range-capture.js",
    "content-ondolpass.js",
    "content-commerce-os.js",
  ]) {
    const script = await readFile(
      new URL(`../public/ondolpass-freight-bridge/${fileName}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(script, /chrome\.cookies|\.click\s*\(|fetch\s*\(/);
  }

  const background = await readFile(
    new URL("../public/ondolpass-freight-bridge/background.js", import.meta.url),
    "utf8",
  );
  assert.match(background, /chrome\.scripting\.executeScript/);
  assert.match(background, /"ondolpass-extractor\.js", "ondolpass-capture\.js"/);
  assert.match(
    background,
    /"ondolpass-range-extractor\.js", "ondolpass-range-capture\.js"/,
  );
  assert.match(background, /page_line: "500"/);
});

test("download route returns a complete no-cache extension ZIP", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(
    response.headers.get("content-disposition") || "",
    /commerce-os-ondolpass-freight-bridge-v0\.2\.0\.zip/,
  );

  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), [
    "README.txt",
    "background.js",
    "content-commerce-os.js",
    "content-ondolpass.js",
    "manifest.json",
    "ondolpass-capture.js",
    "ondolpass-extractor.js",
    "ondolpass-range-capture.js",
    "ondolpass-range-extractor.js",
  ]);
});

test("freight page keeps the number import control and manual fallback together", async () => {
  const pageSource = await readFile(
    new URL("../src/app/freight-barcode-request/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(pageSource, /id="ondolpass-application-no"/);
  assert.match(pageSource, /가져와서 자동 분석/);
  assert.match(pageSource, /기간 신청서 가져와서 자동 분석/);
  assert.match(pageSource, /\/api\/ondolpass-freight-bridge\/download/);
  assert.match(pageSource, /신청서 분석하기/);
  assert.match(pageSource, /handleRichPaste/);
});
