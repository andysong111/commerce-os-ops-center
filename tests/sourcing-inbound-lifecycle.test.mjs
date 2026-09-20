import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
const source=p=>readFile(new URL(p,import.meta.url),'utf8');
test('warehouse and launch activation occur only after the durable China receipt write',async()=>{
 const r=await source('../src/lib/internalChinaReceipt.ts');
 assert.doesNotMatch(r,/confirmSourcingWarehouseReceipt\(/);
 assert.doesNotMatch(r,/materializeSourcingLaunchItem\(/);
 assert.ok(r.indexOf('const followup = await retryInternalChinaReceiptFollowup(receiptId)')>r.indexOf('if (!response.ok) throw new Error(`CHINA_RECEIPT_STORE_FAILED:'));
 assert.match(r,/sourcing,/);
 assert.match(r,/SOURCING_RECEIPT_ORDER_EVIDENCE_REQUIRED/);
});
test('recovery re-reads persisted receipts, repairs launch before costs, and never adds receipt quantity',async()=>{
 const f=await source('../src/lib/internalChinaReceiptFollowup.ts');
 const start=f.indexOf('export async function retryInternalChinaReceiptFollowup');
 const code=f.slice(start);
 assert.ok(code.indexOf('await storedRows(receiptId)')<code.indexOf('await ensureSourcingReceiptArtifacts(receiptId, rows)'));
 assert.ok(code.indexOf('await ensureSourcingReceiptArtifacts(receiptId, rows)')<code.indexOf('await verifyRows'));
 assert.doesNotMatch(code,/recordInternalChinaReceipt\(/);
});
test('launch writes use compare-and-swap and repair normalized rows after a lost response',async()=>{
 const f=await source('../src/lib/sourcingLaunchMaterialization.ts');
 assert.match(f,/updated_at:`eq\.\$\{sourceUpdatedAt\}`/);
 assert.match(f,/if \(!rows\.length\) continue/);
 assert.match(f,/SOURCING_LAUNCH_STATE_UNAVAILABLE/);
 assert.match(f,/if \(!normalized\)/);
 assert.match(f,/syncProductLaunchNormalizedChangedItems/);
 assert.doesNotMatch(f,/syncProductLaunchNormalizedFull/);
 assert.match(f,/ensure_product_launch_item_option_barcode_nos/);
 assert.match(f,/const canonicalItem = normalized \|\| existing/);
});
