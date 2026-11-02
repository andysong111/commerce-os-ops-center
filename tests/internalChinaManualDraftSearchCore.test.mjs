import assert from "node:assert/strict";
import test from "node:test";

import {
  MANUAL_DRAFT_SEARCH_TERM_LIMIT,
  bestManualDraftSearchMatch,
  parseManualDraftSearchTerms,
} from "../src/lib/internalChinaManualDraftSearchCore.ts";

test("manual Draft search parses comma, full-width comma, semicolon and newline terms", () => {
  assert.deepEqual(
    parseManualDraftSearchTerms(
      "BBA2-2, AAA092， 토끼브로치; 단품 그레이\nBBA2-2\tA",
    ),
    ["BBA2-2", "AAA092", "토끼브로치", "단품 그레이"],
  );
});

test("manual Draft search caps unique terms without silently duplicating case variants", () => {
  const input = ["BBA2-2", "bba2-2", ...Array.from({ length: 80 }, (_, index) => `상품${index}`)].join(",");
  const terms = parseManualDraftSearchTerms(input);
  assert.equal(terms.length, MANUAL_DRAFT_SEARCH_TERM_LIMIT);
  assert.equal(terms[0], "BBA2-2");
  assert.equal(terms.filter((term) => term.toLowerCase() === "bba2-2").length, 1);
});

test("manual Draft search matches B-code, model number, product name and option name", () => {
  const candidate = {
    barcode: "BBA2-2",
    modelNo: "AAA092",
    productName: "토끼브로치",
    optionName: "단품 그레이",
  };

  assert.deepEqual(bestManualDraftSearchMatch(candidate, ["BBA2-2"]), {
    termIndex: 0,
    score: 0,
  });
  assert.deepEqual(bestManualDraftSearchMatch(candidate, ["AAA092"]), {
    termIndex: 0,
    score: 1,
  });
  assert.ok(bestManualDraftSearchMatch(candidate, ["토끼"]).score < 100);
  assert.ok(bestManualDraftSearchMatch(candidate, ["그레이"]).score < 100);
  assert.equal(bestManualDraftSearchMatch(candidate, ["없는상품"]).score, 100);
});
