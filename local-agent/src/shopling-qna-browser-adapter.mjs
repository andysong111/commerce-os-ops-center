import {
  listChromeTargets,
  shoplingTargets,
  withCdpTarget,
} from "./chrome-cdp.mjs";
import { acceptExpectedShoplingQnaTransmissionDialog } from "./shopling-browser-dialog.mjs";

const BASE_URL = "https://a.shopling.co.kr";
const LIST_PATH = "/qna/qnaList.phtml";
const POPUP_PATH = "/qna/qna_popup.phtml";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  throw error;
}

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

async function evaluate(session, expression, timeoutMs = 8_000) {
  const result = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    const message = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || "Shopling B13 evaluation failed.";
    fail("SHOPLING_QNA_PAGE_EVALUATION_FAILED", message);
  }
  return result.result?.value;
}

async function listedTargets(config, dependencies) {
  const result = await (dependencies.listChromeTargets || listChromeTargets)(config);
  if (!result.available) fail("CHROME_CDP_UNAVAILABLE", "Dedicated Chrome DevTools is unavailable.");
  return result.targets || [];
}

async function selectControlTarget(config, dependencies) {
  const candidates = shoplingTargets(await listedTargets(config, dependencies), config.shoplingOrigins)
    .filter((target) => pathOf(target.url) !== POPUP_PATH);
  const target = candidates.find((item) => pathOf(item.url) === LIST_PATH) || candidates[0];
  if (!target) fail("SHOPLING_QNA_CONTROL_TARGET_MISSING", "A logged-in Shopling tab was not found.");
  return target;
}

async function assertAccount(session, account) {
  const state = await evaluate(session, `(() => ({
    path: location.pathname,
    text: String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1200),
  }))()`);
  if (state?.path === "/login.phtml" || !String(state?.text || "").includes(`[${account}]`)) {
    fail("SHOPLING_ACCOUNT_MISMATCH", `Shopling is not logged in as ${account}.`);
  }
}

async function waitForPath(session, expectedPath, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await evaluate(session, `({ path: location.pathname, readyState: document.readyState })`, 4_000)
      .catch(() => null);
    if (state?.path === expectedPath && state.readyState === "complete") return state;
    await sleep(250);
  }
  fail("SHOPLING_QNA_PAGE_TIMEOUT", `Shopling did not settle at ${expectedPath}.`);
}

async function navigateToList(session, account) {
  await session.send("Page.enable", {}, 5_000).catch(() => null);
  await session.send("Page.navigate", { url: `${BASE_URL}${LIST_PATH}` }, 10_000);
  await waitForPath(session, LIST_PATH);
  await assertAccount(session, account);
}

async function waitForReplyPopup(config, dependencies, existingIds, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matches = shoplingTargets(await listedTargets(config, dependencies), config.shoplingOrigins)
      .filter((target) => pathOf(target.url) === POPUP_PATH && !existingIds.has(target.id));
    if (matches.length > 1) {
      fail("SHOPLING_QNA_POPUP_COUNT_INVALID", `Expected one new B13 reply popup, found ${matches.length}.`);
    }
    if (matches.length === 1) return matches[0];
    await sleep(200);
  }
  fail("SHOPLING_QNA_POPUP_TIMEOUT", "The B13 reply popup did not open.");
}

export function verifyShoplingQnaPopupDraftState(expected, state = {}) {
  if (state.path !== POPUP_PATH || state.identityMatches !== true) {
    fail("SHOPLING_QNA_POPUP_IDENTITY_MISMATCH", "The B13 reply popup does not match the reviewed inquiry.");
  }
  if (state.answerMatches !== true) {
    fail("SHOPLING_QNA_POPUP_ANSWER_MISMATCH", "The B13 reply popup did not retain the approved answer.");
  }
  return { qnaKey: expected.qnaKey, saved: true };
}

export function verifyShoplingQnaTransmissionRowState(expected, state = {}) {
  if (state.path !== LIST_PATH || state.matchCount !== 1) {
    fail("SHOPLING_QNA_TRANSMISSION_ROW_INVALID", "The reviewed inquiry was not found exactly once in B13.", state);
  }
  if (state.selectedCount !== 1
    || String(state.checkboxValue || "") !== String(expected.qnaKey)
    || String(state.ableValue || "") !== String(expected.qnaKey)) {
    fail("SHOPLING_QNA_TRANSMISSION_SELECTION_INVALID", "B13 did not select exactly the reviewed inquiry.", state);
  }
  if (!["답변저장", "답변송신실패"].includes(String(state.sendStatus || ""))) {
    fail("SHOPLING_QNA_TRANSMISSION_ROW_STATUS_INVALID", "The B13 row is not eligible for reply transmission.", state);
  }
  return { qnaKey: String(expected.qnaKey), selected: true };
}

export function createShoplingQnaBrowserAdapter(config, options = {}, dependencies = {}) {
  const runWithTarget = dependencies.withCdpTarget || withCdpTarget;
  const account = options.account || "andy801";
  return {
    async saveReplyDraft(expected) {
      const before = new Set((await listedTargets(config, dependencies))
        .filter((target) => pathOf(target.url) === POPUP_PATH)
        .map((target) => target.id));
      const controlTarget = await selectControlTarget(config, dependencies);
      await runWithTarget(controlTarget, async (session) => {
        await navigateToList(session, account);
        const opened = await evaluate(session, `(() => {
          const expected = ${JSON.stringify(expected.qnaKey)};
          const matches = Array.from(document.querySelectorAll('[onclick*="qna_popup"]')).filter((element) => {
            const source = String(element.getAttribute('onclick') || '');
            const found = source.match(/qna_popup\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)/);
            return found?.[1] === expected;
          });
          if (matches.length !== 1) return { error: 'SHOPLING_QNA_LIST_IDENTITY_INVALID', matchCount: matches.length };
          if (typeof qna_popup !== 'function') return { error: 'SHOPLING_QNA_POPUP_FUNCTION_MISSING' };
          qna_popup(expected);
          return { opened: true };
        })()`);
        if (opened?.error) fail(opened.error, "The exact reviewed inquiry was not found once in B13.", opened);
      }, { timeoutMs: 15_000 });

      const popupTarget = await waitForReplyPopup(config, dependencies, before);
      return runWithTarget(popupTarget, async (session) => {
        await waitForPath(session, POPUP_PATH);
        const prepared = await evaluate(session, `(() => {
          const expectedKey = ${JSON.stringify(expected.qnaKey)};
          const form = document.forms.qnaform;
          if (!form || String(form.no?.value || '') !== expectedKey) {
            return { error: 'SHOPLING_QNA_POPUP_IDENTITY_MISMATCH' };
          }
          const answer = form.elements.qca;
          if (!answer) return { error: 'SHOPLING_QNA_ANSWER_FIELD_MISSING' };
          answer.value = ${JSON.stringify(expected.reply)};
          answer.dispatchEvent(new Event('input', { bubbles: true }));
          answer.dispatchEvent(new Event('change', { bubbles: true }));
          if (typeof qna_submit !== 'function') return { error: 'SHOPLING_QNA_SUBMIT_FUNCTION_MISSING' };
          qna_submit();
          return { submitted: true };
        })()`, 10_000).catch((error) => {
          if (/context|navigation|destroyed/i.test(error.message)) return { submitted: true };
          throw error;
        });
        if (prepared?.error) fail(prepared.error, "The B13 answer form could not be prepared.");
        // Shopling can leave this renderer loading indefinitely after qna_submit.
        // The caller performs the authoritative API readback for status and exact text.
        await session.send("Page.close", {}, 5_000).catch(() => null);
        return { qnaKey: expected.qnaKey, submitted: true, verification: "API_READBACK_REQUIRED" };
      }, { timeoutMs: 30_000 });
    },
    async transmitReply(expected) {
      const controlTarget = await selectControlTarget(config, dependencies);
      return runWithTarget(controlTarget, async (session) => {
        await navigateToList(session, account);
        const state = await evaluate(session, `(() => {
          const expected = ${JSON.stringify(expected.qnaKey)};
          const matches = Array.from(document.querySelectorAll('[onclick*="qna_popup"]')).filter((element) => {
            const source = String(element.getAttribute('onclick') || '');
            const found = source.match(/qna_popup\\(\\s*['"]([^'"]+)['"]\\s*\\)/);
            return found?.[1] === expected;
          });
          document.querySelectorAll('input[name="chk[]"]').forEach((checkbox) => {
            checkbox.checked = false;
          });
          if (matches.length !== 1) {
            return { path: location.pathname, matchCount: matches.length, selectedCount: 0 };
          }
          const row = matches[0].closest('tr');
          const checkbox = row?.querySelector('input[name="chk[]"]');
          const able = row?.querySelector('input[name="qna_able_list[]"]');
          if (!checkbox || checkbox.disabled) {
            return { path: location.pathname, matchCount: 1, selectedCount: 0 };
          }
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
          return {
            path: location.pathname,
            matchCount: 1,
            selectedCount: document.querySelectorAll('input[name="chk[]"]:checked').length,
            checkboxValue: checkbox.value,
            ableValue: able?.value || '',
            sendStatus: checkbox.getAttribute('status') || '',
          };
        })()`);
        verifyShoplingQnaTransmissionRowState(expected, state);
        await acceptExpectedShoplingQnaTransmissionDialog(session, async () => {
          const triggered = await evaluate(session, `(() => {
            if (typeof qnasend_submit_sp !== 'function') {
              return { error: 'SHOPLING_QNA_TRANSMISSION_FUNCTION_MISSING' };
            }
            qnasend_submit_sp();
            return { submitted: true };
          })()`, 10_000);
          if (triggered?.error) {
            fail(triggered.error, "The B13 reply transmission function is unavailable.");
          }
          return triggered;
        }, { timeoutMs: 10_000 });
        return { qnaKey: expected.qnaKey, submitted: true };
      }, { timeoutMs: 30_000 });
    },
  };
}

export async function withShoplingQnaBrowserAdapter(config, options, handler, dependencies = {}) {
  return handler(createShoplingQnaBrowserAdapter(config, options, dependencies));
}
