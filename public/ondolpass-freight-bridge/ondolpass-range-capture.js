(function captureOndolpassFreightDateRange() {
  "use strict";

  try {
    return {
      ok: true,
      payload: globalThis.OndolpassFreightRangeExtractor.extract(document),
    };
  } catch (error) {
    return {
      ok: false,
      errorCode:
        error && typeof error.code === "string"
          ? error.code
          : "DATE_RANGE_RESULT_INVALID",
    };
  }
})();
