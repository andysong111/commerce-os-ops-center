(function installOndolpassCaptureListener() {
  "use strict";

  const CAPTURE_TYPE = "COMMERCE_OS_ONDOLPASS_CAPTURE_V1";

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (
      !message ||
      message.type !== CAPTURE_TYPE ||
      sender.id !== chrome.runtime.id
    ) {
      return false;
    }

    try {
      const payload = globalThis.OndolpassFreightExtractor.extract(document);
      if (payload.applicationNo !== String(message.applicationNo || "")) {
        sendResponse({ ok: false, errorCode: "APPLICATION_NUMBER_MISMATCH" });
        return false;
      }
      sendResponse({ ok: true, payload });
    } catch (error) {
      sendResponse({
        ok: false,
        errorCode:
          error && typeof error.code === "string"
            ? error.code
            : "APPLICATION_NOT_FOUND_OR_EMPTY",
      });
    }
    return false;
  });
})();
