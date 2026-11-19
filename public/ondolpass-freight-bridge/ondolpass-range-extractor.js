(function initOndolpassFreightRangeExtractor(global) {
  "use strict";

  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const APPLICATION_NO_PATTERN = /^\d{4,20}$/;
  const MAX_APPLICATIONS = 500;

  function makeError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function dateValue(value) {
    if (!DATE_PATTERN.test(value)) return Number.NaN;
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp)) return Number.NaN;
    return new Date(timestamp).toISOString().slice(0, 10) === value
      ? timestamp
      : Number.NaN;
  }

  function extract(documentLike) {
    let sourceUrl;
    try {
      sourceUrl = new URL(String(documentLike.location && documentLike.location.href));
    } catch {
      throw makeError("DATE_RANGE_RESULT_INVALID");
    }
    const allowedHost =
      sourceUrl.hostname === "ondolpass.co.kr" ||
      sourceUrl.hostname === "www.ondolpass.co.kr";
    const startDate = sourceUrl.searchParams.get("s_date") || "";
    const endDate = sourceUrl.searchParams.get("e_date") || "";
    const startValue = dateValue(startDate);
    const endValue = dateValue(endDate);
    if (
      sourceUrl.protocol !== "https:" ||
      !allowedHost ||
      sourceUrl.pathname !== "/mypage/ship_lcl_list.php" ||
      sourceUrl.searchParams.get("date_type") !== "order_date" ||
      sourceUrl.searchParams.get("page_line") !== "500" ||
      !Number.isFinite(startValue) ||
      !Number.isFinite(endValue) ||
      startValue > endValue
    ) {
      throw makeError("DATE_RANGE_RESULT_INVALID");
    }

    const rows = Array.from(
      documentLike.querySelectorAll('div.row.order_list input[name="ckbox"]'),
    );
    if (rows.length >= MAX_APPLICATIONS) {
      throw makeError("DATE_RANGE_RESULT_TOO_LARGE");
    }

    const applications = rows.map((input) => {
      const applicationNo = String(input.value || "").trim();
      const row = input.closest("div.row.order_list");
      const applicationDate =
        String((row && row.innerText) || "").match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ||
        "";
      const applicationDateValue = dateValue(applicationDate);
      if (
        !APPLICATION_NO_PATTERN.test(applicationNo) ||
        !Number.isFinite(applicationDateValue) ||
        applicationDateValue < startValue ||
        applicationDateValue > endValue
      ) {
        throw makeError("DATE_RANGE_RESULT_INVALID");
      }
      return { applicationNo, applicationDate };
    });
    if (new Set(applications.map((row) => row.applicationNo)).size !== applications.length) {
      throw makeError("DATE_RANGE_RESULT_INVALID");
    }

    return {
      sourceUrl: sourceUrl.toString(),
      startDate,
      endDate,
      applications,
    };
  }

  global.OndolpassFreightRangeExtractor = { extract };
})(globalThis);
