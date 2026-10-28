type ManifestContentScript = {
  matches?: string[];
  js?: string[];
  all_frames?: boolean;
  run_at?: string;
  [key: string]: unknown;
};

type ExtensionManifest = {
  version?: string;
  description?: string;
  content_scripts?: ManifestContentScript[];
  action?: { default_title?: string; [key: string]: unknown };
  [key: string]: unknown;
};

const COMMERCE_OS_BRIDGE_SCRIPT = "commerce-os-market-auto-bridge.mjs";
const SHOPLING_AUTO_AGENT_SCRIPT = "shopling-market-auto-agent.mjs";

function includesScript(entry: ManifestContentScript, script: string) {
  return Array.isArray(entry.js) && entry.js.includes(script);
}

export function buildBridgeManifestV0344(input: Record<string, string>) {
  const output = { ...input };
  const manifest = JSON.parse(output["manifest.json"]) as ExtensionManifest;
  if (manifest.version !== "0.3.43") {
    throw new Error("v0344_wrong_base");
  }
  for (const required of [COMMERCE_OS_BRIDGE_SCRIPT, SHOPLING_AUTO_AGENT_SCRIPT]) {
    if (!output[required]) throw new Error(`v0344_missing_asset:${required}`);
  }

  const existing = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts
    : [];
  const preserved = existing.filter(
    (entry) =>
      !includesScript(entry, COMMERCE_OS_BRIDGE_SCRIPT) &&
      !includesScript(entry, SHOPLING_AUTO_AGENT_SCRIPT),
  );
  manifest.content_scripts = [
    ...preserved,
    {
      matches: ["https://commerce-os-ops-center.vercel.app/*"],
      js: [COMMERCE_OS_BRIDGE_SCRIPT],
      run_at: "document_idle",
    },
    {
      matches: ["*://*.shopling.co.kr/*"],
      js: [SHOPLING_AUTO_AGENT_SCRIPT],
      all_frames: false,
      run_at: "document_idle",
    },
  ];
  manifest.version = "0.3.44";
  manifest.description =
    "v0.3.43 패키지에서 누락된 Commerce OS handoff bridge와 Shopling 자동 에이전트 등록을 복구합니다. v0.3.43 queue/intent/active 원장과 안정된 v0330 wire protocol은 그대로 유지합니다.";
  manifest.action = {
    ...(manifest.action ?? {}),
    default_title: "Shopling Market Sender v0.3.44 · 브라우저 연결 복구",
  };
  output["manifest.json"] = `${JSON.stringify(manifest, null, 2)}\n`;
  output["VERSION.txt"] =
    "Shopling Market Sender v0.3.44\nCommerce OS bridge + Shopling auto-agent manifest registration restored.\nStable v0330 wire protocol and v0343 local runtime retained.\n";
  output["README.txt"] =
    "v0.3.44 BROWSER CONNECTION HOTFIX\n" +
    "- v0.3.43 ZIP에 파일은 있었지만 manifest 등록에서 빠졌던 Commerce OS bridge와 Shopling auto-agent를 복구합니다.\n" +
    "- Commerce OS의 연결 확인과 원클릭 handoff가 다시 동작합니다.\n" +
    "- A18 최상위 탭의 자동 agent가 현재 v0.3.43 queue/intent/active 원장을 이어받습니다.\n" +
    "- 안정된 v0330 서버 wire protocol, 기존 결과회수, 중복방지, confirm_needed 보호를 유지합니다.\n";

  return output;
}
