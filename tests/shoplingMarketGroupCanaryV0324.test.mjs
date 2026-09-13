import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0324/download/route.ts", import.meta.url);
const listRoute = new URL("../src/app/api/shopling-market-group-canary/selection/list/route.ts", import.meta.url);

test("v0.3.24 exposes upload-date filtering and batch identity", async () => {
  const [pkg, list] = await Promise.all([
    readFile(packageRoute, "utf8"),
    readFile(listRoute, "utf8"),
  ]);

  for (const needle of [
    'const VERSION = "0.3.24"',
    'id="uploadDate"',
    'id="dateSearch"',
    'function batchLabel(item)',
    'params.set("from", start.toISOString())',
    'params.set("to", end.toISOString())',
    '동일 B코드는 업로드 배치ID/시간으로 구분',
  ]) {
    assert.equal(pkg.includes(needle), true, `missing package marker: ${needle}`);
  }

  for (const needle of [
    'const rawFrom = text(url.searchParams.get("from"))',
    'const rawTo = text(url.searchParams.get("to"))',
    'batchIdShort: jobId.slice(0, 8)',
    'isLatestBatch,',
    'batchState: isLatestBatch ? "latest" : "superseded"',
    'const selectable = isLatestBatch',
    'const DATE_FILTER_LIMIT = 1000',
    '.slice(0, dateFiltered ? DATE_FILTER_LIMIT : 50)',
  ]) {
    assert.equal(list.includes(needle), true, `missing list marker: ${needle}`);
  }

  assert.equal(list.includes('const latestByLaunch = new Map<string, Record<string, unknown>>()'), false);
});
