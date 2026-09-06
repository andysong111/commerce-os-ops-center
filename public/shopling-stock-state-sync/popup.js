const value = document.getElementById("value");
const stage = document.getElementById("stage");
const stop = document.getElementById("stop");
const open = document.getElementById("open");
const title = document.getElementById("title");

if (title) {
  title.textContent = `품절·판매중 동기화 v${chrome.runtime.getManifest().version}`;
}

function statusKorean(status) {
  return status === "SOLD_OUT" ? "품절" : "판매중";
}

async function refresh() {
  const response = await chrome.runtime
    .sendMessage({ type: "STOCK_SYNC_GET_STATUS" })
    .catch(() => null);
  const active = response?.active;
  if (active?.status === "RUNNING") {
    value.textContent = `${active.job?.barcode || "B코드"} → ${statusKorean(active.job?.desiredStatus)}`;
    value.className = "value warn";
    stage.textContent = `${active.stage || "STARTING"} · ${active.message || "진행 중"}`;
    stop.disabled = false;
    return;
  }
  const last = response?.lastResult;
  if (last) {
    value.textContent = `${last.job?.barcode || "최근 작업"} · ${last.outcome}`;
    value.className = last.outcome === "SUCCEEDED" ? "value ok" : "value warn";
    stage.textContent = last.message || "최근 결과";
  } else {
    value.textContent = "대기 중";
    value.className = "value ok";
    stage.textContent = "Commerce OS 재고·품절·재입고 화면에서 1건 안전 실행하세요.";
  }
  stop.disabled = true;
}

open.addEventListener("click", async () => {
  const url = "https://commerce-os-ops-center.vercel.app/china-order-manager/stock-control";
  const tabs = await chrome.tabs.query({ url: "https://commerce-os-ops-center.vercel.app/*" });
  const tab = tabs[0];
  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true, url });
    if (Number.isInteger(tab.windowId)) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url, active: true });
  }
  window.close();
});

stop.addEventListener("click", async () => {
  stop.disabled = true;
  await chrome.runtime.sendMessage({ type: "STOCK_SYNC_STOP" }).catch(() => null);
  await refresh();
});

void refresh();
setInterval(() => void refresh(), 1000);
