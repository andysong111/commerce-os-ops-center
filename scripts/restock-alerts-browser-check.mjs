import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import {
  storefrontProbe,
  smsForm,
} from "../local-agent/mobile-work-center/restock-browser.mjs";
import {
  searchSmsHistory,
  historyRows,
} from "../local-agent/mobile-work-center/restock-sms.mjs";
const requireTools = createRequire(
  path.join(
    process.env.MONTHLY_PRICE_BROWSER_TOOLS || "/tmp/monthly-price-browser",
    "package.json",
  ),
);
const { chromium } = requireTools("playwright"),
  { build } = requireTools("esbuild");
const bundle = await build({
  stdin: {
    contents:
      `import React from "react";
       import {createRoot} from "react-dom/client";
       import {RestockAlerts} from "./src/app/restock-alerts/RestockAlerts";
       import Captcha from "./src/app/shopling-captcha/[token]/ShoplingCaptchaClient";
       createRoot(document.querySelector("main")).render(location.pathname === "/captcha-fixture"
         ? <Captcha token="fixture"/> : <RestockAlerts draft=""/>);`,
    loader: "tsx",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  jsx: "automatic",
  platform: "browser",
  define: { "process.env": "{}", "process.env.NODE_ENV": '"production"' },
  alias: { "@": path.join(process.cwd(), "src") },
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MONTHLY_PRICE_BROWSER_EXECUTABLE
    ? { executablePath: process.env.MONTHLY_PRICE_BROWSER_EXECUTABLE }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: "block",
});
let posted,
  mode = "off",
  selectedTest = null,
  requestedTest = null,
  submits = 0;
let phoneStatus = "ANSWER_SUBMITTED";
try {
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1") {
      if (u.pathname === "/api/shopling-captcha/fixture") {
        assert.equal(route.request().method(), "GET");
        return route.fulfill({ json: { ok: true, challenge: {
          status: phoneStatus, imageVersion: 2, expired: false, imageAvailable: false,
          confirmationDelayed: phoneStatus === "ANSWER_SUBMITTED",
        } } });
      }
      if (u.pathname === "/app.js")
        return route.fulfill({
          contentType: "application/javascript",
          body: bundle.outputFiles[0].text,
        });
      if (u.pathname === "/api/restock-alerts") {
        if (route.request().method() === "POST") {
          posted = route.request().postDataJSON();
          if (posted.action === "quote") return route.fulfill({json:{state:"ready",result:{complete:true,marketCount:4,offer:{market:"스마트스토어",price:4100,url:"https://smartstore.naver.com/example/products/13"}}}});
          if (posted.action === "settings") mode = posted.mode;
          if (posted.action === "send-test") requestedTest = posted.id;
          if (posted.action === "activate-after-test") selectedTest = posted.id;
          return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({
          json: {
            items: requestedTest
              ? [
                  {
                    id: requestedTest,
                    operatorTest: true,
                    barcode: "운영자 시험 문자",
                    phone: "010-****-5555",
                    status: "READY",
                    created: "2026-11-28T01:00:00Z",
                  },
                ]
              : [],
            total: requestedTest ? 1 : 0,
            settings: {
              mode,
              sender: "01000000000",
              opt_out: "",
              activate_after_test: selectedTest,
            },
          },
        });
      }
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<main></main><script src="/app.js"></script>',
      });
    }
    if (u.hostname === "dosomesaurus.com")
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<h1>컨트롤러</h1><select id="product_option_id1" onchange="document.querySelector(\'tr span\').textContent=\'- \'+this.value;document.querySelector(\'tr\').hidden=false"><option value="*">옵션 선택</option><option value="ps4" disabled>ps4 [품절]</option><option value="ps5">ps5</option></select><div class="action_button"><a class="btnSubmit">BUY IT NOW</a></div><table><tr class="option_product" hidden><td class="product"><span></span><input type="hidden" class="option_box_id" value="P0001"><input class="quantity_opt" value="1"></td></tr></table>',
      });
    if (
      u.hostname === "kt.shopling.co.kr" &&
      u.pathname === "/cmpy/sms_list.phtml"
    )
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<select><option>2026</option></select><select><option>01</option><option selected>11</option><option>12</option></select><select name="srch_tp"><option>검색항목</option><option value="rnum">수신번호</option></select><input name="srch_txt"><input type="button" value="검색"><table><tr><th>NO.</th><th>발송일자</th><th>발신번호</th><th>수신번호</th><th>SMS내용</th><th>구분</th><th>전송상태</th><th>발송자ID</th></tr><tr id="initial"><td>검색 버튼을 누르세요</td></tr></table>',
      });
    if (u.hostname === "kt.shopling.co.kr")
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<textarea id="sms_smsg1" onkeyup="document.querySelector(\'#current_byte\').textContent=this.value.length*2"></textarea><strong id="current_byte">0</strong><input id="send_num_list"><div><span>204건</span><div>발신번호 <select name="sms_send_num"><option>01000000000</option></select></div></div><input type="text" name="rcv_num[]"><input type="text" name="rcv_num[]"><input type="button" value="보내기" onclick="recordFixtureClick()">',
      });
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (e) => console.error(e.message));
  await page.goto("http://127.0.0.1:4111/");
  await page.getByLabel("상품 B코드").fill("BCE6-1");
  await page.getByLabel("고객 휴대폰 번호").fill("01000001234");
  await page.getByText("원래 구매한 마켓 추가 · 선택").click();
  await page.getByLabel("마켓명").fill("도매꾹");
  await page.getByLabel("원구매처 상품번호").fill("M-01234");
  await page
    .getByLabel("원구매처 상품 링크")
    .fill("https://domeggook.com/12345");
  await page.getByLabel("최저가 구매처를 문자에 추가").check();
  await page.getByText("판매중인 4개 마켓 중 스마트스토어 · 4,100원").waitFor();
  const preview = await page.locator("aside").innerText();
  assert.ok(preview.includes("스마트스토어 판매가 4,100원"));
  assert.ok(preview.includes("https://smartstore.naver.com/example/products/13"));
  await page.getByLabel("최저가 구매처를 문자에 추가").uncheck();
  assert.ok(!(await page.locator("aside").innerText()).includes("4,100원"));
  assert.match(preview, /문의하신 도매꾹 상품번호 M-01234/);
  assert.ok(preview.includes("https://domeggook.com/12345"));
  assert.match(preview, /자사몰 상품/);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.getByLabel("최저가 구매처를 문자에 추가").check();
  await page.getByRole("button", { name: "신청 등록" }).click();
  await page.getByText("입고알림 신청을 등록했습니다.").waitFor();
  assert.equal(posted.includeLowestOffer, true);
  assert.equal(posted.marketItem, "M-01234");
  assert.equal(posted.marketName, "도매꾹");
  assert.ok(posted.id);
  await page.getByText("샵플링 문자 설정", { exact: false }).click();
  assert.equal(await page.getByLabel("운영자 시험 수신번호").count(), 0);
  await page.getByLabel("발송 모드").selectOption("pilot");
  await page.getByRole("button", { name: "발송 설정 저장" }).click();
  await page.getByLabel("운영자 시험 수신번호").fill("01000005555");
  await page.getByRole("button", { name: "시험 문자 1건 보내기" }).click();
  await page
    .getByText("시험 문자 1건을 요청했습니다.", { exact: false })
    .waitFor();
  assert.equal(posted.action, "send-test");
  assert.equal(posted.phone, "01000005555");
  assert.ok(posted.id);
  assert.equal(posted.barcode, undefined);
  assert.ok(
    await page
      .getByRole("button", { name: "시험 문자 1건 보내기" })
      .isDisabled(),
  );
  const testId = posted.id;
  await page
    .getByRole("button", { name: "이 시험 성공 후 고객 자동 발송 켜기" })
    .click();
  await page
    .getByText("이 시험의 발송 성공 후 고객 자동 발송을 켭니다.")
    .waitFor();
  assert.deepEqual(posted, { action: "activate-after-test", id: testId });
  const product = { number: "705", options: ["ps5"] };
  await page.goto(
    "https://dosomesaurus.com/product/detail.html?product_no=705",
  );
  assert.equal(
    await page.evaluate(storefrontProbe, { ...product, options: ["ps4"] }),
    false,
  );
  assert.equal(await page.evaluate(storefrontProbe, product), false);
  assert.equal(await page.evaluate(storefrontProbe, product), true);
  assert.equal(
    await page.evaluate(storefrontProbe, { ...product, number: "706" }),
    false,
  );
  await page.setContent(
    '<h1>단품</h1><section class="action_button"><a class="btnSubmit">구매하기</a></section><input id="quantity" value="0">',
  );
  assert.equal(
    await page.evaluate(storefrontProbe, { ...product, options: [] }),
    false,
  );
  await page.locator("#quantity").fill("1");
  assert.equal(
    await page.evaluate(storefrontProbe, { ...product, options: [] }),
    true,
  );
  const job = {
    phone: "01000001234",
    sender: "01000000000",
    body: "[도소매사우루스]\n입고된 상품을 확인해 주세요.",
  };
  await page.goto("https://kt.shopling.co.kr/cmpy/sms_send_popup.phtml");
  await page.exposeFunction("recordFixtureClick", () => {
    submits++;
  });
  const form = (action) =>
    page.evaluate(
      ({ fn, job, action }) => Function("return (" + fn + ")")()(job, action),
      { fn: String(smsForm), job, action },
    );
  assert.equal((await form("fill")).ok, true);
  await page.locator('input[name="rcv_num[]"]').nth(1).fill("01000005555");
  assert.equal((await form("submit")).ok, false);
  assert.equal(submits, 0);
  await page.locator('input[name="rcv_num[]"]').nth(1).fill("");
  assert.equal((await form("submit")).ok, true);
  assert.equal(submits, 1);
  await page.goto("https://kt.shopling.co.kr/cmpy/sms_list.phtml");
  const ledger = () =>
    page.evaluate(
      ({ fn, sender, phone }) =>
        Function("return (" + fn + ")")()(sender, phone),
      { fn: String(historyRows), sender: job.sender, phone: job.phone },
    );
  assert.equal(await ledger(), null);
  await page.evaluate(() => {
    document.querySelector('input[value="검색"]').onclick = () => {
      if (
        document.querySelector("[name=srch_tp]").value === "rnum" &&
        document.querySelector("[name=srch_txt]").value === "01000001234"
      )
        document.querySelector("#initial").innerHTML = [
          "1",
          "2026-11-28 09:30:00",
          "010-0000-0000",
          "010-0000-1234",
          "시험",
          "단문",
          "성공",
          "운영자",
        ]
          .map((s) => "<td>" + s + "</td>")
          .join("");
    };
  });
  assert.equal(
    await page.evaluate(
      ({ fn, phone }) => Function("return (" + fn + ")")()("2026-11", phone),
      { fn: String(searchSmsHistory), phone: job.phone },
    ),
    true,
  );
  assert.equal((await ledger())?.[0]?.[6], "성공");
  await page.goto("http://127.0.0.1/captcha-fixture");
  await page.getByText(/1분 넘게 업무용 PC에서 로그인 결과가 오지 않았습니다/).waitFor();
  phoneStatus = "CANCELLED";
  await page.getByText(/이 인증 요청이 종료되었습니다/).waitFor();
  assert.equal(await page.getByText(/로그인이 완료되었습니다/).count(), 0);
  phoneStatus = "CONSUMED";
  await page.reload();
  await page.getByText(/샵플링 로그인이 완료되었습니다/).waitFor();
  console.log(
    "PASS mobile request, optional original marketplace, PS4 sold out / PS5 purchasable, isolated G6 single-recipient submit",
  );
} finally {
  await browser.close();
}
