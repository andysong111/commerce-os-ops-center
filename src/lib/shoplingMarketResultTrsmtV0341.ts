function versioned(source: string) {
  return source
    .replaceAll("0.3.40", "0.3.41")
    .replaceAll("V0340", "V0341")
    .replaceAll("v0340", "v0341");
}

export function buildResultTrsmtV0341(input: Record<string, string>) {
  const output = { ...input };
  for (const name of ["content-group-canary.mjs", "background-root.mjs", "popup.js", "popup.html", "recovery.mjs"]) {
    output[name] = versioned(output[name]);
  }

  // Shopling's live submit-result path observed in production is
  // /prod_a/prod_rgst_trsmt.phtml. v0.3.40 accidentally recognized tsrmt
  // (r/s swapped), so successful result windows were never reconciled.
  for (const name of ["content-group-canary.mjs", "background-root.mjs", "popup.js"]) {
    output[name] = output[name].replaceAll("(?:rspt|tsrmt)", "(?:rspt|trsmt|tsrmt)");
  }

  const manifest = JSON.parse(output["manifest.json"]);
  manifest.version = "0.3.41";
  manifest.description = "Shopling 실전 결과 URL prod_rgst_trsmt.phtml을 정확히 인식해 전송 성공을 서버 원장에 자동 회수하며, A18 프레임 직접연결과 최대 3상품/18채널 안전 대량전송을 유지합니다.";
  manifest.action.default_title = "Shopling Market Sender v0.3.41 · 결과회수 안정화";
  output["manifest.json"] = JSON.stringify(manifest, null, 2);
  output["VERSION.txt"] = "Shopling Market Sender v0.3.41\nRecognizes live /prod_a/prod_rgst_trsmt.phtml result pages for automatic sent readback.\nA18 frame direct start + bounded bulk retained.\n";
  output["README.txt"] = "v0.3.41 LIVE RESULT READBACK FIX\n- 실전에서 확인된 Shopling 결과 URL /prod_a/prod_rgst_trsmt.phtml을 결과 페이지로 인식합니다.\n- v0.3.40의 오타 tsrmt 때문에 결과 성공창이 자동회수되지 않던 문제를 수정합니다.\n- 성공 결과는 live submit_armed goods_key와 결합해 sent로 자동 마감합니다.\n- 결과 미확정은 pending으로 되돌리지 않고 confirm_needed로 잠급니다.\n- A18 내부 프레임 직접연결과 최대 3상품/18채널 안전 대량전송 정책은 유지합니다.\n";

  for (const name of ["content-group-canary.mjs", "background-root.mjs", "popup.js", "recovery.mjs"]) {
    new Function(output[name]);
  }
  return output;
}
