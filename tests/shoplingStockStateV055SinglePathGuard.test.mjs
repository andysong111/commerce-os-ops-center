import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("v0.5.5 leaves single A4 -> A21 route intact", async () => {
  const background = await readFile("public/shopling-stock-state-sync/background-v020.js", "utf8");
  assert.match(background, /\["A4", "A21_LIST"\]/);
});
