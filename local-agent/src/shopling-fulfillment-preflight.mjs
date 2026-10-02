import { listChromeTargets, shoplingTargets } from "./chrome-cdp.mjs";
import { resolveTesseractExecutable } from "./shopling-label-ocr.mjs";

const B12_PATH = "/order/dlvy_list.phtml";

function present(value) {
  return Boolean(String(value ?? "").trim());
}

export function shoplingApiCredentialPresence(env = process.env) {
  return {
    loginId: present(env.SHOPLING_LOGIN_ID),
    companyId: present(env.SHOPLING_COMPANY_ID),
    authKey: present(env.SHOPLING_API_AUTH_KEY),
  };
}

export async function runShoplingFulfillmentPreflight(config, options = {}, dependencies = {}) {
  const listTargets = dependencies.listChromeTargets || listChromeTargets;
  const resolveOcr = dependencies.resolveTesseractExecutable || resolveTesseractExecutable;
  const credentials = shoplingApiCredentialPresence(options.env || process.env);
  const listed = await listTargets(config);
  const targets = listed.available ? shoplingTargets(listed.targets, config.shoplingOrigins) : [];
  const b12Targets = targets.filter((target) => {
    try {
      return new URL(target.url).pathname === B12_PATH;
    } catch {
      return false;
    }
  });
  const apiConfigured = Object.values(credentials).every(Boolean);
  const ocrConfigured = Boolean(resolveOcr(options.env || process.env));
  const b12Ready = listed.available && b12Targets.length === 1;
  return {
    checkedAt: new Date().toISOString(),
    chromeDebugAvailable: listed.available,
    shoplingTabCount: targets.length,
    b12TabCount: b12Targets.length,
    apiCredentials: credentials,
    apiConfigured,
    localOcrConfigured: ocrConfigured,
    readyForReadOnlyPhotoReview: b12Ready && apiConfigured && ocrConfigured,
    externalWritesAllowed: false,
  };
}
