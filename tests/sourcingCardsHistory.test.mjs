import assert from "node:assert/strict";
import test from "node:test";

import { SOURCING_CARD_STORAGE_KEY } from "../src/lib/sourcingCardStorage.ts";
import { deleteCardFromLocalStorage, removeCardById } from "../src/lib/sourcingCardsHistory.ts";

test("server card with serverId can be removed from UI state after deletion", () => {
  const cards = [
    { id: "card-1", serverId: "11111111-1111-4111-8111-111111111111" },
    { id: "card-2", serverId: "22222222-2222-4222-8222-222222222222" },
  ];

  assert.deepEqual(removeCardById(cards, "card-1"), [cards[1]]);
});

test("local fallback card can be removed from localStorage", () => {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  data.set(SOURCING_CARD_STORAGE_KEY, JSON.stringify([{ id: "local-1" }, { id: "local-2" }]));

  const next = deleteCardFromLocalStorage("local-1", storage);

  assert.deepEqual(next, [{ id: "local-2" }]);
  assert.equal(data.get(SOURCING_CARD_STORAGE_KEY), JSON.stringify([{ id: "local-2" }]));
});
