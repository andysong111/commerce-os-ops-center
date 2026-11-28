import test from "node:test";
import assert from "node:assert/strict";
import {
  blankRestock,
  composeRestock,
  estimatedSmsBytes,
  operatorTestMessage,
  ownStoreLink,
  parseRestock,
  storeProductNumber,
} from "../src/lib/restockAlertCore.ts";
import { dispatchRestockJob } from "../local-agent/mobile-work-center/restock-sms.mjs";
import { matchHistory } from "../local-agent/mobile-work-center/restock-browser.mjs";

import { rankRestockOffers } from "../src/lib/restockMarketOffer.ts";
import { PRODUCT_GROUP_MARKET_REGISTRY } from "../src/lib/productGroupMarketRegistry.ts";

test("lowest price follows the exact option and allowed selling accounts across all four markets", () => {
  const row = (mallKey, code, basePrice, status = "판매중") => {
    const a = PRODUCT_GROUP_MARKET_REGISTRY.find((a) => a.mallKey === mallKey);
    return {
      site: a.marketName,
      account: a.accountIdLabel,
      code,
      basePrice,
      status,
    };
  };
  const rows = [
    row("SMALL_00014", "721", 2600),
    row("SMALL_00069", "123458", 2700),
    row("SMALL_00107", "WABCDEF", 2800),
    row("SMALL_00004", "2413", 2900),
    row("SMALL_00069", "123459", 1, "삭제"),
    row("SMALL_00003", "999", 1),
    { ...row("SMALL_00069", "123456", 1), account: "unrelated" },
  ];
  for (const [i, market] of [
    "카페24",
    "도매꾹",
    "오너클랜",
    "스마트스토어",
  ].entries()) {
    const observations = [
      {
        goodsKey: "21",
        rows: rows.map((r, j) => (j === i ? { ...r, basePrice: 2000 } : r)),
      },
    ];
    const view = rankRestockOffers(
      [{ goodsKey: "21", adjustment: 250 }],
      observations,
    );
    assert.equal(view.marketCount, 4);
    assert.equal(view.offer.market, market);
    assert.equal(view.offer.price, 2250);
    const d = parse({ includeLowestOffer: true }).details;
    assert.equal(d.includeLowestOffer, true);
    const body = composeRestock(
      d,
      "제품",
      view.offer.url,
      noon,
      "",
      view.offer,
    );
    assert.equal(body.split(view.offer.url).length, 2);
    assert.ok(body.includes("2,250원"));
    assert.ok(
      !composeRestock(
        blankRestock,
        "제품",
        link,
        noon,
        "",
        view.offer,
      ).includes("2,250원"),
    );
  }
  const t = [
    { goodsKey: "21", adjustment: 400 },
    { goodsKey: "22", adjustment: 0 },
  ];
  const more = [
    { goodsKey: "21", rows },
    { goodsKey: "22", rows: [row("SMALL_00069", "91234", 2800)] },
  ];
  assert.equal(rankRestockOffers(t, more).offer.price, 2800);
  assert.equal(rankRestockOffers(t, more.slice(0, 1)).offer, null);
  assert.equal(
    rankRestockOffers(t, [
      more[0],
      { ...more[1], rows: [row("SMALL_00014", "721", 500)] },
    ]).complete,
    false,
  );
  assert.equal(
    rankRestockOffers(
      t,
      more.map((v) => ({ ...v, rows: [] })),
    ).offer,
    null,
  );
});
const sample = { barcode: " bce6 ‐ 1 ", phone: "010-0000-1234" },
  noon = new Date("2026-11-28T03:00:00Z");
const link = ownStoreLink("705"),
  optOut = "0800000000",
  parse = (extra) => parseRestock({ ...sample, ...extra }, noon);
test("ordinary request needs only the exact B-code and one mobile number", () => {
  assert.deepEqual(parse({}), {
    barcode: "BCE6-1",
    phone: "01000001234",
    details: blankRestock,
  });
  assert.throws(() => parse({ phone: "010-0000-1234;01000009999" }));
  assert.throws(() => parse({ barcode: "ps5" }));
  for (const name of ["컨트롤러 ps4", "컨트롤러 ps5", "보관함"]) {
    const text = composeRestock(parse({}).details, name, link, noon);
    assert.ok(text.includes("요청하신 상품이 입고되었습니다.\n" + name + "\n"));
  }
  assert.equal(
    storeProductNumber(
      "https://andy801.cafe24.com/product/게임패드/705/category/47/display/1/",
    ),
    "705",
  );
  assert.throws(() =>
    parse({
      storeUrl:
        "https://dosomesaurus.com.evil.example/product/detail.html?product_no=705",
    }),
  );
});
test("wholesale or retail can supply just a URL, just an item ID, or both", () => {
  const url = "https://domeggook.com/12345678";
  for (const [name, ref, no] of [
    ["도매꾹", url, ""],
    ["스마트스토어", "", "P-01234"],
    ["도매꾹", url, "012345"],
  ]) {
    const body = composeRestock(
      parse({ marketName: name, marketUrl: ref, marketItem: no }).details,
      "컨트롤러 PS5",
      link,
      noon,
    );
    for (const s of [name, ...[ref, no].filter(Boolean), link, "PS5"])
      assert.ok(body.includes(s));
    assert.doesNotMatch(body, /더 저렴|\(광고\)/);
  }
  assert.throws(() => parse({ marketItem: "0101" }));
  assert.throws(() => parse({ marketUrl: "javascript:alert(1)" }));
  assert.throws(() =>
    parse({ marketUrl: "https://private@mall.example/item/1" }),
  );
  assert.throws(() => parse({ body: "무조건 최저가입니다." }));
});
test("price comparison requires lower price, consent, recent check, opt-out and daytime in Korea", () => {
  const input = {
    promotion: true,
    ownPrice: 11000,
    marketPrice: 12000,
    marketName: "테스트몰",
    marketItem: "123",
  };
  const d = parse(input).details;
  const body = composeRestock(d, "상품", link, noon, optOut);
  assert.match(body, /^\(광고\)/);
  assert.match(body, /11,000원/);
  assert.match(body, /무료수신거부/);
  for (const [date, tel] of [
    [new Date(+noon + 25 * 3600000), optOut],
    [new Date("2026-11-28T13:00:00Z"), optOut],
    [noon, ""],
  ]) {
    const fallback = composeRestock(d, "상품", link, date, tel);
    assert.doesNotMatch(fallback, /11,000|광고/);
    assert.ok(fallback.includes("123"));
  }
  assert.throws(() => parse({ ...input, ownPrice: 12000 }));
  assert.ok(estimatedSmsBytes(body) > 90);
});
test("a lost submit response moves exclusively to history reconciliation", async () => {
  const log = [];
  let submits = 0;
  const call = async (e) => {
    log.push(e.action);
    return { claimed: true };
  };
  const g6 = async (_, handle) =>
    handle(120, async () => {
      submits++;
      throw Error("detached");
    });
  await assert.rejects(
    dispatchRestockJob(
      { kind: "prepare", id: "a" },
      call,
      async () => true,
      g6,
    ),
  );
  await dispatchRestockJob(
    { kind: "history", id: "a" },
    call,
    async () => assert.fail(),
    g6,
    async () => log.push("history"),
  );
  assert.deepEqual(log, ["claim", "history"]);
  assert.equal(submits, 1);
});

test("a logged-out G6 tab closes and releases its SMS lease before human login recovery", async () => {
  const events = [];
  const job = {
    kind: "operator_test",
    mode: "pilot",
    product: null,
    id: "pending-test",
  };
  const call = async ({ action, note }) => {
    events.push([action, note]);
  };
  const openG6 = async (_job, _submit, loginRequired) => {
    loginRequired();
    events.push("G6 closed");
    return false;
  };
  const recover = async (id, release) => {
    if (release) return true;
    events.push(["recover", id]);
    return false;
  };
  await dispatchRestockJob(
    job,
    call,
    () => assert.fail(),
    openG6,
    undefined,
    recover,
  );
  assert.deepEqual(events, [
    "G6 closed",
    ["defer", "SHOPLING"],
    ["recover", job.id],
  ]);
});

test("an active phone challenge keeps G6 closed and preserves an existing send attempt", async () => {
  for (const kind of ["operator_test", "history"]) {
    const events = [];
    const job = { kind, mode: "pilot", product: null, id: "waiting" };
    const recover = async (id, release) => {
      await release();
      events.push(["login", id]);
      return false;
    };
    await dispatchRestockJob(
      job,
      async (e) => events.push([e.action, e.note]),
      () => assert.fail(),
      () => assert.fail(),
      () => assert.fail(),
      recover,
    );
    assert.deepEqual(
      events,
      kind === "history"
        ? [["login", job.id]]
        : [
            ["defer", "SHOPLING"],
            ["login", job.id],
          ],
    );
  }
});
test("a sold-out option, canceled claim or lost claim response never clicks send", async () => {
  const calls = [],
    call = async (a) => {
      calls.push(a.action);
      return { claimed: false };
    };
  let clicks = 0;
  const g6 = async (_, handle) =>
    handle(120, async () => {
      clicks++;
    });
  await dispatchRestockJob({ kind: "prepare" }, call, async () => false, g6);
  await dispatchRestockJob({ kind: "prepare" }, call, async () => true, g6);
  await assert.rejects(
    dispatchRestockJob(
      { kind: "prepare" },
      async () => {
        throw Error("network");
      },
      async () => true,
      g6,
    ),
  );
  assert.deepEqual(calls, ["defer", "claim"]);
  assert.equal(clicks, 0);
});
test("a designated second phone gets one short operator test only in pilot, without a stock event", async () => {
  const bytes = estimatedSmsBytes(operatorTestMessage);
  assert.ok(bytes > 0 && bytes <= 90);
  const job = {
    id: "pilot",
    kind: "operator_test",
    mode: "pilot",
    product: null,
    sender: "01000000000",
    phone: "01000001234",
    body: operatorTestMessage,
  };
  const calls = [];
  let clicks = 0;
  let claimed = false;
  const claim = async (a) => {
    calls.push(a);
    if (a.action !== "claim" || claimed) return { claimed: false };
    claimed = true;
    return { claimed: true };
  };
  const g6 = (length) => async (j, handle) => {
    assert.equal(j.phone, "01000001234");
    return handle(
      length,
      async () => {
        clicks++;
      },
      1,
    );
  };
  const store = () => assert.fail("operator test attempted a product lookup");
  for (const mode of ["off", "live"])
    await dispatchRestockJob({ ...job, mode }, claim, store, g6(bytes));
  assert.equal(calls.length, 0);
  await dispatchRestockJob(job, claim, store, g6(91));
  assert.equal(calls[0].note, "LENGTH");
  await dispatchRestockJob(job, claim, store, g6(bytes));
  await dispatchRestockJob(job, claim, store, g6(bytes));
  assert.equal(calls[1].purchasable, false);
  assert.equal(calls[1].product, null);
  assert.equal(clicks, 1);
});
test("G6 history requires sender, phone, content, time and a single success", () => {
  const job = {
    at: "2026-11-28T03:00:00Z",
    sender: "01000000000",
    phone: "01000001234",
    body: "문의하신 상품\n상품번호 123",
  };
  const row = [
    "3",
    "2026-11-28 12:00:01",
    "010-0000-0000",
    "010-0000-1234",
    "문의하신 상품\n상품번호 123",
    "장문",
    "성공",
    "운영자",
  ];
  assert.equal(matchHistory([row], job).outcome, "MATCH");
  assert.equal(matchHistory([row, row], job).outcome, "AMBIGUOUS");
  for (const [i, value] of [
    [1, "2026-11-28 11:59:00"],
    [2, "01000000001"],
    [3, "01000000000"],
    [4, "다른 본문"],
    [6, "진행중"],
  ]) {
    const copy = [...row];
    copy[i] = value;
    assert.equal(matchHistory([copy], job).outcome, "MISSING");
  }
  assert.equal(
    matchHistory([[...row.slice(0, 6), "실패"]], job).outcome,
    "FAILED",
  );
});
