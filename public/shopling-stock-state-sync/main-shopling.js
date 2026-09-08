(() => {
  const REQUEST_EVENT = "commerce-os-stock-main-click";
  const RESULT_EVENT = "commerce-os-stock-main-click-result";
  const ALERT_EVENT = "commerce-os-stock-main-alert";
  const TOKEN_ATTRIBUTE = "data-commerce-os-stock-click-token";
  const LEGACY_ACTION_ATTRIBUTE = "data-commerce-os-stock-legacy-action-label";

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

  annotateLegacyA21ActionButtons(document);
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
  });
  legacyActionObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["alt", "title"],
  });

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