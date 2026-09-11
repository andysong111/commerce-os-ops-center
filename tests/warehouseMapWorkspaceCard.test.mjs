import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspaceUrl = new URL("../src/lib/opsWorkspace.ts", import.meta.url);
const registryUrl = new URL("../src/lib/opsModuleRegistry.ts", import.meta.url);

test("warehouse inbound workspace exposes the physical warehouse map as a separate card", async () => {
  const [workspace, registry] = await Promise.all([
    readFile(workspaceUrl, "utf8"),
    readFile(registryUrl, "utf8"),
  ]);

  const warehouseGroup = workspace.match(/id: "warehouse-inbound"[\s\S]*?searchTerms:/)?.[0] ?? "";
  assert.match(warehouseGroup, /"warehouse-capacity"/);
  assert.match(warehouseGroup, /"warehouse-location-sync"/);
  assert.match(registry, /id: "warehouse-capacity"/);
  assert.match(registry, /title: "창고 지도·위치코드 관리"/);
  assert.match(
    registry,
    /route: "https:\/\/storage-organization\.vercel\.app\/warehouse-map\/index\.html"/,
  );
});

test("warehouse natural-language intent prefers the physical map without removing legacy warehouse tools", async () => {
  const workspace = await readFile(workspaceUrl, "utf8");
  const warehouseIntent = workspace.match(/label: "창고 작업"[\s\S]*?patterns:/)?.[0] ?? "";
  assert.match(warehouseIntent, /"warehouse-capacity"/);
  assert.match(warehouseIntent, /"warehouse-location-sync"/);
  assert.match(warehouseIntent, /"warehouse-label-generator"/);
  assert.match(warehouseIntent, /"shopling-option-barcode-sync"/);
});
