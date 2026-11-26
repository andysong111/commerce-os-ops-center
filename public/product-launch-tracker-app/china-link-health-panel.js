const FULL_PANEL_MODULE = "./china-link-health-panel-full.js";
const BUTTON_ID = "china-link-health-lazy-open";
const MAX_INSTALL_ATTEMPTS = 60;
let installAttempt = 0;
let installTimer = null;
let fullPanelPromise = null;

function loadFullPanel(button) {
  if (!fullPanelPromise) {
    if (button) {
      button.disabled = true;
      button.textContent = "1688 링크 진단 불러오는 중…";
    }
    fullPanelPromise = import(FULL_PANEL_MODULE).catch((error) => {
      fullPanelPromise = null;
      console.error("China primary link health panel failed to load", error);
      if (button) {
        button.disabled = false;
        button.textContent = "1688 링크 진단 열기";
      }
      throw error;
    });
  }
  return fullPanelPromise;
}

function installButton() {
  const controls = document.querySelector(".bulk-controls");
  if (!controls) return false;
  if (document.querySelector(`#${BUTTON_ID}`)) return true;

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.className = "button button-ghost";
  button.textContent = "1688 링크 진단 열기";
  button.title = "발주용 1688 링크 상태를 확인합니다.";
  button.addEventListener("click", () => {
    void loadFullPanel(button).then(() => {
      button.remove();
    });
  });
  controls.append(button);
  return true;
}

function scheduleInstall() {
  if (installButton()) return;
  if (installAttempt >= MAX_INSTALL_ATTEMPTS) return;
  installAttempt += 1;
  installTimer = window.setTimeout(scheduleInstall, 100);
}

scheduleInstall();
window.addEventListener(
  "pagehide",
  () => {
    if (installTimer) window.clearTimeout(installTimer);
  },
  { once: true },
);
