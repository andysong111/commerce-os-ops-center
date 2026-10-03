import { recoverCjLoisSession } from "../src/cj-lois-auth-recovery.mjs";
import { withCjLoisReturnPickupBrowserAdapter } from "../src/cj-lois-return-pickup-browser-adapter.mjs";
import { loadConfig } from "../src/config.mjs";

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      flags[name] = argv[index + 1];
      index += 1;
    } else {
      flags[name] = true;
    }
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const outboundInvoiceNo = String(flags.invoice || "").replace(/\D/g, "");
const productName = String(flags["product-name"] || "").replace(/\s+/g, " ").trim();
if (!/^\d{10,14}$/.test(outboundInvoiceNo)) {
  throw Object.assign(new Error("CJ lookup verification requires --invoice with 10-14 digits."), {
    code: "CJ_ORIGINAL_INVOICE_INVALID",
  });
}
if (!productName || productName.length > 200) {
  throw Object.assign(new Error("CJ lookup verification requires --product-name."), {
    code: "CJ_RETURN_PRODUCT_NAME_INVALID",
  });
}

const config = loadConfig();
const cjAuthentication = await recoverCjLoisSession(config);
const result = await withCjLoisReturnPickupBrowserAdapter(config, (adapter) => (
  adapter.prepareReturnPickup({ outboundInvoiceNo, productName })
));

process.stdout.write(`${JSON.stringify({
  ...result,
  cjAuthentication,
  mode: "lookup-only",
}, null, 2)}\n`);
