type ExtensionManifest = {
  version?: string;
  description?: string;
  action?: { default_title?: string; [key: string]: unknown };
  [key: string]: unknown;
};

const SHOPLING_ADMIN_HOSTS = ["a.shopling.co.kr", "kt.shopling.co.kr"] as const;

function replaceExactly(
  source: string,
  anchor: string,
  replacement: string,
  expectedCount: number,
  code: string,
) {
  const count = source.split(anchor).length - 1;
  if (count !== expectedCount) throw new Error(`${code}:${count}`);
  return source.replaceAll(anchor, replacement);
}

export function isShoplingAdminHostV0345(hostname: string) {
  return SHOPLING_ADMIN_HOSTS.includes(
    hostname.trim().toLowerCase() as (typeof SHOPLING_ADMIN_HOSTS)[number],
  );
}

export function buildAdminHostV0345(input: Record<string, string>) {
  const output = { ...input };
  const manifest = JSON.parse(output["manifest.json"]) as ExtensionManifest;
  if (manifest.version !== "0.3.44") throw new Error("v0345_wrong_base");

  for (const required of [
    "content-group-canary.mjs",
    "background-root.mjs",
    "shopling-market-auto-agent.mjs",
  ]) {
    if (!output[required]) throw new Error(`v0345_missing_asset:${required}`);
  }

  const allowedHosts = JSON.stringify(SHOPLING_ADMIN_HOSTS);
  output["content-group-canary.mjs"] = replaceExactly(
    output["content-group-canary.mjs"],
    'location.hostname !== "a.shopling.co.kr"',
    `!${allowedHosts}.includes(location.hostname)`,
    2,
    "v0345_content_admin_host_guard_mismatch",
  );
  output["background-root.mjs"] = replaceExactly(
    output["background-root.mjs"],
    'parsed.hostname === "a.shopling.co.kr"',
    `${allowedHosts}.includes(parsed.hostname)`,
    1,
    "v0345_background_admin_host_guard_mismatch",
  );
  output["shopling-market-auto-agent.mjs"] = replaceExactly(
    output["shopling-market-auto-agent.mjs"],
    "globalThis.__commerceOsShoplingMarketAutoAgentV0330 = true;",
    "globalThis.__commerceOsShoplingMarketAutoAgentV0343 = true;",
    1,
    "v0345_agent_guard_assignment_mismatch",
  );

  const agent = output["shopling-market-auto-agent.mjs"];
  const guard = "globalThis.__commerceOsShoplingMarketAutoAgentV0343";
  if ((agent.split(guard).length - 1) !== 2) {
    throw new Error("v0345_agent_guard_not_consistent");
  }

  manifest.version = "0.3.45";
  manifest.description =
    "Shopling 관리자 계정이 a.shopling.co.kr에서 kt.shopling.co.kr로 이동하는 경우에도 기존 A18 원클릭 마켓전송을 안전하게 이어갑니다. v0.3.44 bridge, v0.3.43 로컬 원장, v0330 서버 protocol은 유지합니다.";
  manifest.action = {
    ...(manifest.action ?? {}),
    default_title: "Shopling Market Sender v0.3.45 · KT 관리자 호환",
  };
  output["manifest.json"] = `${JSON.stringify(manifest, null, 2)}\n`;
  output["VERSION.txt"] =
    "Shopling Market Sender v0.3.45\nKT Shopling admin host compatibility for the existing one-click A18 sender.\nStable v0330 wire protocol and v0343 local runtime retained.\n";
  output["README.txt"] =
    "v0.3.45 KT ADMIN HOST HOTFIX\n" +
    "- a.shopling.co.kr과 실제 계정 관리자 주소 kt.shopling.co.kr을 명시적 허용목록으로 처리합니다.\n" +
    "- 그 밖의 Shopling 하위 도메인은 관리자 제어 화면으로 간주하지 않습니다.\n" +
    "- 자동 에이전트 중복실행 방지 키의 검사·기록 버전을 V0343으로 일치시킵니다.\n" +
    "- 기존 queue/intent/active 원장, 서버 wire protocol, 결과회수, 중복방지, confirm_needed 보호를 유지합니다.\n";

  for (const name of [
    "content-group-canary.mjs",
    "background-root.mjs",
    "shopling-market-auto-agent.mjs",
  ]) {
    new Function(output[name]);
  }
  return output;
}
