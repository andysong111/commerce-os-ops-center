(function installCommerceOsFreightBridge() {
  "use strict";

  const CHANNEL = "COMMERCE_OS_ONDOLPASS_FREIGHT_BRIDGE_V1";
  const PAGE_SOURCE = "commerce-os-freight-barcode-request";
  const EXTENSION_SOURCE = "commerce-os-ondolpass-freight-bridge";
  const FETCH_TYPE = "COMMERCE_OS_ONDOLPASS_FETCH_V1";
  const DATE_RANGE_FETCH_TYPE = "COMMERCE_OS_ONDOLPASS_DATE_RANGE_FETCH_V1";

  function isAllowedCommercePage() {
    const allowedOrigin =
      window.location.origin === "https://commerce-os-ops-center.vercel.app" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "localhost";
    return allowedOrigin && window.location.pathname === "/freight-barcode-request";
  }

  function post(message) {
    window.postMessage(
      { channel: CHANNEL, source: EXTENSION_SOURCE, ...message },
      window.location.origin,
    );
  }

  async function fetchApplication(message) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: FETCH_TYPE,
        requestId: message.requestId,
        applicationNo: message.applicationNo,
      });
      if (response && response.ok) {
        post({
          type: "RESULT",
          requestId: message.requestId,
          applicationNo: message.applicationNo,
          payload: response.payload,
        });
        return;
      }
      post({
        type: "ERROR",
        requestId: message.requestId,
        applicationNo: message.applicationNo,
        errorCode:
          response && typeof response.errorCode === "string"
            ? response.errorCode
            : "BRIDGE_UNKNOWN_ERROR",
      });
    } catch (error) {
      const runtimeErrorMessage = String((error && error.message) || "");
      post({
        type: "ERROR",
        requestId: message.requestId,
        applicationNo: message.applicationNo,
        errorCode: /context invalidated/i.test(runtimeErrorMessage)
          ? "BRIDGE_RELOAD_REQUIRED"
          : "BRIDGE_RUNTIME_ERROR",
      });
    }
  }

  async function fetchDateRange(message) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: DATE_RANGE_FETCH_TYPE,
        requestId: message.requestId,
        startDate: message.startDate,
        endDate: message.endDate,
      });
      if (response && response.ok) {
        post({
          type: "DATE_RANGE_RESULT",
          requestId: message.requestId,
          startDate: message.startDate,
          endDate: message.endDate,
          payload: response.payload,
        });
        return;
      }
      post({
        type: "DATE_RANGE_ERROR",
        requestId: message.requestId,
        startDate: message.startDate,
        endDate: message.endDate,
        errorCode:
          response && typeof response.errorCode === "string"
            ? response.errorCode
            : "BRIDGE_UNKNOWN_ERROR",
      });
    } catch (error) {
      const runtimeErrorMessage = String((error && error.message) || "");
      post({
        type: "DATE_RANGE_ERROR",
        requestId: message.requestId,
        startDate: message.startDate,
        endDate: message.endDate,
        errorCode: /context invalidated/i.test(runtimeErrorMessage)
          ? "BRIDGE_RELOAD_REQUIRED"
          : "BRIDGE_RUNTIME_ERROR",
      });
    }
  }

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      !isAllowedCommercePage()
    ) {
      return;
    }
    const message = event.data;
    if (
      !message ||
      message.channel !== CHANNEL ||
      message.source !== PAGE_SOURCE
    ) {
      return;
    }
    if (message.type === "PING") {
      post({ type: "READY" });
      return;
    }
    if (
      message.type === "FETCH_APPLICATION" &&
      typeof message.requestId === "string" &&
      /^\d{4,20}$/.test(String(message.applicationNo || ""))
    ) {
      void fetchApplication(message);
      return;
    }
    if (
      message.type === "FETCH_DATE_RANGE" &&
      typeof message.requestId === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(message.startDate || "")) &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(message.endDate || ""))
    ) {
      void fetchDateRange(message);
    }
  });

  if (isAllowedCommercePage()) post({ type: "READY" });
})();
