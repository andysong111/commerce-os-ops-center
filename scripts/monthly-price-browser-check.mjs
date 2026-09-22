import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import path from 'node:path';
const tools=createRequire(path.join(process.env.MONTHLY_PRICE_BROWSER_TOOLS||'/tmp/monthly-price-browser','package.json'));
const {build}=tools('esbuild'),{chromium}=tools('playwright');
const root=process.cwd(), out=path.join(root,'output/monthly-price');mkdirSync(out,{recursive:true});
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MonthlyPricePanel}from'./src/components/china-order-manager/MonthlyPricePanel';createRoot(document.getElementById('root')).render(<MonthlyPricePanel month="2026-09" ready={new URLSearchParams(location.search).get('ready')!=='0'}/>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.join(root,'src')}});
const runId='11111111-1111-4111-8111-111111111111',itemId='22222222-2222-4222-8222-222222222222',token='44444444-4444-4444-8444-444444444444',fingerprint='a'.repeat(64);
let scenario='happy',events=[],started=false;
function makeItem(){return{id:itemId,goodsKey:'1234567',state:scenario==='blocked'?'BLOCKED':scenario==='resume'?'RESENDING':'QUEUED',candidate:{productName:'테스트 상품 A',productGroup:'도매1',options:[{barcode:'ABC1-1',optionId:'1',productName:'테스트 상품 A',protectedCostKrw:500,currentCostKrw:500,unitsPerOrder:1},{barcode:'ABC1-2',optionId:'2',productName:'테스트 상품 B',protectedCostKrw:700,currentCostKrw:700,unitsPerOrder:1}],reason:scenario==='blocked'?'MONTHLY_PRICE_CONFIRMED_COST_REQUIRED':null},plan:{fingerprint,productGroup:'도매1',targets:[{mallKey:null,before:{sellPrice:1000},target:{sellPrice:1200},options:[{optionId:'1',barcode:'ABC1-1',optionValue:'화이트',beforeFinalSellPrice:1000,targetFinalSellPrice:1200,policyTargetSellPrice:1200},{optionId:'2',barcode:'ABC1-2',optionValue:'블랙',beforeFinalSellPrice:1500,targetFinalSellPrice:1800,policyTargetSellPrice:1800}]},{mallKey:'SMALL_00069'}],writes:[{},{}],protectedDecreaseCount:1,optionChangeCount:2},writeIndex:0,errorCode:scenario==='blocked'?'MONTHLY_PRICE_CONFIRMED_COST_REQUIRED':null,transmission:scenario==='resume'?{token,fingerprint}:null};}
let item=makeItem();
const snapshot=()=>({ok:true,run:started?{id:runId,month:'2026-09',policy:'MONTHLY_CONFIRMED_COST_OPTION_AWARE_INCREASE_ONLY_V2',warnings:[]}:null,items:started?[item]:[]});
const server=createServer(async(req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(bundle.outputFiles[0].text);}
  if(req.url.startsWith('/api/china-order-manager/monthly-price')){
    res.setHeader('content-type','application/json');
    if(req.method==='GET')return res.end(JSON.stringify(snapshot()));
    let raw='';for await(const c of req)raw+=c;const p=JSON.parse(raw);events.push(p.action);let duplicate;
    if(p.action==='start'){started=true;return res.end(JSON.stringify(snapshot()));}
    if(p.action==='prepare')item.state='PREPARED';
    if(p.action==='write'){item.writeIndex++;item.state=item.writeIndex===2?'VERIFY_PENDING':'PREPARED';}
    if(p.action==='verify')item.state='VERIFIED';
    if(p.action==='resendClaim'){duplicate=item.state==='RESENDING';item.state='RESENDING';item.transmission={token,fingerprint};}
    if(p.action==='resendReport')item.state='TRANSMITTED';
    return res.end(JSON.stringify({ok:true,item:{...item,duplicate}}));
  }
  res.setHeader('content-type','text/html;charset=utf-8');res.end('<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1200,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
  window.bridgeEvents=[];
  window.addEventListener('message',e=>{
    const m=e.data;if(m?.channel!=='commerce-os-monthly-price-v1'||m.direction!=='request')return;
    window.bridgeEvents.push({command:m.command,payload:m.payload});
    const response={ok:true,version:'0.5.2',observation:{fakeReadOnlyFixture:true},report:{token:m.payload.token,fingerprint:m.payload.fingerprint,goodsKey:'1234567',state:'SUCCEEDED',priceOnly:false,priceAndOption:true}};
    window.postMessage({channel:m.channel,direction:'response',requestId:m.requestId,response},location.origin);
  });
});
try{
  await page.goto(url);await page.getByRole('button',{name:/예상 가격 확인/}).click();
  await page.getByTestId('monthly-price-preview').waitFor({state:'attached'});
  await page.getByText('ABC1-1',{exact:true}).waitFor({state:'attached'});
  await page.getByText('테스트 상품 A',{exact:true}).waitFor({state:'attached'});
  await page.getByText('ABC1-2',{exact:true}).waitFor({state:'attached'});
  await page.getByText('테스트 상품 B',{exact:true}).waitFor({state:'attached'});
  await page.getByText('1,500원',{exact:true}).waitFor({state:'attached'});
  await page.getByText('1,800원',{exact:true}).waitFor({state:'attached'});
  await page.getByText('1,000원',{exact:true}).waitFor({state:'attached'});
  await page.getByText('1,200원',{exact:true}).waitFor({state:'attached'});
  assert.deepEqual(events,['start','prepare']);
  let bridge=await page.evaluate(()=>window.bridgeEvents);assert.equal(bridge.filter(x=>x.command==='START').length,0);
  await page.getByRole('button',{name:/이대로 가격조정 실행/}).click();
  await page.getByText('전송 종료 · 마켓 확인 대기',{exact:true}).waitFor({state:'attached'});
  assert.deepEqual(events,['start','prepare','write','write','verify','resendClaim','resendReport']);
  bridge=await page.evaluate(()=>window.bridgeEvents);assert.equal(bridge.filter(x=>x.command==='START').length,1);assert.equal(bridge.find(x=>x.command==='START').payload.runId,runId);assert.equal(bridge.find(x=>x.command==='START').payload.newClaim,true);
  await page.getByText('상품별 결과·제외 사유').click();await page.screenshot({path:path.join(out,'preview-confirm-happy-path.png'),fullPage:true});
  assert.equal(await page.getByRole('button',{name:'예상 변경안 계산 완료'}).isDisabled(),true);
  scenario='blocked';item=makeItem();started=false;events=[];await page.goto(url);await page.getByRole('button',{name:/예상 가격 확인/}).click();await page.waitForTimeout(100);assert.deepEqual(events,['start']);assert.equal((await page.evaluate(()=>window.bridgeEvents)).filter(x=>x.command==='START').length,0);
  await page.getByText('상품별 결과·제외 사유').click();await page.screenshot({path:path.join(out,'unknown-cost-protected.png'),fullPage:true});
  scenario='resume';item=makeItem();started=true;events=[];await page.goto(url);await page.getByRole('button',{name:/미완료 가격조정 이어가기/}).click();await page.getByText('전송 종료 · 마켓 확인 대기',{exact:true}).waitFor({state:'attached'});
  assert.deepEqual(events,['resendClaim','resendReport']);bridge=await page.evaluate(()=>window.bridgeEvents);assert.equal(bridge.find(x=>x.command==='START').payload.newClaim,false);
  scenario='happy';item=makeItem();started=false;events=[];await page.goto(url+'?ready=0');assert.equal(await page.getByRole('button',{name:/예상 가격 확인/}).isDisabled(),true);
  // Real DOM parser in Chromium. Never contacts or writes Shopling.
  const shop=await browser.newPage();await shop.route('https://a.shopling.co.kr/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<table><tr><th>쇼핑몰</th><th>소비자가</th><th>판매가</th><th>매입가</th></tr><tr><td>도매꾹</td><td>7,777</td><td>1,234</td><td>222</td></tr></table>'}));
  await shop.goto('https://a.shopling.co.kr/prod/prodShopInfo.phtml?mode=price_chg&prod_id=1234567');await shop.addScriptTag({content:readFileSync('public/shopling-a21-price-option-resend/monthly-price-dom.js','utf8')});
  const observed=await shop.evaluate(()=>collectMonthlyPricePage('1234567'));assert.ok(observed,JSON.stringify(await shop.evaluate(()=>({charset:document.characterSet,text:document.body.innerText}))));assert.equal(observed.rows[0].sellPrice,1234);assert.equal(observed.rows[0].consumerPrice,7777);assert.equal(observed.rows[0].purchasePrice,222);
  await shop.setContent('<table><tr><td>도매꾹</td><td>999</td><td>888</td><td>777</td></tr></table>');assert.equal(await shop.evaluate(()=>collectMonthlyPricePage('1234567')),null);
  assert.deepEqual(errors,[]);writeFileSync(path.join(out,'browser-result.json'),JSON.stringify({ok:true,scenarios:['preview-before-write','explicit-confirm','unknown-cost-blocked','refresh-resume','receipt-prerequisite','DOM-header-mapping','ambiguous-DOM-blocked'],productionWrites:false},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
