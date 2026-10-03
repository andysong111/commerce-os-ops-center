import { loadConfig } from "../src/config.mjs";
import { withShoplingReturnB7BrowserAdapter } from "../src/shopling-return-b7-browser-adapter.mjs";

const config = loadConfig();
const result = await withShoplingReturnB7BrowserAdapter(
  config,
  (adapter) => adapter.inspect(),
  { expectedAccount: "andy801" },
);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
