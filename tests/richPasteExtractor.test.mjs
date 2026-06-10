import assert from "node:assert/strict";
import test from "node:test";
import {
  assignPastedImagesToItems,
  extractImageUrlsFromHtml,
  getPreferredFreightItemImage,
  normalizePastedImageUrl,
} from "../src/lib/richPasteExtractor.ts";

const baseItems = [
  {
    id: "item-1",
    rowNo: 1,
    itemName: "Red option",
    optionText: "颜色: 红色",
    quantity: 10,
  },
  {
    id: "item-2",
    rowNo: 2,
    itemName: "Blue option",
    optionText: "颜色: 蓝色",
    quantity: 20,
  },
];

test("extracts src, data-src, and the first srcset URL from HTML img tags", () => {
  const html = `
    <img src="https://cbu01.alicdn.com/red.jpg">
    <img src="data:image/gif;base64,placeholder" data-src="//cbu01.alicdn.com/blue.jpg">
    <img srcset="https://cbu01.alicdn.com/green-small.jpg 1x, https://cbu01.alicdn.com/green-large.jpg 2x">
  `;

  assert.deepEqual(extractImageUrlsFromHtml(html), [
    "https://cbu01.alicdn.com/red.jpg",
    "https://cbu01.alicdn.com/blue.jpg",
    "https://cbu01.alicdn.com/green-small.jpg",
  ]);
});

test("normalizes protocol-relative image URLs", () => {
  assert.equal(
    normalizePastedImageUrl("//cbu01.alicdn.com/img/option.jpg"),
    "https://cbu01.alicdn.com/img/option.jpg",
  );
});

test("ignores base64 data image URLs", () => {
  assert.equal(normalizePastedImageUrl("data:image/png;base64,AAAA"), undefined);
  assert.deepEqual(
    extractImageUrlsFromHtml('<img src="data:image/png;base64,AAAA">'),
    [],
  );
});

test("assigns available pasted images to parsed items in order", () => {
  const assigned = assignPastedImagesToItems(baseItems, [
    "https://example.com/red.jpg",
    "https://example.com/blue.jpg",
    "https://example.com/unused.jpg",
  ]);

  assert.equal(assigned[0].pastedImageUrl, "https://example.com/red.jpg");
  assert.equal(assigned[1].pastedImageUrl, "https://example.com/blue.jpg");
});

test("leaves unmatched items empty and preserves a manually entered imageUrl", () => {
  const items = [
    { ...baseItems[0], imageUrl: "https://manual.example/red.jpg" },
    baseItems[1],
  ];
  const assigned = assignPastedImagesToItems(items, [
    "https://pasted.example/red.jpg",
  ]);

  assert.equal(assigned[0].imageUrl, "https://manual.example/red.jpg");
  assert.equal(assigned[0].pastedImageUrl, "https://pasted.example/red.jpg");
  assert.equal(assigned[1].pastedImageUrl, undefined);
});

test("prefers pasted, then manual, then Product Master images", () => {
  const item = {
    ...baseItems[0],
    pastedImageUrl: "https://pasted.example/image.jpg",
    imageUrl: "https://manual.example/image.jpg",
    matchedImageUrl: "https://master.example/image.jpg",
  };

  assert.equal(getPreferredFreightItemImage(item), item.pastedImageUrl);
  assert.equal(
    getPreferredFreightItemImage({ ...item, pastedImageUrl: undefined }),
    item.imageUrl,
  );
  assert.equal(
    getPreferredFreightItemImage({
      ...item,
      pastedImageUrl: undefined,
      imageUrl: undefined,
    }),
    item.matchedImageUrl,
  );
});
