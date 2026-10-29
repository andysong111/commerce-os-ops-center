import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRoughStockCorrectionSearchParams,
  roughStockCorrectionHref,
} from "../src/lib/roughStockCorrectionTargets.ts";

test("purchase rough-stock correction keeps only safe unique B-codes", () => {
  const href = new URL(
    roughStockCorrectionHref([" bcc5-2 ", "BAE1-3", "BCC5-2", "<script>"]),
    "https://commerce-os.test",
  );

  assert.equal(href.pathname, "/china-order-manager/stock-control");
  assert.equal(href.searchParams.get("focus"), "rough-stock");
  assert.equal(href.searchParams.get("barcodes"), "BCC5-2,BAE1-3");
  assert.equal(href.searchParams.get("returnTo"), "/purchase-cycle-preflight");
});

test("focused correction parser rejects external return URLs", () => {
  assert.deepEqual(
    parseRoughStockCorrectionSearchParams({
      focus: "rough-stock",
      barcodes: "BCC5-2,BAE1-3",
      returnTo: "https://evil.example/steal",
    }),
    {
      barcodes: ["BCC5-2", "BAE1-3"],
      returnTo: "/purchase-cycle-preflight",
    },
  );

  assert.equal(
    parseRoughStockCorrectionSearchParams({
      focus: "rough-stock",
      barcodes: "BCC5-2",
      returnTo: "/\\evil.example/steal",
    }).returnTo,
    "/purchase-cycle-preflight",
  );
});

test("ordinary stock-control entry stays in the existing Shopling workflow", () => {
  assert.deepEqual(parseRoughStockCorrectionSearchParams({}), {
    barcodes: [],
    returnTo: null,
  });
});
