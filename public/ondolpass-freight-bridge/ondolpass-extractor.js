(function installOndolpassFreightExtractor(globalScope) {
  "use strict";

  const APPLICATION_NO_PATTERN = /^\d{4,20}$/;
  const ITEM_ID_PATTERN = /^div_item_(\d+)$/;
  const MAX_ITEMS = 500;

  function applicationNoFromUrl(value) {
    try {
      const url = new URL(String(value || ""));
      const allowedHost =
        url.hostname === "ondolpass.co.kr" ||
        url.hostname === "www.ondolpass.co.kr";
      const applicationNo = url.searchParams.get("order_no") || "";
      if (
        url.protocol !== "https:" ||
        !allowedHost ||
        url.pathname !== "/order/order_view.php" ||
        !APPLICATION_NO_PATTERN.test(applicationNo)
      ) {
        return "";
      }
      return applicationNo;
    } catch {
      return "";
    }
  }

  function normalizeHttpUrl(value) {
    try {
      const url = new URL(String(value || ""), "https://www.ondolpass.co.kr");
      return url.protocol === "https:" || url.protocol === "http:"
        ? url.toString()
        : "";
    } catch {
      return "";
    }
  }

  function isProductImageUrl(value) {
    const url = normalizeHttpUrl(value);
    if (!url) return false;
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return (
        hostname === "alicdn.com" ||
        hostname.endsWith(".alicdn.com") ||
        hostname === "cbu01.alicdn.com" ||
        hostname === "img.alicdn.com"
      );
    } catch {
      return false;
    }
  }

  function productImageFromElement(element) {
    const images = Array.from(element.querySelectorAll("img"));
    for (const image of images) {
      const candidates = [
        image.currentSrc,
        image.src,
        image.getAttribute && image.getAttribute("data-src"),
      ];
      const found = candidates.find(isProductImageUrl);
      if (found) return normalizeHttpUrl(found);
    }
    return undefined;
  }

  function replaceTruncatedDetailUrl(text, element) {
    const link = element.querySelector(
      'a[href*="detail.1688.com/offer/"]',
    );
    const detailUrl = normalizeHttpUrl(link && link.href);
    const lines = String(text || "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!detailUrl) return lines.join("\n");

    const labelIndex = lines.findIndex((line) => /상품상세\s*url/i.test(line));
    if (labelIndex < 0) return lines.join("\n");
    const valueIndex = lines.findIndex(
      (line, index) => index > labelIndex && /^https?:\/\//i.test(line),
    );
    if (valueIndex >= 0) {
      lines[valueIndex] = detailUrl;
    } else {
      lines.splice(labelIndex + 1, 0, detailUrl);
    }
    return lines.join("\n");
  }

  function extract(documentLike) {
    const sourceUrl = String(
      (documentLike.location && documentLike.location.href) || "",
    );
    const applicationNo = applicationNoFromUrl(sourceUrl);
    if (!applicationNo) {
      const error = new Error("APPLICATION_NUMBER_MISMATCH");
      error.code = "APPLICATION_NUMBER_MISMATCH";
      throw error;
    }

    const bodyText = String(
      (documentLike.body && documentLike.body.innerText) || "",
    );
    const visibleApplicationNo =
      bodyText.match(/신청\s*번호\s*[:：]?\s*(\d{4,20})/i)?.[1] || "";
    if (visibleApplicationNo !== applicationNo) {
      const error = new Error("APPLICATION_NUMBER_MISMATCH");
      error.code = "APPLICATION_NUMBER_MISMATCH";
      throw error;
    }

    const items = Array.from(
      documentLike.querySelectorAll('[id^="div_item_"]'),
    )
      .map((element) => {
        const match = String(element.id || "").match(ITEM_ID_PATTERN);
        if (!match) return undefined;
        const rowNo = Number(match[1]);
        if (!Number.isInteger(rowNo) || rowNo < 1 || rowNo > MAX_ITEMS) {
          return undefined;
        }
        return {
          rowNo,
          text: replaceTruncatedDetailUrl(element.innerText, element),
          imageUrl: productImageFromElement(element),
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.rowNo - right.rowNo);

    if (!items.length) {
      const error = new Error("APPLICATION_NOT_FOUND_OR_EMPTY");
      error.code = "APPLICATION_NOT_FOUND_OR_EMPTY";
      throw error;
    }

    return { applicationNo, sourceUrl, items };
  }

  globalScope.OndolpassFreightExtractor = {
    applicationNoFromUrl,
    extract,
    replaceTruncatedDetailUrl,
  };
})(globalThis);
