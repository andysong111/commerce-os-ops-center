#!/usr/bin/env node
import { loadConfig } from "../src/config.mjs";
import { sanitizeError } from "../src/safe-json.mjs";
import { runShoplingDailyFulfillment } from "../src/shopling-daily-fulfillment.mjs";

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replace(/-([a-z])/g, (_match, character) => character.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      index += 1;
    }
  }
  return flags;
}

function todayInSeoul(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}`;
}

const flags = parseFlags(process.argv.slice(2));
const config = loadConfig();

try {
  const result = await runShoplingDailyFulfillment(config, {
    date: flags.date || todayInSeoul(),
    account: flags.account || "andy801",
    execute: flags.execute === true,
    resume: flags.resume === true,
    print: flags.noPrint !== true,
    outputPath: flags.output,
    printerName: flags.printer,
    formName: flags.form,
  });
  console.log(JSON.stringify({ event: "shopling_daily_fulfillment", ...result }, null, 2));
  if (result.status === "needs_mapping_review") process.exitCode = 2;
} catch (error) {
  console.error(JSON.stringify({ event: "shopling_daily_fulfillment_failed", error: sanitizeError(error, "SHOPLING_DAILY_FULFILLMENT_FAILED") }, null, 2));
  process.exitCode = 1;
}
