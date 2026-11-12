import type { DomeggookAccountSettings } from "@/lib/domeggookPeriodExtensionSettings";

export type DomeggookBulkRunResult = {
  accountId: string;
  ok: boolean;
};

export async function runDomeggookAccountsSequentially(
  accounts: DomeggookAccountSettings[],
  runAccount: (account: DomeggookAccountSettings) => Promise<unknown>,
): Promise<DomeggookBulkRunResult[]> {
  const results: DomeggookBulkRunResult[] = [];
  for (const account of accounts) {
    try {
      await runAccount(account);
      results.push({ accountId: account.accountId, ok: true });
    } catch {
      results.push({ accountId: account.accountId, ok: false });
    }
  }
  return results;
}

export function summarizeDomeggookBulkRun(results: DomeggookBulkRunResult[]) {
  const succeeded = results.filter((result) => result.ok).map((result) => result.accountId);
  const failed = results.filter((result) => !result.ok).map((result) => result.accountId);
  return { total: results.length, succeeded, failed };
}
