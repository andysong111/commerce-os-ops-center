import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import path from 'node:path';
const tools = createRequire(path.join(process.env.MONTHLY_PRICE_BROWSER_TOOLS || '/tmp/monthly-price-browser', 'package.json'));
const {build} = tools('esbuild'), {chromium} = tools('playwright');
const root = process.cwd(), draftId = 'fast-purchase-draft:0123456789abcdef0123';
const bundle = await build({stdin:{contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import {StockSyncHF15Bridge} from './src/components/china-order-manager/StockSyncHF15Bridge';
import {ReceiptOnSalePanel} from './src/components/china-order-manager/ReceiptOnSalePanel';
createRoot(document.querySelector('main')).render(<><StockSyncHF15Bridge/><ReceiptOnSalePanel draftId="${draftId}"/></>);
`,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.join(root,'src')}});
const server = createServer((req,res) => {
  if (req.url === '/ui.js') { res.setHeader('content-type','application/javascript');res.end(bundle.outputFiles[0].text); }
  else { res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><main></main><script src="/ui.js"></script>'); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch({headless:true,...(process.env.MONTHLY_PRICE_BROWSER_EXECUTABLE ? {executablePath:process.env.MONTHLY_PRICE_BROWSER_EXECUTABLE} : {})});
  const page = await browser.newPage();
  const rows = ['BBA1-1','BBA2-1','BBA3-1'].map((barcode,i) => ({barcode,quantity:5,jobId:'receipt-onsale:test:'+barcode,
    state:i===2?'HELD':'PENDING',canStart:i!==2,message:i===2?'현재 판매 가능 재고 없음':'판매중 덮어쓰기 전송 대기'}));
  const claims=[],finished=[],errors=[];
  page.on('pageerror',err=>{errors.push(String(err));console.error(err);});
  await page.route('**/api/china-order-manager/receipt-on-sale*', async route => {
    const req=route.request(),data=req.method()==='POST'?req.postDataJSON():null;
    assert.equal(data ? data.draftId : new URL(req.url()).searchParams.get('draftId'),draftId);
    let body={ok:true,rows};
    if(data?.action==='claim'){
      const r=rows.find(r=>r.jobId===data.jobId);assert.equal(r.state,'PENDING');r.state='STARTED';r.canStart=false;claims.push(r.barcode);
      body={ok:true,job:{jobId:r.jobId,barcode:r.barcode,desiredStatus:'ON_SALE',stockBatchPlan:'signed'}};
    }
    if(data?.action==='finish'){
      const r=rows.find(r=>r.jobId===data.jobId);assert.equal(r.state,'STARTED');finished.push(r.barcode);
      r.state='ACCEPTED';r.message='Shopling 전송 접수 확인';body={ok:true,outcome:'SUCCEEDED'};
    }
    await route.fulfill({json:body});
  });
  await page.addInitScript(() => {
    const base='COMMERCE_OS_SHOPLING_STOCK_SYNC_';
    window.posted=[];
    window.addEventListener('message',event=>{
      const d=event.data;
      const post=msg=>window.postMessage({...msg,extensionVersion:'0.6.62'},location.origin);
      if(d?.type===base+'EXTENSION_PING_HF27'){
        post({type:base+'EXTENSION_READY_HF27'});
        post({type:base+'STATUS_HF27',statusProbeOk:true,idleConfirmed:true,active:null});
      }
      if(d?.type===base+'SESSION_PREFLIGHT_REQUEST')post({type:base+'SESSION_PREFLIGHT_RESULT',requestId:d.requestId,ok:true,authenticated:true});
      if(d?.type===base+'START_HF27'){
        window.posted.push(d.job.barcode);
        post({type:base+'RESULT_HF27',jobId:d.job.jobId,job:d.job,finishedAt:Date.now(),outcome:'SUCCEEDED',evidence:{stockPlanComplete:true}});
      }
    });
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByText('B코드별 결과와 보류 사유').click();
  await page.getByText('현재 판매 가능 재고 없음',{exact:false}).waitFor();
  await page.getByRole('button',{name:'판매중 전송 이어가기'}).click();
  await page.getByText('접수 완료 2건 · 보류 1건',{exact:false}).first().waitFor();
  assert.deepEqual(claims,['BBA1-1','BBA2-1']);assert.deepEqual(finished,claims);
  assert.deepEqual(await page.evaluate(()=>window.posted),claims);
  await page.reload();await page.getByText('접수 완료 2건 · 보류 1건',{exact:false}).first().waitFor();
  assert.deepEqual(await page.evaluate(()=>window.posted),[]);assert.deepEqual(errors,[]);
  console.log('PASS · already-on-sale overwrite, serial dispatch, hold reasons, reload without resend · zero production writes');
} finally { await browser?.close();server.close(); }
