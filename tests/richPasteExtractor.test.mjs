import assert from "node:assert/strict";
import test from "node:test";
import {
  assignPastedImagesToItems,
  createClipboardImageCandidates,
  extractImageUrlsFromHtml,
  extractRichPasteImagesFromHtml,
  getFreightItemImageSources,
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

test("extracts alicdn product images from src, data-src, and srcset", () => {
  const html = `
    <img src="https://cbu01.alicdn.com/red.jpg">
    <img src="data:image/gif;base64,placeholder" data-src="//cbu01.alicdn.com/blue.jpg">
    <img srcset="https://img.alicdn.com/green-small.jpg 1x, https://img.alicdn.com/green-large.jpg 2x">
  `;

  assert.deepEqual(extractImageUrlsFromHtml(html), [
    "https://cbu01.alicdn.com/red.jpg",
    "https://cbu01.alicdn.com/blue.jpg",
    "https://img.alicdn.com/green-small.jpg",
  ]);
});

test("normalizes protocol-relative cbu01.alicdn.com image URLs", () => {
  assert.equal(
    normalizePastedImageUrl("//cbu01.alicdn.com/img/option.jpg"),
    "https://cbu01.alicdn.com/img/option.jpg",
  );
});

test("ignores base64 data image URLs", () => {
  assert.equal(normalizePastedImageUrl("data:image/png;base64,AAAA"), undefined);
  const extraction = extractRichPasteImagesFromHtml(
    '<img src="data:image/png;base64,AAAA">',
  );
  assert.equal(extraction.totalImages, 1);
  assert.equal(extraction.ignoredImages, 1);
  assert.deepEqual(extraction.candidates, []);
});

test("ignores a China flag and icon while retaining the product image", () => {
  const extraction = extractRichPasteImagesFromHtml(`
    <header>
      <img src="https://assets.example.com/country/china-flag.png" width="64" height="40" alt="China flag">
      <img src="https://assets.example.com/tracking-icon.svg" width="48" height="48">
    </header>
    <section>제품정보:(1)
      <img src="https://cbu01.alicdn.com/product/red-option.jpg" width="300" height="300" alt="红色 option">
    </section>
  `);

  assert.equal(extraction.totalImages, 3);
  assert.equal(extraction.ignoredImages, 2);
  assert.deepEqual(
    extraction.candidates.map((candidate) => candidate.url),
    ["https://cbu01.alicdn.com/product/red-option.jpg"],
  );
});

test("ignores images smaller than 40x40 when dimensions are present", () => {
  const extraction = extractRichPasteImagesFromHtml(`
    <img src="https://cbu01.alicdn.com/tiny.jpg" width="39" height="39">
    <img src="https://cbu01.alicdn.com/wide-but-short.jpg" width="100" height="20">
    <img src="https://cbu01.alicdn.com/product.jpg" width="60" height="60">
  `);

  assert.deepEqual(
    extraction.candidates.map((candidate) => candidate.url),
    ["https://cbu01.alicdn.com/product.jpg"],
  );
  assert.equal(extraction.ignoredImages, 2);
});

test("assigns the best product image from each product block", () => {
  const extraction = extractRichPasteImagesFromHtml(`
    <img src="https://assets.example.com/header-photo.jpg" width="100" height="100">
    <div>제품정보:(1)
      <img src="https://example.com/red-thumbnail.jpg" width="50" height="50">
      <img src="https://cbu01.alicdn.com/red-large.jpg" width="300" height="300" alt="Red option">
    </div>
    <div>제품정보:(2)
      <img src="https://cbu01.alicdn.com/blue-large.jpg" width="300" height="300" alt="Blue option">
    </div>
  `);
  const assigned = assignPastedImagesToItems(baseItems, extraction);

  assert.equal(
    assigned[0].pastedImageUrl,
    "https://cbu01.alicdn.com/red-large.jpg",
  );
  assert.equal(
    assigned[1].pastedImageUrl,
    "https://cbu01.alicdn.com/blue-large.jpg",
  );
});

test("fallback assignment uses filtered candidates only", () => {
  const extraction = extractRichPasteImagesFromHtml(`
    <img src="https://assets.example.com/china-flag.png" alt="country flag">
    <img src="data:image/png;base64,AAAA">
    <div>제품정보:(1)
      <img src="https://cbu01.alicdn.com/red.jpg" width="100" height="100">
      <img src="https://cbu01.alicdn.com/blue.jpg" width="100" height="100">
    </div>
  `);
  const assigned = assignPastedImagesToItems(baseItems, extraction);

  assert.equal(assigned[0].pastedImageUrl, "https://cbu01.alicdn.com/red.jpg");
  assert.equal(assigned[1].pastedImageUrl, "https://cbu01.alicdn.com/blue.jpg");
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

test("prioritizes a local image before selected, manual, pasted, and Product Master images", () => {
  const item = {
    ...baseItems[0],
    localImageUrl: "blob:https://commerce-os.local/local-image",
    selectedImageCandidateUrl: "https://selected.example/image.jpg",
    imageUrl: "https://manual.example/image.jpg",
    pastedImageUrl: "https://pasted.example/image.jpg",
    matchedImageUrl: "https://master.example/image.jpg",
  };

  assert.deepEqual(getFreightItemImageSources(item), [
    item.localImageUrl,
    item.selectedImageCandidateUrl,
    item.imageUrl,
    item.pastedImageUrl,
    item.matchedImageUrl,
  ]);
  assert.equal(getPreferredFreightItemImage(item), item.localImageUrl);
  assert.deepEqual(
    getFreightItemImageSources({ ...item, localImageUrl: undefined }),
    [item.selectedImageCandidateUrl, item.imageUrl, item.pastedImageUrl, item.matchedImageUrl],
  );
  assert.deepEqual(
    getFreightItemImageSources({ ...item, localImageUrl: undefined, selectedImageCandidateUrl: undefined }),
    [item.imageUrl, item.pastedImageUrl, item.matchedImageUrl],
  );
  assert.deepEqual(
    getFreightItemImageSources({ ...item, localImageUrl: undefined, selectedImageCandidateUrl: undefined, imageUrl: undefined }),
    [item.pastedImageUrl, item.matchedImageUrl],
  );
  assert.deepEqual(
    getFreightItemImageSources({ ...item, localImageUrl: undefined, selectedImageCandidateUrl: undefined, imageUrl: undefined, pastedImageUrl: undefined }),
    [item.matchedImageUrl],
  );
  assert.deepEqual(
    getFreightItemImageSources({ ...item, localImageUrl: undefined, selectedImageCandidateUrl: undefined, imageUrl: undefined, pastedImageUrl: undefined, matchedImageUrl: undefined }),
    [],
  );
});

test("does not auto-assign image candidates marked as failed", () => {
  const extraction = extractRichPasteImagesFromHtml(`
    <div>제품정보:(1)
      <img src="https://cbu01.alicdn.com/failed.jpg" width="100" height="100">
    </div>
  `);
  extraction.candidates[0].loadStatus = "failed";

  const assigned = assignPastedImagesToItems([baseItems[0]], extraction);
  assert.equal(assigned[0].pastedImageUrl, undefined);
});

test("accepts browser-local clipboard image object URLs", () => {
  const candidates = createClipboardImageCandidates([
    { url: "blob:https://commerce-os.local/image-1", type: "image/png", name: "clipboard.png" },
    { url: "blob:https://commerce-os.local/text-1", type: "text/plain", name: "not-image.txt" },
    { url: "https://example.com/image.jpg", type: "image/jpeg", name: "remote.jpg" },
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "blob:https://commerce-os.local/image-1");
  assert.equal(candidates[0].sourceType, "clipboard-file");
});
