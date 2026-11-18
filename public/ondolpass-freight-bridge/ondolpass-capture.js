(() => {
  "use strict";

  try {
    return {
      ok: true,
      payload: globalThis.OndolpassFreightExtractor.extract(document),
    };
  } catch (error) {
    return {
      ok: false,
      errorCode:
        error && typeof error.code === "string"
          ? error.code
          : "APPLICATION_NOT_FOUND_OR_EMPTY",
    };
  }
})();
