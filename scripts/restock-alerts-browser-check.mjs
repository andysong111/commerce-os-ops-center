import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import {
  storefrontProbe,
  smsForm,
} from "../local-agent/mobile-work-center/restock-browser.mjs";
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
      'import React from "react";import {createRoot} from "react-dom/client";import {RestockAlerts} from "./src/app/restock-alerts/RestockAlerts";createRoot(document.querySelector("main")).render(<RestockAlerts draft=""/>);',
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
  submits = 0;
try {
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1") {
      if (u.pathname === "/app.js")
        return route.fulfill({
          contentType: "application/javascript",
          body: bundle.outputFiles[0].text,
        });
      if (u.pathname === "/api/restock-alerts") {
        if (route.request().method() === "POST") {
          posted = route.request().postDataJSON();
          return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({
          json: {
            items: [],
            total: 0,
            settings: { mode: "off", sender: "", opt_out: "" },
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
  const preview = await page.locator("aside").innerText();
  assert.match(preview, /문의하신 도매꾹 상품번호 M-01234/);
  assert.ok(preview.includes("https://domeggook.com/12345"));
  assert.match(preview, /자사몰 상품/);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.getByRole("button", { name: "신청 등록" }).click();
  await page.getByText("입고알림 신청을 등록했습니다.").waitFor();
  assert.equal(posted.marketItem, "M-01234");
  assert.equal(posted.marketName, "도매꾹");
  assert.ok(posted.id);
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
  console.log(
    "PASS mobile request, optional original marketplace, PS4 sold out / PS5 purchasable, isolated G6 single-recipient submit",
  );
} finally {
  await browser.close();
}
