import { withCdpTarget } from "../src/chrome-cdp.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { storefrontProbe, smsForm, matchHistory } from "./restock-browser.mjs";

const debug = "http://127.0.0.1:9222";
const listUrl = "https://kt.shopling.co.kr/cmpy/sms_list.phtml";
const popupUrl = "https://kt.shopling.co.kr/cmpy/sms_send_popup.phtml";
async function chrome(path, method = "GET") {
  const res = await fetch(debug + path, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error("CHROME");
  return res;
}
async function pages() {
  return (await (await chrome("/json/list")).json()).filter(
    (t) => t.type === "page",
  );
}
async function probe(session, fn, ...args) {
  const expression =
    "(" +
    fn.toString() +
    ")(" +
    args.map((a) => JSON.stringify(a)).join(",") +
    ")";
  const res = await session.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, userGesture: true },
    6500,
  );
  if (res.exceptionDetails) throw new Error("PAGE");
  return res.result.value;
}
async function waitFor(read, ms = 7000) {
  const end = Date.now() + ms;
  do {
    const value = await read();
    if (value) return value;
    await delay(250);
  } while (Date.now() < end);
  return null;
}
async function closeTab(id) {
  await chrome("/json/close/" + encodeURIComponent(id)).catch(() => {});
}
async function ownedTab(url, handler) {
  const tab = await (
    await chrome("/json/new?" + encodeURIComponent(url), "PUT")
  ).json();
  try {
    return await withCdpTarget(tab, handler);
  } finally {
    await closeTab(tab.id);
  }
}
export function searchSmsHistory(month, phone) {
  if (
    location.origin !== "https://kt.shopling.co.kr" ||
    location.pathname !== "/cmpy/sms_list.phtml"
  )
    return null;
  // Use only the site's ordinary month/search controls on this dedicated tab.
  const selects = [...document.querySelectorAll("select")],
    year = selects.find((s) =>
      [...s.options].some((o) => o.text.trim() === month.slice(0, 4)),
    ),
    m = selects.find(
      (s) =>
        s !== year &&
        [...s.options].some((o) => /^0?12$/.test(o.text.trim())) &&
        [...s.options].some((o) => /^0?1$/.test(o.text.trim())),
    );
  if (!year || !m || !/^010\d{8}$/.test(phone)) return false;
  const yOpt = [...year.options].find(
      (o) => Number(o.text) === Number(month.slice(0, 4)),
    ),
    mo = [...m.options].find(
      (o) => Number(o.text) === Number(month.slice(5, 7)),
    );
  const search = [
    ...document.querySelectorAll(
      'input[type="button"],input[type="submit"],button',
    ),
  ].find((b) => (b.value || b.innerText).trim() === "검색");
  const filter = document.querySelector('select[name="srch_tp"]');
  const text = document.querySelector('input[name="srch_txt"]');
  const recipient =
    filter && [...filter.options].find((o) => o.text.trim() === "수신번호");
  if (!yOpt || !mo || !search || !recipient || !text) return false;
  year.value = yOpt.value;
  m.value = mo.value;
  filter.value = recipient.value;
  text.value = phone;
  search.click();
  return true;
}
export function historyRows(sender, phone) {
  if (
    location.origin !== "https://kt.shopling.co.kr" ||
    location.pathname !== "/cmpy/sms_list.phtml"
  )
    return null;
  const labels = [
    "NO.",
    "발송일자",
    "발신번호",
    "수신번호",
    "SMS내용",
    "구분",
    "전송상태",
    "발송자ID",
  ];
  const trs = [...document.querySelectorAll("tr")],
    cells = (tr) => [...tr.cells].map((c) => c.innerText.trim());
  const header = trs.find((tr) => {
    const c = cells(tr);
    return (
      c.length === labels.length &&
      c.every(
        (s, i) =>
          s.replace(/\s/g, "").toUpperCase() === labels[i].toUpperCase(),
      )
    );
  });
  if (
    !header ||
    trs.some(
      (tr) =>
        tr.cells.length === 1 && tr.innerText.trim() === "검색 버튼을 누르세요",
    )
  )
    return null;
  // Old Shopling layouts can render the header and body in sibling tables.
  return trs
    .filter(
      (tr) =>
        tr.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_PRECEDING,
    )
    .map(cells)
    .filter(
      (c) =>
        c.length === 8 &&
        /^\d+$/.test(c[0]) &&
        c[2].replace(/\D/g, "") === sender &&
        c[3].replace(/\D/g, "") === phone,
    );
}
async function reconcile(job, call, requestSession) {
  const at = Date.parse(job.at) + 9 * 3600000;
  const months = new Set(
    [-2000, 300000].map((offset) =>
      new Date(at + offset).toISOString().slice(0, 7),
    ),
  );
  const records = [];
  for (const month of months) {
    const page = await ownedTab(listUrl, async (session) => {
      if (
        !(await waitFor(() =>
          probe(session, searchSmsHistory, month, job.phone),
        ))
      )
        return null;
      return waitFor(() => probe(session, historyRows, job.sender, job.phone));
    });
    if (!page) {
      await requestSession?.(job.id);
      records.length = 0;
      break;
    }
    records.push(...page);
  }
  const result = matchHistory(records, job);
  await call({
    action: "history",
    id: job.id,
    attempt: job.attempt,
    ...result,
    bodyHash: createHash("sha256").update(job.body).digest("hex"),
  });
}
export async function prepareG6(job, handle, requestSession) {
  if ((await pages()).some((t) => t.url.split("?")[0] === popupUrl))
    return false;
  // G6 can open without a window.opener. Create the ordinary composition page
  // as an owned target and keep the same session through the single submission.
  return ownedTab(popupUrl, async (session) => {
    if (
      !(await waitFor(() =>
        probe(session, () =>
          Boolean(
            document.querySelector("#sms_smsg1") &&
              document.querySelector("#current_byte"),
          ),
        ),
      ))
    ) {
      await requestSession?.(job.id);
      return false;
    }
    const filled = await probe(session, smsForm, job, "fill");
    if (!filled.ok) return false;
    const valid = await probe(session, smsForm, job, "verify");
    if (!valid.ok) return false;
    return handle(
      valid.bytes,
      async () => {
        await session.send("Page.enable");
        const off = session.on("Page.javascriptDialogOpening", (e) => {
          const accept =
            e.url?.split("?")[0] === popupUrl &&
            (e.type === "alert" ||
              (e.type === "confirm" &&
                /발송|전송|보내/.test(e.message) &&
                !/충전|구매/.test(e.message)));
          session
            .send("Page.handleJavaScriptDialog", { accept })
            .catch(() => {});
        });
        try {
          await probe(session, smsForm, job, "submit");
          await delay(1500);
        } finally {
          off();
        }
      },
      valid.credits,
    );
  });
}
// A claim is durable before the first possible external submission. If either
// response is lost, only the G6 ledger may resolve the attempt on a later tick.
export async function dispatchRestockJob(
  job,
  call,
  storeReady,
  openG6,
  history = reconcile,
) {
  if (job.kind === "history") {
    await history(job, call);
    return;
  }
  const operatorTest =
    job.kind === "operator_test" &&
    job.mode === "pilot" &&
    job.product === null;
  if (job.kind !== "prepare" && !operatorTest) return;
  let claimed = false,
    claimStarted = false;
  let reason = "STORE";
  try {
    if (operatorTest || (await storeReady(job.product))) {
      reason = "SHOPLING";
      const handled = await openG6(job, async (bytes, submit, credits) => {
        if (
          operatorTest &&
          (!Number.isInteger(bytes) || bytes <= 0 || bytes > 90)
        ) {
          reason = "LENGTH";
          return false;
        }
        claimStarted = true;
        const r = await call({
          action: "claim",
          id: job.id,
          expires: job.expires,
          product: job.product,
          body: job.body,
          ticket: job.ticket,
          bytes,
          credits,
          purchasable: !operatorTest,
        });
        if (!r.claimed) return true;
        claimed = true;
        await submit();
        return true;
      });
      if (handled) return;
    }
  } finally {
    if (!claimed && !claimStarted)
      await call({ action: "defer", id: job.id, note: reason });
  }
}
export async function pollRestockSms(config, requestSession) {
  if (config.allowBusiness !== true) return;
  const endpoint = new URL("/api/restock-alerts/worker", config.endpoint);
  const call = async (data) => {
    const res = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(85000),
      headers: {
        authorization: "Bearer " + config.agentToken,
        "content-type": "application/json",
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("RESTOCK_WORKER");
    return res.json();
  };
  const { job } = await call({ action: "next" });
  if (job)
    await dispatchRestockJob(
      job,
      call,
      (p) =>
        ownedTab(p.url, (s) =>
          waitFor(() => probe(s, storefrontProbe, p), 12000),
        ),
      (job, handle) => prepareG6(job, handle, requestSession),
      (job, report) => reconcile(job, report, requestSession),
    );
}
