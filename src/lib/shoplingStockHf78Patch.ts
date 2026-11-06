const LEGACY_ADMIN_ORIGIN = "https://a.shopling.co.kr";
const CURRENT_ADMIN_ORIGIN = "https://kt.shopling.co.kr";

type ContentScript = {
  matches: string[];
  exclude_matches?: string[];
  js: string[];
  all_frames?: boolean;
  run_at?: string;
  world?: string;
};

type WebAccessibleResource = {
  matches?: string[];
};

export type ShoplingManifestForHf78 = {
  host_permissions?: string[];
  content_scripts: ContentScript[];
  web_accessible_resources?: WebAccessibleResource[];
};

function expandAdminPatterns(patterns: readonly string[] | undefined) {
  const expanded: string[] = [];
  for (const pattern of patterns || []) {
    if (!expanded.includes(pattern)) expanded.push(pattern);
    if (pattern.startsWith(`${LEGACY_ADMIN_ORIGIN}/`)) {
      const current = `${CURRENT_ADMIN_ORIGIN}${pattern.slice(LEGACY_ADMIN_ORIGIN.length)}`;
      if (!expanded.includes(current)) expanded.push(current);
    }
  }
  return expanded;
}

/**
 * HF78 applies the same extension scripts to both Shopling admin hosts. The
 * production A21 worker moved to kt.shopling.co.kr, while older accounts and
 * saved tabs can still use a.shopling.co.kr.
 */
export function patchHf78AdminDomainCoverage<T extends ShoplingManifestForHf78>(
  manifest: T,
) {
  manifest.host_permissions = expandAdminPatterns(manifest.host_permissions);
  const currentPermission = `${CURRENT_ADMIN_ORIGIN}/*`;
  if (!manifest.host_permissions.includes(currentPermission)) {
    manifest.host_permissions.push(currentPermission);
  }

  for (const script of manifest.content_scripts) {
    script.matches = expandAdminPatterns(script.matches);
    if (script.exclude_matches) {
      script.exclude_matches = expandAdminPatterns(script.exclude_matches);
    }
  }
  for (const resource of manifest.web_accessible_resources || []) {
    if (resource.matches) resource.matches = expandAdminPatterns(resource.matches);
  }
  return manifest;
}

export function patchHf78SinglePopupSource(source: string) {
  const before =
    'return parsed.origin === "https://a.shopling.co.kr" && parsed.pathname.toLowerCase() === TARGET_PATH.toLowerCase();';
  const after =
    'return ["https://a.shopling.co.kr", "https://kt.shopling.co.kr"].includes(parsed.origin) && parsed.pathname.toLowerCase() === TARGET_PATH.toLowerCase();';
  const first = source.indexOf(before);
  if (first < 0) throw new Error("shopling_stock_hf78_single_popup_origin_anchor_missing");
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error("shopling_stock_hf78_single_popup_origin_anchor_not_unique");
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}
