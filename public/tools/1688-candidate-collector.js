(() => {
  const MAX_ITEMS = 80;

  const detailUrlPattern = /https?:\/\/[^\s"']*detail\.1688\.com\/offer\/[^\s"']+/i;
  const pricePatterns = [
    /[¥￥]\s*(\d+(?:\.\d+)?)/,
    /(?:价格|单价|价)\s*[:：]?\s*(\d+(?:\.\d+)?)/,
    /(\d+(?:\.\d+)?)\s*元/,
  ];
  const moqPatterns = [
    /(?:起订量|起批量|起订|起批)\s*[:：]?\s*(\d+)/,
    /(\d+)\s*(?:件|个)\s*(?:起订|起批|起)/,
  ];

  function cleanUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      if (!detailUrlPattern.test(url.href)) return "";
      url.hash = "";
      return url.href;
    } catch {
      return "";
    }
  }

  function readNumber(text, patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) return Number(match[1]);
    }
    return 0;
  }

  function getCardElement(anchor) {
    let node = anchor;
    for (let depth = 0; depth < 7 && node; depth += 1) {
      const text = node.innerText || "";
      const links = node.querySelectorAll?.('a[href*="detail.1688.com"]') ?? [];
      if (text.length > 20 && links.length <= 8) return node;
      node = node.parentElement;
    }
    return anchor;
  }

  function getTitle(anchor, card) {
    const candidates = [
      anchor.getAttribute("title"),
      anchor.getAttribute("aria-label"),
      anchor.innerText,
      card.querySelector?.('[title]')?.getAttribute("title"),
      card.innerText,
    ];

    for (const value of candidates) {
      const line = String(value || "")
        .split("\n")
        .map((item) => item.trim())
        .find((item) => item.length >= 4 && !detailUrlPattern.test(item));
      if (line) return line.slice(0, 120);
    }
    return "";
  }

  function getImage(card) {
    const img = card.querySelector?.("img");
    const raw = img?.currentSrc || img?.src || img?.getAttribute?.("data-src") || "";
    if (!raw) return "";
    try {
      return new URL(raw, window.location.href).href;
    } catch {
      return raw;
    }
  }

  const anchors = Array.from(document.querySelectorAll('a[href*="detail.1688.com"]'));
  const map = new Map();

  for (const anchor of anchors) {
    const url = cleanUrl(anchor.href || anchor.getAttribute("href") || "");
    if (!url || map.has(url)) continue;

    const card = getCardElement(anchor);
    const text = card.innerText || "";
    const title = getTitle(anchor, card);
    const imageUrl = getImage(card);
    const unitPriceCny = readNumber(text, pricePatterns);
    const moq = readNumber(text, moqPatterns) || 1;

    map.set(url, {
      url,
      titleCn: title,
      titleKr: "",
      imageUrl,
      unitPriceCny,
      moq,
      chinaShippingFeeCny: 0,
      optionsText: "",
      shopName: "",
      notes: "collected-from-browser",
    });

    if (map.size >= MAX_ITEMS) break;
  }

  const candidates = Array.from(map.values());
  const payload = JSON.stringify({ candidates }, null, 2);

  navigator.clipboard
    .writeText(payload)
    .then(() => {
      window.alert(`1688 후보 ${candidates.length}개를 클립보드에 복사했습니다. OPS CENTER 소싱엔진 일괄 파서에 붙여넣으세요.`);
    })
    .catch(() => {
      console.log(payload);
      window.alert("클립보드 복사 실패. 콘솔에 JSON을 출력했습니다.");
    });
})();
