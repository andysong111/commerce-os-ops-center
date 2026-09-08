(() => {
  const REQUEST_EVENT = "commerce-os-stock-main-click";
  const RESULT_EVENT = "commerce-os-stock-main-click-result";
  const ALERT_EVENT = "commerce-os-stock-main-alert";
  const TOKEN_ATTRIBUTE = "data-commerce-os-stock-click-token";
  const LEGACY_ACTION_ATTRIBUTE = "data-commerce-os-stock-legacy-action-label";
  const A21_SELECT_ALL_BRIDGE = "data-commerce-os-a21-select-all-bridge";
  const A21_SELECT_ALL_SOURCE = "data-commerce-os-a21-select-all-source";

  const text = (value) =>
    String(value ?? "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();

  function annotateLegacyA21ActionButtons(root = document) {
    const images = [];
    if (root instanceof Element && root.matches("img[alt],img[title]")) {
      images.push(root);
    }
    if (root?.querySelectorAll) {
      images.push(...root.querySelectorAll("img[alt],img[title]"));
    }

    for (const image of images) {
      const label = text(
        [image.getAttribute("alt"), image.getAttribute("title")]
          .filter(Boolean)
          .join(" "),
      );
      if (!/상품\s*수정전송/i.test(label)) continue;

      const clickable = image.closest("a,button,input,[onclick]");
      if (!clickable) continue;

      if (!text(clickable.getAttribute("aria-label"))) {
        clickable.setAttribute("aria-label", "상품 수정전송");
      }
      clickable.setAttribute(
        LEGACY_ACTION_ATTRIBUTE,
        label || "상품 수정전송",
      );
    }
  }

  function elementRect(node) {
    try {
      return node?.getBoundingClientRect?.() || null;
    } catch {
      return null;
    }
  }

  function actionableLegacyControl(node) {
    if (!(node instanceof Element)) return null;
    if (node.hasAttribute(A21_SELECT_ALL_BRIDGE)) return null;
    if (node.matches('button,input[type="button"],input[type="submit"],input[type="image"],a,[onclick]')) {
      return node;
    }
    return node.closest('a,button,input,[onclick]') || (node instanceof HTMLElement ? node : null);
  }

  function rowSelectionCheckboxes(table, headerCell) {
    const headerRect = elementRect(headerCell);
    if (!headerRect) return [];
    const headerCenter = headerRect.left + headerRect.width / 2;
    const candidates = [...table.querySelectorAll('input[type="checkbox"]')]
      .filter((checkbox) => checkbox instanceof HTMLInputElement)
      .filter((checkbox) => !checkbox.disabled && !checkbox.hasAttribute(A21_SELECT_ALL_BRIDGE))
      .filter((checkbox) => !headerCell.contains(checkbox))
      .map((checkbox) => ({ checkbox, rect: elementRect(checkbox) }))
      .filter((entry) => entry.rect && entry.rect.top >= headerRect.top - 2)
      .filter((entry) => {
        const center = entry.rect.left + entry.rect.width / 2;
        const insideHeaderColumn = center >= headerRect.left - 8 && center <= headerRect.right + 8;
        return insideHeaderColumn || Math.abs(center - headerCenter) <= 28;
      })
      .sort((left, right) => left.rect.top - right.rect.top);
    return candidates.map((entry) => entry.checkbox);
  }

  function headerLegacySelectSource(table, headerCell, rowBoxes) {
    const headerRect = elementRect(headerCell);
    if (!headerRect) return null;
    const rowBoxSet = new Set(rowBoxes);
    const selectors = 'input[type="image"],input[type="button"],input[type="submit"],button,a,[onclick],img,span';
    const ranked = [];
    const seen = new Set();
    const push = (node, base = 0) => {
      const target = actionableLegacyControl(node);
      if (!target || seen.has(target) || rowBoxSet.has(target)) return;
      if (target.hasAttribute?.(A21_SELECT_ALL_BRIDGE)) return;
      const rect = elementRect(target);
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const centerX = rect.left + rect.width / 2;
      const headerCenterX = headerRect.left + headerRect.width / 2;
      let score = base;
      if (target instanceof HTMLInputElement && target.type === "image") score += 6000;
      if (target.hasAttribute?.("onclick")) score += 5000;
      if (target.matches?.("a,button")) score += 4000;
      if (target instanceof HTMLImageElement) score += 3000;
      if (centerX >= headerRect.left - 8 && centerX <= headerRect.right + 8) score += 5000;
      score += Math.max(0, 2500 - Math.abs(centerX - headerCenterX) * 60);
      if (rect.width <= 48 && rect.height <= 48) score += 1200;
      const label = text(`${target.getAttribute?.("title") || ""} ${target.getAttribute?.("alt") || ""} ${target.getAttribute?.("onclick") || ""} ${target.className || ""} ${target.id || ""}`);
      if (/선택|전체|all|check|select/i.test(label)) score += 1500;
      seen.add(target);
      ranked.push({ target, score });
    };

    for (const node of headerCell.querySelectorAll(selectors)) push(node, 10000);
    if (headerCell.matches?.("[onclick]")) push(headerCell, 9000);

    const headerRow = headerCell.closest("tr");
    if (headerRow) {
      for (const node of headerRow.querySelectorAll(selectors)) {
        const rect = elementRect(node);
        if (!rect) continue;
        const centerX = rect.left + rect.width / 2;
        if (centerX < headerRect.left - 18 || centerX > headerRect.right + 18) continue;
        push(node, 4000);
      }
    }

    ranked.sort((left, right) => right.score - left.score);
    return ranked[0]?.target || null;
  }

  function clickLegacyControl(target) {
    if (!(target instanceof Element)) return false;
    try {
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      if (target instanceof HTMLElement) target.click();
      else target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch {
      return false;
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
    const candidates = [...document.querySelectorAll("select")]
      .filter((select) => {
        const labels = [...select.options].map((option) => text(option.textContent));
        return labels.includes("선택정보") && labels.includes("전체정보");
      });
    if (!candidates.length) return false;

    const tableRect = elementRect(table);
    if (tableRect) {
      candidates.sort((left, right) => {
        const lr = elementRect(left);
        const rr = elementRect(right);
        const leftDistance = lr ? Math.abs(lr.bottom - tableRect.top) + Math.max(0, lr.top - tableRect.top) * 3 : Number.MAX_SAFE_INTEGER;
        const rightDistance = rr ? Math.abs(rr.bottom - tableRect.top) + Math.max(0, rr.top - tableRect.top) * 3 : Number.MAX_SAFE_INTEGER;
        return leftDistance - rightDistance;
      });
    }

    const target = candidates[0];
    const current = text(target.options?.[target.selectedIndex]?.textContent);
    return current === "전체정보" || selectOptionByLabel(target, "전체정보");
  }

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

  function installA21HeaderSelectBridge(root = document) {
    const tables = [];
    if (root instanceof HTMLTableElement) tables.push(root);
    if (root?.querySelectorAll) tables.push(...root.querySelectorAll("table"));

    for (const table of [...new Set(tables)]) {
      const headerCells = [...table.querySelectorAll("th,td")]
        .filter((cell) => {
          const label = text(cell.textContent || "");
          return label === "선택" || (label.startsWith("선택 ") && label.length <= 12);
        });

      for (const headerCell of headerCells) {
        const rowBoxes = rowSelectionCheckboxes(table, headerCell);
        if (!rowBoxes.length) continue;
        const source = headerLegacySelectSource(table, headerCell, rowBoxes);
        if (source) source.setAttribute(A21_SELECT_ALL_SOURCE, "1");

        let bridge = headerCell.querySelector(`input[${A21_SELECT_ALL_BRIDGE}="1"]`);
        if (!(bridge instanceof HTMLInputElement)) {
          bridge = document.createElement("input");
          bridge.type = "checkbox";
          bridge.id = `commerce-os-a21-select-all-${Math.random().toString(36).slice(2)}`;
          bridge.name = "commerce_os_a21_select_all_check";
          bridge.className = "commerce-os-a21-select-all check select-all";
          bridge.setAttribute(A21_SELECT_ALL_BRIDGE, "1");
          bridge.setAttribute("aria-label", "전체 선택");
          bridge.style.width = "1px";
          bridge.style.height = "1px";
          bridge.style.opacity = "0.001";
          bridge.style.margin = "0";
          bridge.style.padding = "0";
          bridge.style.pointerEvents = "none";
          bridge.style.verticalAlign = "middle";
          headerCell.appendChild(bridge);
        }

        const syncBridge = () => {
          const current = rowSelectionCheckboxes(table, headerCell);
          bridge.checked = current.length > 0 && current.every((checkbox) => checkbox.checked);
        };
        syncBridge();

        if (bridge.dataset.commerceOsBound !== "1") {
          bridge.dataset.commerceOsBound = "1";
          bridge.addEventListener("click", () => {
            const liveRows = rowSelectionCheckboxes(table, headerCell);
            ensureA21WholeInfo(table);

            let rowSelectionOk = liveRows.length > 0;
            for (const checkbox of liveRows) {
              if (!setCheckboxLikePriceExtension(checkbox, true)) rowSelectionOk = false;
            }
            ensureA21WholeInfo(table);

            if (!rowSelectionOk || !liveRows.every((checkbox) => checkbox.checked)) {
              const liveSource = headerLegacySelectSource(table, headerCell, liveRows) || source;
              if (liveSource) clickLegacyControl(liveSource);
            }

            const settle = () => {
              ensureA21WholeInfo(table);
              syncBridge();
            };
            window.setTimeout(settle, 20);
            window.setTimeout(settle, 80);
            window.setTimeout(settle, 180);
            window.setTimeout(settle, 450);
          });
        }

        for (const checkbox of rowBoxes) {
          if (checkbox.dataset.commerceOsSelectSync === "1") continue;
          checkbox.dataset.commerceOsSelectSync = "1";
          checkbox.addEventListener("change", syncBridge);
        }
      }
    }
  }

  annotateLegacyA21ActionButtons(document);
  installA21HeaderSelectBridge(document);
  let bridgeRefreshQueued = false;
  const refreshA21Bridge = () => {
    if (bridgeRefreshQueued) return;
    bridgeRefreshQueued = true;
    window.setTimeout(() => {
      bridgeRefreshQueued = false;
      installA21HeaderSelectBridge(document);
    }, 40);
  };

  const legacyActionObserver = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        annotateLegacyA21ActionButtons(record.target);
        continue;
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element) annotateLegacyA21ActionButtons(node);
      }
    }
    refreshA21Bridge();
  });
  legacyActionObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["alt", "title"],
  });
  window.addEventListener("load", refreshA21Bridge, { once: true });

  const browserAlert = window.alert.bind(window);
  window.alert = (message) => {
    const normalized = text(message);
    window.dispatchEvent(
      new CustomEvent(ALERT_EVENT, {
        detail: {
          message: normalized,
          href: String(location.href || ""),
          title: String(document.title || ""),
        },
      }),
    );
    return browserAlert(message);
  };

  window.addEventListener(REQUEST_EVENT, (event) => {
    const token = text(event?.detail?.token);
    if (!token) return;
    const selector = `[${TOKEN_ATTRIBUTE}="${CSS.escape(token)}"]`;
    const target = document.querySelector(selector);
    if (!target) {
      window.dispatchEvent(
        new CustomEvent(RESULT_EVENT, {
          detail: { token, ok: false, code: "MAIN_CLICK_TARGET_NOT_FOUND" },
        }),
      );
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
      window.alert = (message) => {
        alerts.push(text(message));
      };
      if (target instanceof HTMLElement) {
        target.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
        target.dispatchEvent(
          new MouseEvent("mouseup", {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
        target.click();
      } else {
        target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent(RESULT_EVENT, {
            detail: {
              token,
              ok: true,
              alerts,
              href: String(location.href || ""),
              title: String(document.title || ""),
            },
          }),
        );
        restore();
      }, 1200);
      window.setTimeout(restore, 4000);
    } catch (error) {
      restore();
      window.dispatchEvent(
        new CustomEvent(RESULT_EVENT, {
          detail: {
            token,
            ok: false,
            code: "MAIN_CLICK_FAILED",
            message: text(error?.message || error),
            alerts,
          },
        }),
      );
    }
  });
})();