export const SHOPLING_STOCK_EXTENSION_PING =
  "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING";
export const SHOPLING_STOCK_EXTENSION_STATUS =
  "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS";

type ShoplingStockStatusMessage = {
  type?: unknown;
  active?: {
    status?: unknown;
    job?: { jobId?: unknown; barcode?: unknown } | null;
  } | null;
};

type ShoplingStockBridgeWindow = {
  location: { origin: string };
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent) => void,
  ) => void;
  removeEventListener: (
    type: "message",
    listener: (event: MessageEvent) => void,
  ) => void;
  postMessage: (message: unknown, targetOrigin: string) => void;
};

type WaitForShoplingStockIdleOptions = {
  bridgeWindow?: ShoplingStockBridgeWindow;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

export async function waitForShoplingStockIdle({
  bridgeWindow = window,
  timeoutMs = 8_000,
  pollIntervalMs = 250,
}: WaitForShoplingStockIdleOptions = {}) {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let lastRunningBarcode = "";

    const cleanup = () => {
      bridgeWindow.removeEventListener("message", onMessage);
      globalThis.clearInterval(pollTimer);
      globalThis.clearTimeout(timeoutTimer);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const ping = () => {
      bridgeWindow.postMessage(
        { type: SHOPLING_STOCK_EXTENSION_PING },
        bridgeWindow.location.origin,
      );
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== bridgeWindow ||
        event.origin !== bridgeWindow.location.origin ||
        !event.data ||
        typeof event.data !== "object"
      ) {
        return;
      }
      const message = event.data as ShoplingStockStatusMessage;
      if (message.type !== SHOPLING_STOCK_EXTENSION_STATUS) return;

      if (String(message.active?.status || "").toUpperCase() === "RUNNING") {
        lastRunningBarcode = String(message.active?.job?.barcode || "");
        return;
      }
      finish();
    };

    bridgeWindow.addEventListener("message", onMessage);
    const pollTimer = globalThis.setInterval(ping, pollIntervalMs);
    const timeoutTimer = globalThis.setTimeout(() => {
      finish(
        new Error(
          `SHOPLING_STOCK_EXTENSION_NOT_IDLE: ${
            lastRunningBarcode
              ? `${lastRunningBarcode} Shopling 작업 잠금이 해제되지 않았습니다.`
              : "Shopling 확장의 다음 작업 가능 상태를 확인하지 못했습니다."
          }`,
        ),
      );
    }, timeoutMs);
    ping();
  });
}
