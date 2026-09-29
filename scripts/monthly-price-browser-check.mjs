import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import path from 'node:path';
const tools=createRequire(path.join(process.env.MONTHLY_PRICE_BROWSER_TOOLS||'/tmp/monthly-price-browser','package.json'));
const {build}=tools('esbuild'),{chromium}=tools('playwright');
const root=process.cwd(), out=path.join(root,'output/monthly-price');mkdirSync(out,{recursive:true});
const contractSource=readFileSync(path.join(root,'src/lib/monthlyPriceContract.ts'),'utf8');
const fixtureExtensionVersion=contractSource.match(/MONTHLY_PRICE_EXTENSION_VERSION\s*=\s*"([^"]+)"/)?.[1];
assert.ok(fixtureExtensionVersion,'monthly price extension version is missing from the contract');
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MonthlyPricePanel}from'./src/components/china-order-manager/MonthlyPricePanel';createRoot(document.getElementById('root')).render(<MonthlyPricePanel month="2026-09" ready={new URLSearchParams(location.search).get('ready')!=='0'}/>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.join(root,'src')}});
const runId='11111111-1111-4111-8111-111111111111',itemId='22222222-2222-4222-8222-222222222222',secondItemId='22222222-2222-4222-8222-222222222223',thirdItemId='22222222-2222-4222-8222-222222222224',token='44444444-4444-4444-8444-444444444444',fingerprint='a'.repeat(64);
let scenario='happy',events=[],started=false,extraItems=[];
function makeItem(){return{id:itemId,goodsKey:'1234567',state:scenario==='blocked'?'BLOCKED':scenario==='resume'?'RESENDING':'QUEUED',candidate:{productName:'테스트 상품 A',productGroup:'도매1',options:[{barcode:'ABC1-1',optionId:'1',productName:'테스트 상품 A',protectedCostKrw:500,currentCostKrw:500,unitsPerOrder:1},{barcode:'ABC1-2',optionId:'2',productName:'테스트 상품 B',protectedCostKrw:700,currentCostKrw:700,unitsPerOrder:1}],reason:scenario==='blocked'?'MONTHLY_PRICE_CONFIRMED_COST_REQUIRED':null},plan:{fingerprint,productGroup:'도매1',targets:[{mallKey:null,before:{sellPrice:1000},target:{sellPrice:1200},options:[{optionId:'1',barcode:'ABC1-1',optionValue:'화이트',beforeFinalSellPrice:1000,targetFinalSellPrice:1200,policyTargetSellPrice:1200},{optionId:'2',barcode:'ABC1-2',optionValue:'블랙',beforeFinalSellPrice:1500,targetFinalSellPrice:1800,policyTargetSellPrice:1800}]},{mallKey:'SMALL_00069'}],writes:[{},{}],protectedDecreaseCount:1,optionChangeCount:2},writeIndex:0,errorCode:scenario==='blocked'?'MONTHLY_PRICE_CONFIRMED_COST_REQUIRED':null,transmission:scenario==='resume'?{token,fingerprint}:null};}
let item=makeItem();
const snapshot=()=>({ok:true,run:started?{id:runId,month:'2026-09',policy:'MONTHLY_CONFIRMED_COST_OPTION_AWARE_INCREASE_ONLY_V2',warnings:[]}:null,items:started?[item,...extraItems]:[]});
const server=createServer(async(req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(bundle.outputFiles[0].text);}
  if(req.url.startsWith('/api/china-order-manager/monthly-price')){
    res.setHeader('content-type','application/json');
    if(req.method==='GET')return res.end(JSON.stringify(snapshot()));
    let raw='';for await(const c of req)raw+=c;const p=JSON.parse(raw);events.push(p.action);let duplicate;
    if(p.action==='start'){started=true;return res.end(JSON.stringify(snapshot()));}
    if(p.action==='resumePreflight'){
      for(const row of [item,...extraItems])if(row.state==='BLOCKED'&&['MONTHLY_PRICE_GROUP_REQUIRED','MONTHLY_PRICE_INACTIVE_LISTING','MONTHLY_PRICE_MALL_CURRENT_PRICE_REQUIRED','MONTHLY_PRICE_OPTION_BARCODE_CONFLICT'].includes(row.errorCode)){row.state='QUEUED';row.errorCode=null;}
      return res.end(JSON.stringify(snapshot()));
    }
    const target=[item,...extraItems].find(row=>row.id===p.itemId)||item;
    if(p.action==='reviewLegacyTransmission'){
      target.state='RESENDING';target.errorCode=null;target.transmission={token:'77777777-7777-4777-8777-777777777777',fingerprint,batchId:p.nextBatchId};
      return res.end(JSON.stringify({ok:true,item:{...target,requeued:true,marketReview:{state:'MISMATCH'}}}));
    }
    if(p.action==='prepare')target.state='PREPARED';
    if(p.action==='write'){target.writeIndex++;target.state=target.writeIndex===2?'VERIFY_PENDING':'PREPARED';}
    if(p.action==='verify')target.state='VERIFIED';
    if(p.action==='resendClaim'){duplicate=target.state==='RESENDING';target.state='RESENDING';target.transmission={token,fingerprint,...(p.batchId?{batchId:p.batchId}:{})};}
    if(p.action==='resendReport'){if(['MISSING','PARTIAL_FAILURE','STOPPED'].includes(p.report?.state)){target.state='RESENDING';target.errorCode='MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED';target.transmission={...target.transmission,result:p.report?.state==='MISSING'?'BATCH_HISTORY_MISSING':'BATCH_TERMINAL_REVIEW_REQUIRED'};}else target.state='TRANSMITTED';}
    return res.end(JSON.stringify({ok:true,item:{...target,duplicate}}));
  }
  res.setHeader('content-type','text/html;charset=utf-8');res.end('<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1200,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript((extensionVersion)=>{
  window.bridgeEvents=[];
  window.bridgeHistoryMissingItemId=null;
  window.bridgeMarketReadFailures={};
  window.bridgeTerminalRowState=null;
  window.bridgeBatches={};
  window.addEventListener('message',e=>{
    const m=e.data;if(m?.channel!=='commerce-os-monthly-price-v1'||m.direction!=='request')return;
    window.bridgeEvents.push({command:m.command,payload:m.payload});
    if(m.command==='START'&&window.bridgeHistoryMissingItemId&&m.payload?.itemId===window.bridgeHistoryMissingItemId){
      window.postMessage({channel:m.channel,direction:'response',requestId:m.requestId,response:{ok:false,version:extensionVersion,error:'MONTHLY_PRICE_TRANSMISSION_HISTORY_MISSING'}},location.origin);
      return;
    }
    if(m.command==='MARKET_READ'&&Number(window.bridgeMarketReadFailures[m.payload?.goodsKey]||0)>0){
      window.bridgeMarketReadFailures[m.payload.goodsKey]-=1;
      window.postMessage({channel:m.channel,direction:'response',requestId:m.requestId,response:{ok:false,version:extensionVersion,error:'MONTHLY_PRICE_REGISTERED_MALL_VIEW_REQUIRED:REGISTERED_VIEW_RESULT_NOT_FOUND'}},location.origin);
      return;
    }
    if(m.command==='BATCH_START'){
      window.bridgeBatches[m.payload.batchId]=m.payload.items||[];
    }
    if(m.command==='BATCH_START'||m.command==='BATCH_STATUS'){
      const rows=window.bridgeBatches[m.payload.batchId]||[];
      const report={batchId:m.payload.batchId,state:window.bridgeTerminalRowState?'PARTIAL_FAILURE':'SUCCEEDED',phase:'DONE',activeWindows:0,itemCount:rows.length,items:rows.map(row=>({itemId:row.itemId,token:row.token,fingerprint:row.fingerprint,goodsKey:row.goodsKey,state:window.bridgeTerminalRowState||'SUCCEEDED',priceOnly:false,priceAndOption:true,saleStatusActivated:true,saleStatusRestored:true,saleStatusRolledBack:false}))};
      window.postMessage({channel:m.channel,direction:'response',requestId:m.requestId,response:{ok:true,version:extensionVersion,report}},location.origin);
      return;
    }
    const response={ok:true,version:extensionVersion,observation:{fakeReadOnlyFixture:true},report:{token:m.payload.token,fingerprint:m.payload.fingerprint,goodsKey:'1234567',state:'SUCCEEDED',priceOnly:false,priceAndOption:true,saleStatusActivated:true,saleStatusRestored:true}};
    window.postMessage({channel:m.channel,direction:'response',requestId:m.requestId,response},location.origin);
  });
},fixtureExtensionVersion);
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
  bridge=await page.evaluate(()=>window.bridgeEvents);assert.equal(bridge.filter(x=>x.command==='START').length,0);assert.equal(bridge.filter(x=>x.command==='BATCH_START').length,1);assert.equal(bridge.find(x=>x.command==='BATCH_START').payload.runId,runId);assert.equal(bridge.find(x=>x.command==='BATCH_START').payload.newClaim,true);assert.equal(bridge.find(x=>x.command==='BATCH_START').payload.items.length,1);
  await page.getByText('상품별 결과·제외 사유').click();await page.screenshot({path:path.join(out,'preview-confirm-happy-path.png'),fullPage:true});
  assert.equal(await page.getByRole('button',{name:'예상 변경안 계산 완료'}).isDisabled(),true);
  scenario='blocked';item=makeItem();started=false;events=[];await page.goto(url);await page.getByRole('button',{name:/예상 가격 확인/}).click();await page.waitForTimeout(100);assert.deepEqual(events,['start']);assert.equal((await page.evaluate(()=>window.bridgeEvents)).filter(x=>x.command==='START').length,0);
  await page.getByText('상품별 결과·제외 사유').click();await page.screenshot({path:path.join(out,'unknown-cost-protected.png'),fullPage:true});
  scenario='resume';item=makeItem();started=true;events=[];await page.goto(url);await page.getByRole('button',{name:/미완료 가격조정 이어가기/}).click();await page.getByText('전송 종료 · 마켓 확인 대기',{exact:true}).waitFor({state:'attached'});
  assert.deepEqual(events,['resumePreflight','resendReport']);bridge=await page.evaluate(()=>window.bridgeEvents);assert.equal(bridge.find(x=>x.command==='START').payload.newClaim,false);
  scenario='resume';item=makeItem();started=true;events=[];
  const inconsistentBatchId='99999999-9999-4999-8999-999999999999';
  item.errorCode='MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED';item.transmission={token,fingerprint,batchId:inconsistentBatchId};
  await page.goto(url);await page.evaluate(({batchId,itemId,token,fingerprint})=>{window.bridgeTerminalRowState='RUNNING';window.bridgeBatches[batchId]=[{itemId,token,fingerprint,goodsKey:'1234567'}];},{batchId:inconsistentBatchId,itemId,token,fingerprint});
  await page.getByRole('button',{name:'미완료 배치 결과 복구 (1건)',exact:true}).click();
  await page.getByText('자동 처리 종료 · 배치 전체와 개별 결과가 다른 1건은 완료 처리하지 않고 실제 마켓가격 확인 대상으로 보류',{exact:true}).waitFor({state:'attached'});
  assert.equal(item.state,'RESENDING');assert.equal(item.errorCode,'MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED');
  assert.equal(item.transmission.result,'BATCH_TERMINAL_REVIEW_REQUIRED');
  assert.deepEqual(events,['resumePreflight','resendReport']);bridge=await page.evaluate(()=>window.bridgeEvents);assert.equal(bridge.filter(x=>x.command==='BATCH_STATUS').length,1);
  await page.evaluate(()=>{window.bridgeTerminalRowState=null;window.bridgeBatches={};});
  scenario='resume';item=makeItem();started=true;events=[];
  const queuedAfterMissing={...makeItem(),id:secondItemId,goodsKey:'1234568',state:'QUEUED',writeIndex:0,transmission:null,errorCode:null};
  extraItems=[queuedAfterMissing];
  await page.goto(url);await page.evaluate(id=>{window.bridgeHistoryMissingItemId=id;},itemId);
  await page.getByRole('button',{name:/미완료 가격조정 이어가기/}).click();
  await page.getByText('자동 처리 종료 · 이전 전송기록 없음 1건은 재전송하지 않고 보류 · 나머지 상품 처리 완료',{exact:true}).waitFor({state:'attached'});
  assert.equal(item.state,'RESENDING');assert.equal(item.errorCode,'MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED');
  assert.equal(queuedAfterMissing.state,'TRANSMITTED');
  assert.deepEqual(events,['resumePreflight','prepare','write','write','verify','resendClaim','resendReport','resendReport']);
  extraItems=[];
  scenario='legacyResume';item=makeItem();item.state='RESENDING';item.transmission={token,fingerprint};started=true;events=[];
  const queued={...makeItem(),id:secondItemId,goodsKey:'1234568',state:'QUEUED',writeIndex:0,transmission:null};
  const staleBlocked={...makeItem(),id:thirdItemId,goodsKey:'1234569',state:'BLOCKED',candidate:{...makeItem().candidate,productGroup:'',reason:'MONTHLY_PRICE_GROUP_REQUIRED'},plan:null,writeIndex:0,errorCode:'MONTHLY_PRICE_GROUP_REQUIRED',transmission:null};
  extraItems=[queued,staleBlocked];
  await page.goto(url);await page.getByRole('button',{name:/이전 실행 재확인·이어가기/}).click();await page.waitForTimeout(250);
  assert.equal(events[0],'resumePreflight');assert.equal(staleBlocked.errorCode,null);assert.ok(events.filter(x=>x==='prepare').length>=2);
  extraItems=[];
  scenario='happy';item=makeItem();started=true;events=[];
  item.state='BLOCKED';item.plan=null;item.writeIndex=0;item.errorCode='MONTHLY_PRICE_INACTIVE_LISTING';item.transmission=null;
  await page.goto(url);
  await page.getByRole('button',{name:/이전 실행 재확인·이어가기/}).click();
  await page.waitForTimeout(250);
  assert.equal(events[0],'resumePreflight');
  assert.equal(item.errorCode,null);
  assert.notEqual(item.state,'BLOCKED');
  assert.ok(events.includes('prepare'));
  scenario='happy';item=makeItem();started=true;events=[];
  item.state='BLOCKED';item.plan=null;item.writeIndex=0;item.errorCode='MONTHLY_PRICE_MALL_CURRENT_PRICE_REQUIRED';item.transmission=null;
  await page.goto(url);
  await page.getByRole('button',{name:/이전 실행 재확인·이어가기/}).click();
  await page.waitForTimeout(250);
  assert.equal(events[0],'resumePreflight');
  assert.equal(item.errorCode,null);
  assert.notEqual(item.state,'BLOCKED');
  assert.ok(events.includes('prepare'));
  scenario='happy';item=makeItem();started=true;events=[];
  item.state='BLOCKED';item.plan=null;item.writeIndex=0;item.errorCode='MONTHLY_PRICE_OPTION_BARCODE_CONFLICT';item.transmission=null;
  await page.goto(url);
  await page.getByRole('button',{name:/이전 실행 재확인·이어가기/}).click();
  await page.waitForTimeout(250);
  assert.equal(events[0],'resumePreflight');
  assert.equal(item.errorCode,null);
  assert.notEqual(item.state,'BLOCKED');
  assert.ok(events.includes('prepare'));
  scenario='happy';item=makeItem();started=true;events=[];
  item.state='RESENDING';item.errorCode='MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED';item.transmission={token,fingerprint};
  await page.goto(url);
  await page.getByRole('button',{name:/과거 1건 실제 가격 확인 · 미반영만 재전송/}).click();
  await page.getByText(/과거 전송결과 정리 완료 · 이미 정상 0건 · 실제 미반영 재전송 1건/).waitFor({state:'attached'});
  assert.deepEqual(events,['reviewLegacyTransmission','resendReport']);
  bridge=await page.evaluate(()=>window.bridgeEvents);
  assert.equal(bridge.filter(x=>x.command==='MARKET_READ').length,1);
  assert.equal(bridge.filter(x=>x.command==='BATCH_START').length,1);
  assert.equal(item.state,'TRANSMITTED');
  scenario='happy';item=makeItem();started=true;events=[];
  item.state='RESENDING';item.errorCode='MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED';item.transmission={token,fingerprint};
  const reviewAfterFailure={...makeItem(),id:secondItemId,goodsKey:'1234568',state:'RESENDING',errorCode:'MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED',transmission:{token:'88888888-8888-4888-8888-888888888888',fingerprint}};
  extraItems=[reviewAfterFailure];
  await page.goto(url);await page.evaluate(goodsKey=>{window.bridgeMarketReadFailures[goodsKey]=1;},item.goodsKey);
  await page.getByRole('button',{name:/과거 2건 실제 가격 확인 · 미반영만 재전송/}).click();
  await page.getByText(/과거 전송결과 정리 완료 · 이미 정상 0건 · 실제 미반영 재전송 1건 · 확인 보류 1건 · 조회 실패 1건/).waitFor({state:'attached'});
  assert.equal(item.errorCode,'MONTHLY_PRICE_MARKET_RESULT_REVIEW_REQUIRED');
  assert.equal(reviewAfterFailure.state,'TRANSMITTED');
  bridge=await page.evaluate(()=>window.bridgeEvents);
  assert.equal(bridge.filter(x=>x.command==='MARKET_READ').length,2);
  assert.equal(bridge.filter(x=>x.command==='BATCH_START').length,1);
  extraItems=[];
  scenario='happy';item=makeItem();started=true;events=[];
  item.state='RESENDING';item.errorCode='MONTHLY_PRICE_RELIST_REQUIRED';item.transmission={token,fingerprint};
  await page.goto(url);
  assert.equal(await page.getByRole('button',{name:/미완료 가격조정 이어가기|이전 실행 재확인·이어가기/}).count(),0);
  await page.getByText(/3단계 재전송까지 실패한 1건은 삭제 후 재등록 대상으로 분리했습니다/).waitFor({state:'attached'});
  scenario='happy';item=makeItem();started=false;events=[];await page.goto(url+'?ready=0');assert.equal(await page.getByRole('button',{name:/예상 가격 확인/}).isDisabled(),true);
  // Real DOM parsers in Chromium. The source price-setting page and the
  // registered-shop page are separate evidence surfaces.
  const shop=await browser.newPage();
  await shop.route('https://a.shopling.co.kr/**',route=>{
    const requestUrl=new URL(route.request().url());
    let body='';
    if(requestUrl.pathname==='/prod/prodShopInfo.phtml'&&requestUrl.searchParams.get('mode')==='price_chg'){
      body='<table><tr><th>쇼핑몰</th><th>소비자가</th><th>판매가</th><th>매입가</th></tr><tr><td>도매꾹</td><td>7,777</td><td>1,234</td><td>222</td></tr></table>';
    }else if(requestUrl.pathname==='/prod/prodShopInfo.phtml'&&requestUrl.searchParams.get('mode')==='modify'){
      body='<button>등록된 쇼핑몰 보기</button><table><tr><th>상태</th><th>쇼핑몰명</th><th>몰상품코드</th><th>몰상품명</th><th>몰판매가</th></tr><tr><td>삭제</td><td>도매꾹</td><td>OLD-1</td><td>fixture old</td><td>18,700</td></tr><tr><td>판매중</td><td>도매꾹</td><td>LIVE-1</td><td>fixture live</td><td>12,900</td></tr></table>';
    }else if(requestUrl.pathname==='/main.phtml'){
      body='<div>[A21] 쇼핑몰상품수정</div><a id="a4-menu" href="/prod/prodLst.phtml">[A4] 상품조회수정</a>';
    }else{
      body=`<div>총 조회수 : <span id="result-count">0건</span></div>
      <table>
        <tr><td>화면출력</td><td><select id="sort-select"><option>샵플링상품코드</option><option>상품명</option></select><select><option>내림차순</option></select></td></tr>
        <tr><td>보이여부</td><td><label><input id="image-view" type="checkbox">상품이미지보기</label> <label><input id="registered-view" type="checkbox">상품이 등록된 쇼핑몰 보기</label></td></tr>
        <tr id="goods-search-row"><td>검색항목</td><td><select id="goods-search-select"><option value="">검색항목</option><option value="goods">샵플링상품코드</option><option value="own">자사상품코드</option></select><input id="goods-search-input" type="text" value="" placeholder="샵플링상품코드, 자사상품코드, 쇼핑몰상품코드 (콤마로 구분하여 입력하면 다중검색이 됩니다)"><input id="fixture-search" type="button" value="검색"></td></tr>
      </table>
      <table id="product-results"><tr><th>NO</th><th>샵플링상품코드</th><th>상품명</th><th>상품관리</th><th>쇼핑몰</th></tr></table>
      <script>
      (()=>{let phase=0;document.getElementById('fixture-search').addEventListener('click',()=>{
        const select=document.getElementById('goods-search-select');
        const input=document.getElementById('goods-search-input');
        if(select.value!=='goods'||input.value!=='1234567')return;
        if(phase===0){
          phase=1;document.getElementById('result-count').textContent='1건';
          document.getElementById('product-results').insertAdjacentHTML('beforeend','<tr id="goods-row"><td>1</td><td>1234567</td><td>fixture</td><td>수정</td><td>도매꾹</td></tr>');
          return;
        }
        if(!document.getElementById('registered-view').checked)return;
        if(document.getElementById('registered-inline'))return;
        const table=document.createElement('table');table.id='registered-inline';
        table.innerHTML='<tr><th>상태</th><th>사이트</th><th>ID</th><th>몰상품코드</th><th>몰상품명</th><th>몰판매가</th></tr><tr><td>삭제</td><td>도매꾹</td><td>andy801</td><td>OLD-2</td><td>old</td><td>18,700</td></tr><tr><td>판매중</td><td>도매꾹</td><td>andy801</td><td>LIVE-2</td><td>live</td><td>12,900</td></tr>';
        document.body.appendChild(table);
      });})();
      </script>`;
    }
    return route.fulfill({contentType:'text/html; charset=utf-8',body});
  });
  await shop.goto('https://a.shopling.co.kr/prod/prodShopInfo.phtml?mode=price_chg&prod_id=1234567');
  await shop.addScriptTag({content:readFileSync('public/shopling-a21-price-option-resend/monthly-price-dom.js','utf8')});
  const observed=await shop.evaluate(()=>collectMonthlyPricePage('1234567'));
  assert.ok(observed,JSON.stringify(await shop.evaluate(()=>({charset:document.characterSet,text:document.body.innerText}))));
  assert.equal(observed.rows[0].sellPrice,1234);assert.equal(observed.rows[0].consumerPrice,7777);assert.equal(observed.rows[0].purchasePrice,222);
  assert.equal('marketRows' in observed,false);

  await shop.evaluate(()=>sessionStorage.setItem('commerceOsMonthlyRegisteredMallGoodsKey','1234567'));
  await shop.goto('https://a.shopling.co.kr/prod/prodShopInfo.phtml?mode=modify&prod_id=1234567');
  await shop.addScriptTag({content:readFileSync('public/shopling-a21-price-option-resend/monthly-price-dom.js','utf8')});
  const registered=await shop.evaluate(()=>collectMonthlyRegisteredMarketPage('1234567'));
  assert.ok(registered);
  assert.equal(registered.marketEvidence,'REGISTERED_SHOP_TABLE');
  assert.equal(registered.marketRows.length,2);
  assert.equal(registered.marketRows.find(x=>x.status==='판매중').sellPrice,12900);
  assert.equal(registered.marketRows.find(x=>x.status==='판매중').mallProductCode,'LIVE-1');
  assert.equal(registered.marketRows[0].source,'registered_shop_table');

  await shop.goto('https://a.shopling.co.kr/main.phtml');
  await shop.addScriptTag({content:readFileSync('public/shopling-a21-price-option-resend/monthly-price-dom.js','utf8')});
  const shellProbe=await shop.evaluate(()=>inspectMonthlyRegisteredMarketFrame('1234567'));
  assert.equal(shellProbe.state,'A4_MENU_AVAILABLE');
  const shellNav=await shop.evaluate(()=>advanceMonthlyRegisteredMarketPage('1234567'));
  assert.equal(shellNav.state,'A4_MENU_OPENED');
  await shop.waitForURL(/\/prod\/prodLst\.phtml/);
  await shop.addScriptTag({content:readFileSync('public/shopling-a21-price-option-resend/monthly-price-dom.js','utf8')});
  const frameProbe=await shop.evaluate(()=>inspectMonthlyRegisteredMarketFrame('1234567'));
  assert.equal(frameProbe.state,'A4_READY');

  const firstSearch=await shop.evaluate(()=>advanceMonthlyRegisteredMarketPage('1234567'));
  assert.equal(firstSearch.state,'SEARCH_SUBMITTED');
  assert.equal(await shop.locator('#goods-search-select').inputValue(),'goods');
  assert.equal(await shop.locator('#goods-search-input').inputValue(),'1234567');
  assert.equal(await shop.locator('#image-view').isChecked(),false);
  assert.equal(await shop.locator('#registered-view').isChecked(),false);
  assert.equal(await shop.locator('#goods-row').count(),1);

  const afterSearchProbe=await shop.evaluate(()=>inspectMonthlyRegisteredMarketFrame('1234567'));
  assert.ok(['A4_READY','A4_WITH_GOODS'].includes(afterSearchProbe.state));
  const navState=await shop.evaluate(()=>advanceMonthlyRegisteredMarketPage('1234567'));
  assert.equal(navState.state,'REGISTERED_VIEW_SEARCH_SUBMITTED');
  assert.equal(navState.fieldLabel,'샵플링상품코드');
  assert.equal(await shop.locator('#goods-search-select').inputValue(),'goods');
  assert.equal(await shop.locator('#goods-search-input').inputValue(),'1234567');
  assert.equal(await shop.locator('#image-view').isChecked(),false);
  assert.equal(await shop.locator('#registered-view').isChecked(),true);
  const inlineRegistered=await shop.evaluate(()=>collectMonthlyRegisteredMarketPage('1234567'));
  assert.ok(inlineRegistered);
  assert.equal(inlineRegistered.marketRows.find(x=>x.status==='판매중').sellPrice,12900);
  assert.equal(inlineRegistered.marketRows.find(x=>x.status==='판매중').mallProductCode,'LIVE-2');

  await shop.goto('https://a.shopling.co.kr/prod/prodShopInfo.phtml?mode=price_chg&prod_id=1234567');
  await shop.addScriptTag({content:readFileSync('public/shopling-a21-price-option-resend/monthly-price-dom.js','utf8')});
  assert.equal(await shop.evaluate(()=>collectMonthlyRegisteredMarketPage('1234567')),null);
  assert.deepEqual(errors,[]);writeFileSync(path.join(out,'browser-result.json'),JSON.stringify({ok:true,scenarios:['preview-before-write','batched-market-send','explicit-confirm','unknown-cost-blocked','refresh-resume','terminal-batch-running-row-held-for-review','history-missing-does-not-block-remaining-items','legacy-group-block-resume','inactive-only-resume','zero-mall-block-resume','option-barcode-conflict-resume','legacy-market-review-resends-only-mismatch','legacy-market-review-continues-after-read-failure','relist-terminal-hides-resume','receipt-prerequisite','DOM-header-mapping','registered-shop-table-readonly','registered-shop-a4-menu-navigation','registered-shop-action-frame-probe','registered-shop-checkbox-second-search','registered-shop-exact-search-row-and-checkbox','ambiguous-DOM-blocked'],productionWrites:false},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
