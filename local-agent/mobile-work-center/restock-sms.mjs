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
function listButton(click) {
  if (
    location.href.split("?")[0] !==
    "https://kt.shopling.co.kr/cmpy/sms_list.phtml"
  )
    return false;
  const controls = [
    ...document.querySelectorAll('input[type="button"]'),
  ].filter((b) => b.value.trim() === "SMS 발송" && b.getClientRects().length);
  if (controls.length !== 1) return false;
  if (click) controls[0].click();
  return true;
}
function historyRows(month, sender, phone) {
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
  if (!year || !m) return null;
  if (
    Number(year.selectedOptions[0]?.text) !== Number(month.slice(0, 4)) ||
    Number(m.selectedOptions[0]?.text) !== Number(month.slice(5, 7))
  ) {
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
    if (yOpt && mo && search) {
      year.value = yOpt.value;
      m.value = mo.value;
      search.click();
    }
    return null;
  }
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
  if (!header) return null;
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
async function reconcile(job, call) {
  const at = Date.parse(job.at) + 9 * 3600000;
  const months = new Set(
    [-2000, 300000].map((offset) =>
      new Date(at + offset).toISOString().slice(0, 7),
    ),
  );
  const records = [];
  for (const month of months) {
    const page = await ownedTab(listUrl, (session) =>
      waitFor(() => probe(session, historyRows, month, job.sender, job.phone)),
    );
    if (!page) {
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
async function prepareG6(job, handle) {
  if ((await pages()).some((t) => t.url.split("?")[0] === popupUrl))
    return false;
  return ownedTab(listUrl, async (list) => {
    if (!(await waitFor(() => probe(list, listButton, false)))) return false;
    const { targetInfo: parent } = await list.send("Target.getTargetInfo");
    if (!(await probe(list, listButton, true))) return false;
    const popup = await waitFor(async () => {
      const { targetInfos } = await list.send("Target.getTargets");
      const matches = targetInfos.filter(
        (t) =>
          t.openerId === parent.targetId && t.url.split("?")[0] === popupUrl,
      );
      return matches.length === 1
        ? (await pages()).find((t) => t.id === matches[0].targetId)
        : null;
    });
    if (!popup) return false;
    try {
      return await withCdpTarget(popup, async (session) => {
        if (
          !(await waitFor(() =>
            probe(session, () =>
              Boolean(
                document.querySelector("#sms_smsg1") &&
                  document.querySelector("#current_byte"),
              ),
            ),
          ))
        )
          return false;
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
    } finally {
      await closeTab(popup.id);
    }
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
  if (job.kind !== "prepare") return;
  let claimed = false,
    claimStarted = false;
  let reason = "STORE";
  try {
    if (await storeReady(job.product)) {
      reason = "SHOPLING";
      const handled = await openG6(job, async (bytes, submit, credits) => {
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
          purchasable: true,
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
export async function pollRestockSms(config) {
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
      prepareG6,
    );
}
