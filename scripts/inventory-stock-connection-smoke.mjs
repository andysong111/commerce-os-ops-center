// Explicit operator-run verification. GET only: never POST stock facts or send
// Shopling sale-state changes. Evidence refresh is a separate opt-in input.
import assert from 'node:assert/strict';
const origin = 'https://commerce-os-ops-center.vercel.app';
async function read(path) {
  const started = Date.now();
  const response = await fetch(origin + path, {
    headers: { Accept: 'application/json', Origin: origin, Referer: origin + '/china-order-manager/stock-control' },
    signal: AbortSignal.timeout(90_000), redirect: 'error',
  });
  const payload = await response.json().catch(() => ({}));
  const row = payload.report?.rows?.find((item) => item.barcode === 'BAB3-1');
  console.log(JSON.stringify({path,status:response.status,durationMs:Date.now()-started,
    ok:payload.ok,state:payload.report?.state,code:payload.code,requestId:payload.requestId,
    rowCount:payload.report?.rows?.length,jobs:payload.jobs?.length,
    tailRefreshed:payload.tailSalesRefresh?.refreshed,
    target:row ? {barcode:row.barcode,resetAt:row.resetAt,quantity:row.exactInventoryQuantity,
      salesCoverageReady:row.salesCoverageReady,syncNeeded:row.syncNeeded,syncBlocked:row.syncBlocked,
      syncBlockReason:row.syncBlockReason} : null}));
  assert.equal(response.status,200,'Inventory HTTP response is not healthy');
  assert.equal(payload.ok,true,'Inventory response is not successful');
  assert.equal(payload.report?.state,'READY','Inventory ledger is blocked');
  assert.ok(row,'Expected existing BAB3-1 baseline is missing');
  return payload;
}
if (process.env.REFRESH_EVIDENCE === 'true') await read('/api/inventory-stock-control');
for (let index=0; index<3; index++) {
  if(index) await new Promise((resolve)=>setTimeout(resolve,5000));
  await read('/api/inventory-stock-control/sync');
}
console.log('INVENTORY_CONNECTION_SMOKE_PASSED; no stock/status POST performed');
