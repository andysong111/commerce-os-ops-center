const INVOICE_DELETION_DIALOG_PARTS = [
  "송장번호를 삭제하시겠습니까?",
  "삭제 후 복구는 불가능합니다",
  "택배사 전송대기",
];
const QNA_TRANSMISSION_DIALOG = "선택된 문의를 쇼핑몰로 전송하시겠습니까?";

function normalizeDialogText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function waitForTrigger(triggered, timeoutMs) {
  if (!triggered) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error("The Shopling dialog trigger did not settle after dialog handling.");
      error.code = "SHOPLING_DIALOG_TRIGGER_TIMEOUT";
      reject(error);
    }, timeoutMs);
    triggered.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function settleTrigger(triggered, timeoutMs) {
  if (!triggered) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    triggered.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

export function isShoplingInvoiceDeletionDialog(dialog = {}) {
  const message = normalizeDialogText(dialog.message);
  return dialog.type === "confirm"
    && INVOICE_DELETION_DIALOG_PARTS.every((part) => message.includes(part));
}

export function isShoplingQnaTransmissionDialog(dialog = {}) {
  return dialog.type === "confirm"
    && normalizeDialogText(dialog.message) === QNA_TRANSMISSION_DIALOG;
}

export async function acceptExpectedShoplingQnaTransmissionDialog(session, trigger, options = {}) {
  if (typeof session?.on !== "function" || typeof session?.send !== "function") {
    const error = new Error("A CDP session with event support is required.");
    error.code = "CDP_DIALOG_SESSION_INVALID";
    throw error;
  }
  if (typeof trigger !== "function") {
    const error = new Error("A dialog trigger is required.");
    error.code = "CDP_DIALOG_TRIGGER_REQUIRED";
    throw error;
  }

  const timeoutMs = options.timeoutMs || 5_000;
  await session.send("Page.enable", {}, timeoutMs);
  let timer;
  let unsubscribe = () => {};
  const opened = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Shopling QnA transmission confirmation did not appear.");
      error.code = "SHOPLING_QNA_TRANSMISSION_DIALOG_TIMEOUT";
      reject(error);
    }, timeoutMs);
    unsubscribe = session.on("Page.javascriptDialogOpening", (dialog) => {
      clearTimeout(timer);
      resolve(dialog);
    });
  });

  let triggered;
  try {
    triggered = Promise.resolve().then(trigger);
    const dialog = await Promise.race([
      opened,
      triggered.then(() => new Promise(() => {}), (error) => Promise.reject(error)),
    ]);
    if (!isShoplingQnaTransmissionDialog(dialog)) {
      await session.send("Page.handleJavaScriptDialog", { accept: false }, timeoutMs).catch(() => null);
      const error = new Error("An unexpected QnA transmission dialog was refused.");
      error.code = "SHOPLING_QNA_TRANSMISSION_DIALOG_UNEXPECTED";
      throw error;
    }
    await session.send("Page.handleJavaScriptDialog", { accept: true }, timeoutMs);
    await waitForTrigger(triggered, timeoutMs);
    return { accepted: true, type: dialog.type, messageVerified: true };
  } finally {
    clearTimeout(timer);
    unsubscribe();
    await settleTrigger(triggered, timeoutMs);
  }
}

export async function acceptExpectedShoplingInvoiceDeletionDialog(session, trigger, options = {}) {
  if (typeof session?.on !== "function" || typeof session?.send !== "function") {
    const error = new Error("A CDP session with event support is required.");
    error.code = "CDP_DIALOG_SESSION_INVALID";
    throw error;
  }
  if (typeof trigger !== "function") {
    const error = new Error("A dialog trigger is required.");
    error.code = "CDP_DIALOG_TRIGGER_REQUIRED";
    throw error;
  }

  const timeoutMs = options.timeoutMs || 5_000;
  await session.send("Page.enable", {}, timeoutMs);

  let timer;
  let unsubscribe = () => {};
  const opened = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Shopling invoice deletion confirmation did not appear.");
      error.code = "SHOPLING_INVOICE_DELETION_DIALOG_TIMEOUT";
      reject(error);
    }, timeoutMs);
    unsubscribe = session.on("Page.javascriptDialogOpening", (dialog) => {
      clearTimeout(timer);
      resolve(dialog);
    });
  });

  let triggered;
  try {
    triggered = Promise.resolve().then(trigger);
    const triggerFailure = triggered.then(
      () => new Promise(() => {}),
      (error) => Promise.reject(error),
    );
    const dialog = await Promise.race([opened, triggerFailure]);
    if (!isShoplingInvoiceDeletionDialog(dialog)) {
      await session.send("Page.handleJavaScriptDialog", { accept: false }, timeoutMs).catch(() => null);
      const error = new Error("An unexpected JavaScript dialog was refused.");
      error.code = "SHOPLING_INVOICE_DELETION_DIALOG_UNEXPECTED";
      throw error;
    }
    await session.send("Page.handleJavaScriptDialog", { accept: true }, timeoutMs);
    await waitForTrigger(triggered, timeoutMs);
    return {
      accepted: true,
      type: dialog.type,
      messageVerified: true,
    };
  } finally {
    clearTimeout(timer);
    unsubscribe();
    await settleTrigger(triggered, timeoutMs);
  }
}

export async function acceptExpectedShoplingInvoiceDeletionFlow(session, trigger, options = {}) {
  if (typeof session?.on !== "function" || typeof session?.send !== "function") {
    const error = new Error("A CDP session with event support is required.");
    error.code = "CDP_DIALOG_SESSION_INVALID";
    throw error;
  }
  if (typeof trigger !== "function") {
    const error = new Error("A dialog trigger is required.");
    error.code = "CDP_DIALOG_TRIGGER_REQUIRED";
    throw error;
  }

  const timeoutMs = options.timeoutMs || 5_000;
  const followupTimeoutMs = options.followupTimeoutMs || 5_000;
  await session.send("Page.enable", {}, timeoutMs);

  const queued = [];
  const waiters = [];
  const unsubscribe = session.on("Page.javascriptDialogOpening", (dialog) => {
    const waiter = waiters.shift();
    if (waiter) waiter(dialog);
    else queued.push(dialog);
  });
  const nextDialog = (waitMs) => {
    if (queued.length) return Promise.resolve(queued.shift());
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = waiters.indexOf(onDialog);
        if (index >= 0) waiters.splice(index, 1);
        resolve(null);
      }, waitMs);
      const onDialog = (dialog) => {
        clearTimeout(timer);
        resolve(dialog);
      };
      waiters.push(onDialog);
    });
  };

  let triggered;
  try {
    triggered = Promise.resolve().then(trigger);
    const confirmation = await Promise.race([
      nextDialog(timeoutMs),
      triggered.then(
        () => null,
        (error) => Promise.reject(error),
      ),
    ]);
    if (!confirmation) {
      const error = new Error("Shopling invoice deletion confirmation did not appear.");
      error.code = "SHOPLING_INVOICE_DELETION_DIALOG_TIMEOUT";
      throw error;
    }
    if (!isShoplingInvoiceDeletionDialog(confirmation)) {
      await session.send("Page.handleJavaScriptDialog", { accept: false }, timeoutMs).catch(() => null);
      const error = new Error("An unexpected JavaScript dialog was refused.");
      error.code = "SHOPLING_INVOICE_DELETION_DIALOG_UNEXPECTED";
      throw error;
    }
    await session.send("Page.handleJavaScriptDialog", { accept: true }, timeoutMs);

    const followup = await nextDialog(followupTimeoutMs);
    if (followup) {
      if (followup.type !== "alert") {
        await session.send("Page.handleJavaScriptDialog", { accept: false }, timeoutMs).catch(() => null);
        const error = new Error("An unexpected follow-up JavaScript dialog was refused.");
        error.code = "SHOPLING_INVOICE_DELETION_FOLLOWUP_UNEXPECTED";
        throw error;
      }
      await session.send("Page.handleJavaScriptDialog", { accept: true }, timeoutMs);
    }
    await waitForTrigger(triggered, timeoutMs);
    return {
      accepted: true,
      type: confirmation.type,
      messageVerified: true,
      followupAlertDismissed: Boolean(followup),
    };
  } finally {
    unsubscribe();
    await settleTrigger(triggered, timeoutMs);
  }
}
