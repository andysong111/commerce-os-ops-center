import assert from "node:assert/strict";
import test from "node:test";
import {
  combineFreightApplications,
  parseFreightApplicationNumberList,
} from "../src/lib/freightApplicationBatch.ts";
import { parseFreightApplicationBatchText } from "../src/lib/freightApplicationParser.ts";

function application(applicationNo, rowNo = 1) {
  return {
    applicationNo,
    items: [{ id: `old-${applicationNo}-${rowNo}`, rowNo, itemName: `상품 ${applicationNo}`, optionText: "옵션", quantity: 10 }],
  };
}

test("comma-separated application numbers are normalized and deduplicated", () => {
  assert.deepEqual(
    parseFreightApplicationNumberList("673626, 673627，673626\n673628"),
    ["673626", "673627", "673628"],
  );
  assert.throws(() => parseFreightApplicationNumberList("673626, abc"), /숫자 4~20자리/);
});

test("combined applications preserve application identity even when row numbers overlap", () => {
  const combined = combineFreightApplications([application("673626"), application("673627")]);
  assert.equal(combined.applicationNo, "673626, 673627");
  assert.deepEqual(combined.applicationNos, ["673626", "673627"]);
  assert.deepEqual(combined.items.map((item) => [item.applicationNo, item.rowNo]), [["673626", 1], ["673627", 1]]);
  assert.notEqual(combined.items[0].id, combined.items[1].id);
});

test("manual pasted text with multiple applications is parsed as one grouped work set", () => {
  const parsed = parseFreightApplicationBatchText(`신청번호:673626
제품정보:(1)
품목: Tape Measure
옵션(색상,사이즈): 1M
수량: 15

신청번호:673627
제품정보:(1)
품목: Storage Box
옵션(색상,사이즈): White
수량: 4`);
  assert.equal(parsed.applicationNo, "673626, 673627");
  assert.equal(parsed.diagnostics?.parserMode, "batch");
  assert.deepEqual(parsed.items.map((item) => [item.applicationNo, item.rowNo, item.quantity]), [["673626", 1, 15], ["673627", 1, 4]]);
});
