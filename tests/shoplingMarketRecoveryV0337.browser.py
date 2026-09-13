import argparse, json, re, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--directory', type=Path, required=True)
parser.add_argument('--report', type=Path, default=Path('browser-report.json'))
args = parser.parse_args()
root = args.directory
recovery = (root / 'recovery.mjs').read_text()
source = (root / 'content-group-canary.mjs').read_text()
names = ['text', 'escapeRegex', 'visible', 'optionText', 'selectHas', 'forceSelect', 'click', 'buttonText', 'buttons', 'controlLabel', 'chooseRadio', 'savedProfileSelect', 'applyPreProdMapping', 'drivePreProd']
starts = list(re.finditer(r'^  (?:async )?function (\w+)\(', source, re.M))
functions = {m.group(1): source[m.start(): starts[i + 1].start() if i + 1 < len(starts) else source.index('\n  window.addEventListener', m.start())] for i, m in enumerate(starts)}
code = '\n'.join(functions[name] for name in names)
fixture = '''<style>table{border-collapse:collapse;width:1000px;table-layout:fixed}td,th{padding:8px}input[type=radio]{display:inline-block}.settings td{width:50%}</style>
<table><tr><td>검색 관리</td><td colspan=2><select id=profile><option>검색 선택</option><option value=d2>도매2</option></select></td></tr>
<tr><td>선택된 쇼핑몰 / ID</td><td><input type=checkbox checked name=account1>mall/accountA</td><td><input type=checkbox checked name=account2>mall/accountB</td></tr></table>
<table class=settings>
<tr><td><input type=radio name=price checked id=price0><label for=price0>상품판매가</label></td><td><input type=radio name=price id=price1><label for=price1>쇼핑몰별 상품판매가</label></td></tr>
<tr><td><input type=radio name=desc checked id=desc0><label for=desc0>상품설명</label></td><td><input type=radio name=desc id=desc1><label for=desc1>쇼핑몰별 상품설명</label></td></tr>
<tr><td><input type=radio name=title checked id=title0><label for=title0>상품명</label></td><td><input type=radio name=title id=title1><label for=title1>쇼핑몰별 상품명</label></td></tr>
<tr><td><input type=radio name=search checked id=search0><label for=search0>검색어</label></td><td><input type=radio name=search id=search1><label for=search1>쇼핑몰별 검색어</label></td></tr>
<tr><td><input type=radio name=opt checked id=opt0><label for=opt0>옵션명</label></td><td><input type=radio name=opt id=opt1><label for=opt1>쇼핑몰별 옵션명</label></td></tr>
<tr><td><input type=radio name=mapping checked id=map0><label for=map0>매핑적용안함</label></td><td><input type=radio name=mapping id=map1><label for=map1>매핑된 카테고리로 전송</label></td></tr>
<tr><td><input type=radio name=fallback checked id=fall0><label for=fall0>매핑된 카테고리가 없을시 에러 출력</label></td><td><input type=radio name=fallback id=fall1><label for=fall1>매핑된 카테고리가 없을시, 무시하고 쇼핑몰기본정보의 카테고리로 전송</label></td></tr></table>
<table id=templates><tr><th>[필수] [쇼핑몰기본정보]</th><th>[선택1] [쇼핑몰카테고리]</th><th>[선택2] [쇼핑몰배송정보]</th></tr>
<tr><td><table><tr><td><input type=radio name=basicA value=101 id=a1>일반</td></tr><tr><td><input type=radio name=basicA value=102 id=a2>무료배송</td></tr></table></td><td><input type=radio name=catA value=55></td><td><input type=radio name=shipA value=99></td></tr>
<tr><td><table><tr><td><input type=radio name=basicB value=201 id=b1>일반</td></tr><tr><td><input type=radio name=basicB value=202 id=b2>무료배송</td></tr></table></td><td><input type=radio name=catB value=56></td><td><input type=radio name=shipB value=100></td></tr></table>
<button id=send onclick="window.sendClicks++">상품등록송신</button>'''
mock = '''window.sendClicks=0;window.armCalls=0;window.failures=[];window.results=[];window.profileChanges=0;window.stopping=false;
const ARM_MESSAGE='arm';const state={runId:'canary-group-v030-diagnostic-test-1234567',task:{goodsKey:'122735',profile:'도매2'},status:'running',stage:'id_choice_submitted',stepAt:Date.now()-20000};
window.testState=state;
async function storageGet(){return {commerceOsShoplingStopV0337:window.stopping};}
async function patchWorkerState(_s,p){Object.assign(state,p);return state;}
async function getWorkerState(){return state;}
async function failTask(_s,reason,message){failures.push({reason,message});state.status='failed';}
async function completeTask(_s,outcome,reason,message){results.push({outcome,reason,message});state.status='completed';state.outcome=outcome;}
async function sendMessage(){armCalls++;if(window.stopAfterArm)window.stopping=true;return {ok:!window.rejectArm};}
'''
report = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=shutil.which('chromium') or shutil.which('google-chrome'), args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1400, 'height': 1800})
    def setup(mode='diagnostic', profiles=True, basic_mode='all'):
        page.goto('about:blank')
        page.set_content(fixture)
        page.add_script_tag(content=recovery)
        page.add_script_tag(content=mock + '\n' + code + '\nwindow.callDriver=()=>drivePreProd(state);')
        if mode == 'send':
            page.evaluate("testState.runId='canary-group-v030-send-test-1234567'")
        if not profiles:
            page.eval_on_selector('#profile', 'e=>e.remove()')
        else:
            script = "e=>e.addEventListener('change',()=>{window.profileChanges++;setTimeout(()=>{document.querySelector('#a2').checked=true;" + ("document.querySelector('#b1').checked=true;" if basic_mode == 'all' else '') + "},80);})"
            page.eval_on_selector('#profile', script)
        page.evaluate('callDriver()')
        page.wait_for_timeout(120)
        page.evaluate('testState.stepAt=Date.now()-20000')
    def passed(name):
        report.append({'name': name, 'passed': True})
    setup()
    assert page.evaluate('profileChanges') == 1
    passed('saved profile applied even from defaults')
    page.evaluate('callDriver()'); page.evaluate('callDriver()')
    assert page.evaluate('results[0].outcome') == 'diagnostic_ready'
    assert page.evaluate('armCalls') == 0 and page.evaluate('sendClicks') == 0
    passed('complete diagnostic does not arm or click send')
    assert page.evaluate('testState.preprodEvidence.groups.map(g=>g.selectedValue)') == ['102', '201']
    passed('saved template choice preserved; no first/free-shipping guess')
    assert page.locator('#price1').is_checked() and page.locator('#title1').is_checked() and page.locator('#fall1').is_checked()
    passed('all seven transmission choices applied in fixture')
    setup(profiles=False)
    assert page.evaluate('failures[0].reason') == 'preprod_saved_profile_missing' and page.evaluate('armCalls') == 0
    passed('missing saved profile fails before send')
    setup(basic_mode='partial'); page.evaluate('callDriver()')
    assert page.evaluate('failures[0].reason') == 'preprod_required_basics_missing' and page.evaluate('armCalls') == 0
    passed('one missing mall basic-template blocks send')
    setup(mode='send'); page.evaluate('callDriver()'); page.evaluate('callDriver()'); page.evaluate('callDriver()')
    assert page.evaluate('armCalls') == 1 and page.evaluate('sendClicks') == 1
    passed('send mode requires lock and only clicks once')
    setup(mode='send'); page.evaluate('rejectArm=true'); page.evaluate('callDriver()'); page.evaluate('callDriver()')
    assert page.evaluate('sendClicks') == 0 and page.evaluate('failures[0].reason') == 'submit_lock_failed'
    passed('failed lock blocks actual click')
    setup(mode='send'); page.evaluate('stopAfterArm=true'); page.evaluate('callDriver()'); page.evaluate('callDriver()')
    assert page.evaluate('sendClicks') == 0
    passed('operator stop during arm blocks actual click')
    html = re.sub(r'<script.*?</script>', '', (root / 'popup.html').read_text(), flags=re.S)
    page.goto('about:blank'); page.set_content(html)
    page.add_script_tag(content=recovery)
    page.add_script_tag(content='''window.store={};window.listeners=[];
const item={jobId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',isLatestBatch:true,uploadSuccessCount:6,launchItemId:'launch-test',modelNumber:'AAA419',modelName:'fixture',marketDoneCount:0,marketPendingCount:0,confirmNeededCount:6,activeBusyCount:0,selectable:false,channels:[]};
window.fetch=async()=>({ok:true,json:async()=>({ok:true,items:[item]})});
window.chrome={storage:{local:{get:async keys=>keys===null?store:Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,store[k]])),set:async obj=>Object.assign(store,obj)},onChanged:{addListener:fn=>listeners.push(fn)}},tabs:{query:async()=>[{id:1,url:'https://a.shopling.co.kr/'}]},runtime:{lastError:null,sendMessage:async()=>({ok:true})}};
''')
    page.add_script_tag(content=(root / 'popup.js').read_text()); page.wait_for_timeout(120)
    assert page.locator('input[data-job-id]').is_enabled()
    page.locator('input[data-job-id]').check()
    assert page.locator('#diagnosticStart').is_enabled() and page.locator('#start').is_disabled()
    passed('held AAA419 selectable for diagnostic only')
    page.locator('#mode').select_option('send')
    assert page.locator('input[data-job-id]').is_disabled() and page.locator('#start').is_disabled()
    passed('held AAA419 cannot be selected for actual send')
    bg = (root / 'background-root.mjs').read_text()
    a = bg.index('async function requestJson('); b = bg.index('\nfunction marketAutoStorageGet', a)
    page.add_script_tag(content='window.networkWrites=0;window.fetch=async()=>{networkWrites++;throw new Error("unexpected fetch")};\n' + bg[a:b] + '\nwindow.testRequest=requestJson;')
    result = page.evaluate("testRequest('https://example.invalid/',{runId:'canary-group-v030-diagnostic-test-1234567',action:'arm-submit'})")
    assert not result['ok'] and page.evaluate('networkWrites') == 0
    passed('diagnostic backend mutation guard performs zero network calls')
    browser.close()
args.report.parent.mkdir(parents=True, exist_ok=True)
args.report.write_text(json.dumps({'passed': len(report), 'tests': report, 'scope': 'Real Chromium with synthetic DOM and mocked services; not live Shopling E2E.'}, ensure_ascii=False, indent=2))
print(json.dumps({'passed': len(report), 'scope': 'Chromium synthetic DOM, no live marketplace writes'}))
