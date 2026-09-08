(() => {
  const REQUEST_EVENT = "commerce-os-stock-main-click";
  const RESULT_EVENT = "commerce-os-stock-main-click-result";
  const ALERT_EVENT = "commerce-os-stock-main-alert";
  const TOKEN_ATTRIBUTE = "data-commerce-os-stock-click-token";
  const LEGACY_ACTION_ATTRIBUTE = "data-commerce-os-stock-legacy-action-label";
  const A21_PRICE_ROW_BRIDGE = "data-commerce-os-a21-price-row-bridge";

  const text = (value) =>
    String(value ?? "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();

  const bodyText = () => text(document.body?.innerText || document.body?.textContent || "");

  function annotateLegacyA21ActionButtons(root = document) {
    const images = [];
    if (root instanceof Element && root.matches("img[alt],img[title]")) images.push(root);
    if (root?.querySelectorAll) images.push(...root.querySelectorAll("img[alt],img[title]"));

    for (const image of images) {
      const label = text([
        image.getAttribute("alt"),
        image.getAttribute("title"),
      ].filter(Boolean).join(" "));
      if (!/상품\s*수정전송/i.test(label)) continue;
      const clickable = image.closest("a,button,input,[onclick]");
      if (!clickable) continue;
      if (!text(clickable.getAttribute("aria-label"))) clickable.setAttribute("aria-label", "상품 수정전송");
      clickable.setAttribute(LEGACY_ACTION_ATTRIBUTE, label || "상품 수정전송");
    }
  }

  function elementRect(node) {
    try {
      return node?.getBoundingClientRect?.() || null;
    } catch {
      return null;
    }
  }

  function selectOptionByLabel(select, wanted) {
    if (!(select instanceof HTMLSelectElement)) return false;
    const option = [...select.options].find((item) => text(item.textContent) === wanted)
      || [...select.options].find((item) => text(item.textContent).includes(wanted));
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return text(select.options?.[select.selectedIndex]?.textContent) === wanted;
  }

  function ensureA21WholeInfo(table) {
    const candidates = [...document.querySelectorAll("select")].filter((select) => {
      const labels = [...select.options].map((option) => text(option.textContent));
      return labels.includes("선택정보") && labels.includes("전체정보");
    });
    if (!candidates.length) return false;

    const tableRect = elementRect(table);
    if (tableRect) {
      candidates.sort((left, right) => {
        const lr = elementRect(left);
        const rr = elementRect(right);
        const ld = lr ? Math.abs(lr.bottom - tableRect.top) : Number.MAX_SAFE_INTEGER;
        const rd = rr ? Math.abs(rr.bottom - tableRect.top) : Number.MAX_SAFE_INTEGER;
        return ld - rd;
      });
    }

    const target = candidates[0];
    const current = text(target.options?.[target.selectedIndex]?.textContent);
    return current === "전체정보" || selectOptionByLabel(target, "전체정보");
  }

  // This is intentionally the same checkbox mutation sequence used by the proven
  // A21 price-adjustment extension: real click first, then checked assignment,
  // then input/change events. Do not replace this with header-select emulation.
  function setCheckboxLikePriceExtension(checkbox, checked = true) {
    if (!(checkbox instanceof HTMLInputElement) || checkbox.type !== "checkbox" || checkbox.disabled) return false;
    try {
      if (checked && !checkbox.checked) checkbox.click();
      if (!checked && checkbox.checked) checkbox.click();
      checkbox.checked = checked;
      checkbox.dispatchEvent(new Event("input", { bubbles: true }));
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      return checkbox.checked === checked;
    } catch {
      return false;
    }
  }

  function isA21ListContext() {
    const page = bodyText();
    return /상품\s*수정전송/i.test(page)
      && /샵플링상품코드/i.test(page)
      && (/쇼핑몰상품수정/i.test(page) || /검색항목/i.test(page));
  }

  function resultCheckboxes(table) {
    return [...table.querySelectorAll('input[type="checkbox"]')]
      .filter((checkbox) => checkbox instanceof HTMLInputElement)
      .filter((checkbox) => !checkbox.disabled && !checkbox.hasAttribute(A21_PRICE_ROW_BRIDGE));
  }

  function looksLikeA21ResultTable(table, boxes) {
    if (!boxes.length) return false;
    const evidence = text(table.innerText || table.textContent || "");
    if (!/샵플링상품코드|쇼핑몰ID|상품명|판매상태/i.test(evidence)) return false;
    return boxes.some((checkbox) => {
      const row = checkbox.closest("tr");
      const rowText = text(row?.innerText || row?.textContent || "");
      return /\b\d{4,}\b/.test(rowText);
    });
  }

  function installA21PriceRowBridge(root = document) {
    if (!isA21ListContext()) return;
    const tables = [];
    if (root instanceof HTMLTableElement) tables.push(root);
    if (root?.querySelectorAll) tables.push(...root.querySelectorAll("table"));

    for (const table of [...new Set(tables)]) {
      const boxes = resultCheckboxes(table);
      if (!looksLikeA21ResultTable(table, boxes)) continue;

      let bridge = table.querySelector(`input[${A21_PRICE_ROW_BRIDGE}="1"]`);
      if (!(bridge instanceof HTMLInputElement)) {
        const anchor = boxes.find((box) => {
          const rect = elementRect(box);
          return rect && rect.width > 0 && rect.height > 0;
        }) || boxes[0];
        if (!anchor?.parentElement) continue;

        bridge = document.createElement("input");
        bridge.type = "checkbox";
        bridge.name = "commerce_os_a21_select_all_check";
        bridge.id = `commerce-os-a21-price-row-${Math.random().toString(36).slice(2)}`;
        bridge.className = "commerce-os-a21-price-row check select-all";
        bridge.setAttribute(A21_PRICE_ROW_BRIDGE, "1");
        bridge.setAttribute("aria-label", "전체 선택");
        bridge.style.width = "1px";
        bridge.style.height = "1px";
        bridge.style.opacity = "0.001";
        bridge.style.margin = "0";
        bridge.style.padding = "0";
        bridge.style.pointerEvents = "none";
        bridge.style.verticalAlign = "middle";
        anchor.parentElement.insertBefore(bridge, anchor);
      }

      const syncBridge = () => {
        const current = resultCheckboxes(table);
        bridge.checked = current.length > 0 && current.every((checkbox) => checkbox.checked);
      };
      syncBridge();

      if (bridge.dataset.commerceOsPriceBound !== "1") {
        bridge.dataset.commerceOsPriceBound = "1";
        bridge.addEventListener("click", () => {
          ensureA21WholeInfo(table);
          const liveBoxes = resultCheckboxes(table);
          for (const checkbox of liveBoxes) setCheckboxLikePriceExtension(checkbox, true);
          ensureA21WholeInfo(table);
          syncBridge();
          window.setTimeout(syncBridge, 30);
          window.setTimeout(syncBridge, 120);
          window.setTimeout(syncBridge, 300);
        });
      }

      for (const checkbox of boxes) {
        if (checkbox.dataset.commerceOsPriceSync === "1") continue;
        checkbox.dataset.commerceOsPriceSync = "1";
        checkbox.addEventListener("change", syncBridge);
      }
    }
  }

  annotateLegacyA21ActionButtons(document);
  installA21PriceRowBridge(document);

  let refreshQueued = false;
  const refresh = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    window.setTimeout(() => {
      refreshQueued = false;
      annotateLegacyA21ActionButtons(document);
      installA21PriceRowBridge(document);
    }, 35);
  };

  const observer = new MutationObserver(() => refresh());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["alt", "title", "value"],
  });
  window.addEventListener("load", refresh, { once: true });

  const browserAlert = window.alert.bind(window);
  window.alert = (message) => {
    const normalized = text(message);
    window.dispatchEvent(new CustomEvent(ALERT_EVENT, {
      detail: {
        message: normalized,
        href: String(location.href || ""),
        title: String(document.title || ""),
      },
    }));
    return browserAlert(message);
  };

  window.addEventListener(REQUEST_EVENT, (event) => {
    const token = text(event?.detail?.token);
    if (!token) return;
    const selector = `[${TOKEN_ATTRIBUTE}="${CSS.escape(token)}"]`;
    const target = document.querySelector(selector);
    if (!target) {
      window.dispatchEvent(new CustomEvent(RESULT_EVENT, {
        detail: { token, ok: false, code: "MAIN_CLICK_TARGET_NOT_FOUND" },
      }));
      return;
    }

    const originalConfirm = window.confirm;
    const originalAlert = window.alert;
    const alerts = [];
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      window.confirm = originalConfirm;
      window.alert = originalAlert;
      target.removeAttribute(TOKEN_ATTRIBUTE);
    };

    try {
      window.confirm = () => true;
      window.alert = (message) => { alerts.push(text(message)); };
      if (target instanceof HTMLElement) {
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        target.click();
      } else {
        target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(RESULT_EVENT, {
          detail: {
            token,
            ok: true,
            alerts,
            href: String(location.href || ""),
            title: String(document.title || ""),
          },
        }));
        restore();
      }, 1200);
      window.setTimeout(restore, 4000);
    } catch (error) {
      restore();
      window.dispatchEvent(new CustomEvent(RESULT_EVENT, {
        detail: {
          token,
          ok: false,
          code: "MAIN_CLICK_FAILED",
          message: text(error?.message || error),
          alerts,
        },
      }));
    }
  });
})();