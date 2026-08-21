import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("샵플링 카테고리 저장은 GitHub 쓰기 대신 Supabase 시스템 행을 사용한다", async () => {
  const store = await readFile(
    new URL("../src/lib/shoplingCategorySupabaseStore.ts", import.meta.url),
    "utf8",
  );
  const publisher = await readFile(
    new URL("../src/lib/shoplingCategoryLocalPublish.ts", import.meta.url),
    "utf8",
  );
  const catalog = await readFile(
    new URL("../src/lib/shoplingCategoryCatalog.ts", import.meta.url),
    "utf8",
  );
  assert.match(store, /product_launch_tracker_states/);
  assert.match(store, /shopling_category_catalog/);
  assert.match(store, /7fcb0ac2-cc25-4f0a-a2d9-6f94fbdb7b91/);
  assert.match(store, /resolution=merge-duplicates/);
  assert.match(store, /7fcb0ac2-cc25-4f0a-a2d9-6f94fbdb7b91/);
  assert.match(publisher, /writeShoplingCategoryCatalogToSupabase/);
  assert.doesNotMatch(publisher, /git\/blobs/);
  assert.match(catalog, /readShoplingCategoryCatalogFromSupabase/);
});

test("기존 GitHub 스냅샷은 읽기 호환 fallback으로만 유지한다", async () => {
  const catalog = await readFile(
    new URL("../src/lib/shoplingCategoryCatalog.ts", import.meta.url),
    "utf8",
  );
  assert.match(catalog, /readGithubContent/);
  assert.match(catalog, /supabaseCatalog/);
  assert.match(catalog, /fallback/);
});
