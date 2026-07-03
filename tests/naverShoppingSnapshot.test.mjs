import test from "node:test";
import assert from "node:assert/strict";
import { buildNaverShoppingSnapshot } from "../src/lib/naverShoppingSnapshot.ts";

test("builds compact Naver shopping snapshot", () => {
  const snapshot = buildNaverShoppingSnapshot({
    keyword: "car storage",
    total: 1234,
    items: [
      {
        title: "<b>car</b> gap storage",
        link: "https://example.com/1",
        image: "https://example.com/1.jpg",
        lprice: "9900",
        mallName: "Mall A",
        brand: "",
        category1: "Auto",
        category2: "Storage",
      },
      {
        title: "seat storage box",
        link: "https://example.com/2",
        image: "https://example.com/2.jpg",
        lprice: "12900",
        mallName: "Mall B",
        brand: "",
        category1: "Auto",
        category2: "Storage",
      },
      {
        title: "car organizer",
        link: "https://example.com/3",
        image: "https://example.com/3.jpg",
        lprice: "15900",
        mallName: "Mall A",
        brand: "",
        category1: "Auto",
        category2: "Storage",
      },
    ],
  });

  assert.equal(snapshot.keyword, "car storage");
  assert.equal(snapshot.displayCount, 3);
  assert.equal(snapshot.priceMinKrw, 9900);
  assert.equal(snapshot.priceMedianKrw, 12900);
  assert.equal(snapshot.priceMaxKrw, 15900);
  assert.equal(snapshot.topMalls[0].name, "Mall A");
  assert.equal(snapshot.items[0].title, "car gap storage");
  assert.ok(snapshot.notes.length >= 1);
});
