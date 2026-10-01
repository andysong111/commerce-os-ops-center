import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientTimestampFiles = [
  "src/components/china-order-manager/InternalChinaMonthlyClosePanel.tsx",
  "src/components/china-order-manager/InternalChinaReceiptPanel.tsx",
];

test("monthly cycle timestamps use a deterministic Seoul timezone during hydration", async () => {
  for (const file of clientTimestampFiles) {
    const source = await readFile(file, "utf8");
    assert.match(source, /toLocaleString\("ko-KR",\s*{\s*timeZone: "Asia\/Seoul",\s*}\)/);
    assert.doesNotMatch(source, /new Date\([^)]*\)\.toLocaleString\("ko-KR"\)/);
  }
});
