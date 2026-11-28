// These probes run only inside the worker's own, origin-bound tabs.
export function storefrontProbe(product) {
  const url = new URL(location.href);
  const id =
    url.searchParams.get("product_no") ||
    url.pathname.match(/^\/product\/[^/]+\/(\d+)(?:\/|$)/)?.[1];
  if (
    url.protocol !== "https:" ||
    ![
      "dosomesaurus.com",
      "www.dosomesaurus.com",
      "andy801.cafe24.com",
      "m.dosomesaurus.com",
    ].includes(url.host) ||
    id !== product.number
  )
    return false;
  const visible = (e) =>
    Boolean(
      e &&
        e.getClientRects().length &&
        getComputedStyle(e).visibility === "visible" &&
        !e.disabled &&
        e.getAttribute("aria-disabled") !== "true",
    );
  const clean = (s) =>
    s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  const choices = [
    ...document.querySelectorAll('select[id^="product_option_id"]'),
  ].filter(visible);
  if (choices.length !== product.options.length) return false;
  for (const [i, select] of choices.entries()) {
    const matches = [...select.options].filter(
      (o) =>
        !o.disabled &&
        !/품절|sold\s*out/i.test(o.text) &&
        clean(o.text.replace(/\s*\([+-][\d,]+원\)$/, "")) ===
          clean(product.options[i]) &&
        o.value &&
        !o.value.startsWith("*"),
    );
    if (matches.length !== 1) return false;
    if (select.value !== matches[0].value) {
      select.value = matches[0].value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return false;
    }
  }
  const buy = [
    ...document.querySelectorAll(
      '.action_button a.btnSubmit, #actionBuy, a[onclick*="product_submit(1,"]',
    ),
  ].filter(
    (e) =>
      visible(e) &&
      /buy it now|바로\s*구매|구매하기|구매하기/i.test(e.innerText),
  );
  if (!buy.length) return false;
  if (!choices.length) {
    const qty = [
      ...document.querySelectorAll(
        'input#quantity,input[name="quantity"],input.quantity_opt',
      ),
    ].filter(visible);
    return Boolean(
      document.querySelector("h1,h2") &&
        qty.length === 1 &&
        Number(qty[0].value) > 0 &&
        ![...document.querySelectorAll(".soldout,.soldoutButton")].some(
          visible,
        ),
    );
  }
  const selected = [...document.querySelectorAll("tr.option_product")].filter(
    visible,
  );
  if (selected.length !== 1 || /품절|sold\s*out/i.test(selected[0].innerText))
    return false;
  const line =
    selected[0]
      .querySelector(".product span, .product .option")
      ?.textContent?.replace(/^\s*-\s*/, "")
      .trim() ||
    selected[0].innerText
      .split("\n")
      .find((s) => s.trim().startsWith("-"))
      ?.replace(/^\s*-\s*/, "")
      .trim();
  const expected = product.options.map(clean);
  const exact =
    line &&
    [expected.join("/"), expected.join(" / "), expected.join(" - ")].includes(
      clean(line),
    );
  return Boolean(
    exact &&
      Number(selected[0].querySelector("input.quantity_opt")?.value) > 0 &&
      selected[0].querySelector("input.option_box_id")?.value,
  );
}

export function smsForm(job, action) {
  if (
    location.origin !== "https://kt.shopling.co.kr" ||
    location.pathname !== "/cmpy/sms_send_popup.phtml"
  )
    return { ok: false };
  const sender = document.querySelector('select[name="sms_send_num"]'),
    body = document.querySelector("textarea#sms_smsg1"),
    phones = [
      ...document.querySelectorAll('input[type="text"][name="rcv_num[]"]'),
    ],
    buffer = document.querySelector("#send_num_list"),
    buttons = [
      ...document.querySelectorAll('input[type="button"][value="보내기"]'),
    ];
  if (
    !sender ||
    !body ||
    !phones.length ||
    !buffer ||
    buttons.length !== 1 ||
    buttons[0].disabled ||
    !buttons[0].getClientRects().length ||
    buffer.value.trim() ||
    phones.slice(1).some((p) => p.value.trim()) ||
    !/^010\d{8}$/.test(job.phone) ||
    !/^010\d{8}$/.test(job.sender)
  )
    return { ok: false };
  const digits = (s) => s.replace(/\D/g, "");
  const choices = [...sender.options].filter(
    (o) => !o.disabled && digits(o.text) === job.sender,
  );
  if (choices.length !== 1) return { ok: false };
  if (action === "fill") {
    if (body.value || phones[0].value) return { ok: false };
    sender.value = choices[0].value;
    sender.dispatchEvent(new Event("change", { bubbles: true }));
    phones[0].value = job.phone;
    phones[0].dispatchEvent(new Event("input", { bubbles: true }));
    body.value = job.body;
    body.dispatchEvent(new Event("input", { bubbles: true }));
    body.dispatchEvent(
      new KeyboardEvent("keyup", { bubbles: true, key: "End" }),
    );
  }
  if (
    sender.selectedOptions[0] !== choices[0] ||
    digits(phones[0].value) !== job.phone ||
    body.value !== job.body
  )
    return { ok: false };
  const bytes = Number(
    document
      .querySelector("#current_byte")
      ?.textContent.trim()
      .replaceAll(",", ""),
  );
  const credits =
    sender.parentElement?.parentElement?.innerText.match(
      /([\d,]+)\s*건\s*발신번호/,
    );
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > 2000)
    return { ok: false, note: "LENGTH" };
  if (!credits || Number(credits[1].replaceAll(",", "")) < (bytes > 90 ? 3 : 1))
    return { ok: false };
  if (action === "submit") buttons[0].click();
  return { ok: true, bytes, credits: Number(credits[1].replaceAll(",", "")) };
}

export function matchHistory(records, job) {
  const at = Date.parse(job.at);
  const text = (s) => s.replace(/\r/g, "").replace(/\s+/g, " ").trim();
  const digits = (s) => s.replace(/\D/g, "");
  const matches = records.filter((c) => {
    if (!/^\d+$/.test(c[0]) || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(c[1]))
      return false;
    const time = Date.parse(c[1].replace(" ", "T") + "+09:00");
    return (
      time >= at - 2000 &&
      time <= at + 5 * 60000 &&
      digits(c[2]) === job.sender &&
      digits(c[3]) === job.phone &&
      text(c[4]) === text(job.body)
    );
  });
  if (matches.length > 1) return { outcome: "AMBIGUOUS" };
  if (
    matches.length === 1 &&
    matches[0][6] === "성공" &&
    ["단문", "장문"].includes(matches[0][5])
  )
    return {
      outcome: "MATCH",
      receipt: matches[0][0],
      sentAt: matches[0][1],
      messageType: matches[0][5],
    };
  return {
    outcome:
      matches.length === 1 && matches[0][6].includes("실패")
        ? "FAILED"
        : "MISSING",
  };
}
