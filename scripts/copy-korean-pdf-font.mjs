import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const candidates = [
  "node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff2",
  "node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-korean-500-normal.woff2",
  "node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-korean-700-normal.woff2",
];
const source = candidates.find((candidate) => existsSync(candidate));
const destinationDir = join("public", "generated-fonts");
const destination = join(destinationDir, "NotoSansKR.woff2");

if (!source) {
  console.error("[copy-korean-pdf-font] @fontsource/noto-sans-kr Korean WOFF2 not found; Korean PDF generation requires this font.");
  process.exit(1);
}

mkdirSync(destinationDir, { recursive: true });
copyFileSync(source, destination);
console.log(`[copy-korean-pdf-font] copied ${source} -> ${destination}`);
