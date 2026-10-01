import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { internalChinaOrderEvidenceIssues } from "../src/lib/internalChinaOrderEvidence.ts";

const complete = {
  barcode: "BAC1-1",
  unitPriceCny: 3.25,
  supplierLink: "https://detail.1688.com/offer/123.html",
  chinaOption: "灰色",
  orderNumber: "1688-order-123",
};

test("ORDERED evidence requires current price, valid link, exact China option and order number", () => {
  assert.deepEqual(internalChinaOrderEvidenceIssues([complete]), []);
  assert.deepEqual(
    internalChinaOrderEvidenceIssues([
      {
        ...complete,
        unitPriceCny: 0,
        supplierLink: "javascript:alert(1)",
        chinaOption: " ",
        orderNumber: "",
      },
    ]),
    [
      "BAC1-1 위안단가",
      "BAC1-1 모델 1번 1688 링크",
      "BAC1-1 중국옵션",
      "BAC1-1 1688 주문번호",
    ],
  );
});

test("malformed prices and links cannot become order evidence", () => {
  for (const unitPriceCny of [NaN, Infinity, -1, "not-a-price"]) {
    assert.match(
      internalChinaOrderEvidenceIssues([{ ...complete, unitPriceCny }]).join(","),
      /위안단가/,
    );
  }
  for (const supplierLink of ["", "//detail.1688.com/offer/123", "ftp://example.com/a"]) {
    assert.match(
      internalChinaOrderEvidenceIssues([{ ...complete, supplierLink }]).join(","),
      /1688 링크/,
    );
  }
});

test("server and both order workspaces share the same evidence validator", async () => {
  const [server, workspace, workspaceV2] = await Promise.all([
    readFile("src/lib/internalChinaPurchaseDraft.ts", "utf8"),
    readFile("src/components/china-order-manager/InternalChinaPurchaseDraftWorkspace.tsx", "utf8"),
    readFile("src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx", "utf8"),
  ]);
  for (const source of [server, workspace, workspaceV2]) {
    assert.match(source, /internalChinaOrderEvidenceIssues/);
  }
  assert.doesNotMatch(server, /function blockingOrderIssues/);
});
