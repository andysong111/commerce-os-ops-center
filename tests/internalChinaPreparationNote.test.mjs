import assert from "node:assert/strict";
import test from "node:test";

import {
  activePreparationNote,
  removeResolvedPreparationNote,
} from "../src/lib/internalChinaPreparationNote.ts";

test("filled Chinese option resolves a stale missing-option warning and removes only that system note", () => {
  const line = {
    chinaOption: "冷茶,40*40cm(冰丝)",
    supplierLink: "https://detail.1688.com/offer/770187886353.html",
    note: "사용자 메모 · [1688 준비 제외] 중국 옵션 없음",
  };
  assert.equal(activePreparationNote(line), "");
  assert.equal(removeResolvedPreparationNote(line), "사용자 메모");
});

test("comma-separated color and size remains a valid Chinese option", () => {
  const line = {
    chinaOption: "冷茶,30*30cm(冰丝)",
    supplierLink: "https://detail.1688.com/offer/770187886353.html",
    note: "[1688 준비 제외] 중국 옵션 없음",
  };
  assert.equal(activePreparationNote(line), "");
  assert.equal(removeResolvedPreparationNote(line), "");
});

test("unresolved and offer-offline warnings remain visible", () => {
  assert.equal(activePreparationNote({ chinaOption: "", note: "[1688 준비 제외] 중국 옵션 없음" }), "중국 옵션 없음");
  assert.equal(activePreparationNote({ supplierLink: "", note: "[1688 준비 제외] 1688 링크 없음" }), "1688 링크 없음");
  assert.equal(activePreparationNote({ chinaOption: "黑色", supplierLink: "https://detail.1688.com/offer/1.html", note: "[1688 준비 제외] 1688 상품 판매중단" }), "1688 상품 판매중단");
});

