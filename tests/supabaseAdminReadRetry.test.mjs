import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadAdminModule() {
  const sourcePath = new URL("../src/lib/supabase/admin.ts", import.meta.url);
  const source = await readFile(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const directory = await mkdtemp(join(dirname(sourcePath.pathname), ".supabase-admin-test-"));
  const file = join(directory, "admin.mjs");
  await writeFile(file, output);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const admin = await loadAdminModule();
const { createSupabaseAdminClient } = admin;

function timeoutError() {
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  return error;
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function withFakeAdmin(fetchImpl, callback) {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousSecret = process.env.SUPABASE_SECRET_KEY;
  const previousLegacySecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousFetch = globalThis.fetch;

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.fetch = fetchImpl;

  try {
    const client = await createSupabaseAdminClient();
    assert.ok(client);
    return await callback(client);
  } finally {
    restoreEnv("NEXT_PUBLIC_SUPABASE_URL", previousUrl);
    restoreEnv("SUPABASE_SECRET_KEY", previousSecret);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", previousLegacySecret);
    globalThis.fetch = previousFetch;
  }
}

test("GET retries one transient timeout and returns the second response", async () => {
  let attempts = 0;

  await withFakeAdmin(
    async () => {
      attempts += 1;
      if (attempts === 1) throw timeoutError();
      return new Response(JSON.stringify([{ id: 1 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    async (client) => {
      const result = await client.from("commerce_operation_runs").select("id").limit(1);
      assert.equal(result.error, null);
      assert.deepEqual(result.data, [{ id: 1 }]);
    },
  );

  assert.equal(attempts, 2);
});

test("POST does not retry an ambiguous timeout", async () => {
  let attempts = 0;

  await withFakeAdmin(
    async () => {
      attempts += 1;
      throw timeoutError();
    },
    async (client) => {
      const result = await client.from("commerce_operation_runs").insert({ id: "write-1" });
      assert.match(result.error?.message ?? "", /Supabase REST timeout after 12000ms/);
    },
  );

  assert.equal(attempts, 1);
});

test("GET does not retry non-timeout transport failures", async () => {
  let attempts = 0;

  await withFakeAdmin(
    async () => {
      attempts += 1;
      throw new Error("socket reset");
    },
    async (client) => {
      const result = await client.from("commerce_operation_runs").select("id").limit(1);
      assert.match(result.error?.message ?? "", /Supabase REST transport failed: socket reset/);
    },
  );

  assert.equal(attempts, 1);
});
