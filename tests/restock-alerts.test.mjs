import test from "node:test";
import assert from "node:assert/strict";
import {
  blankRestock,
  composeRestock,
  estimatedSmsBytes,
  ownStoreLink,
  parseRestock,
  storeProductNumber,
} from "../src/lib/restockAlertCore.ts";
import { dispatchRestockJob } from "../local-agent/mobile-work-center/restock-sms.mjs";
import { matchHistory } from "../local-agent/mobile-work-center/restock-browser.mjs";

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
