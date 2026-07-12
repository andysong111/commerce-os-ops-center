import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const candidates = [
  "node_modules/@noto-pdf-ts/fonts-kr/NotoSansKR-VF.ttf",
  "node_modules/@noto-pdf-ts/fonts-kr/fonts/NotoSansKR-VF.ttf",
  "node_modules/@noto-pdf-ts/fonts-kr/dist/NotoSansKR-VF.ttf",
];
const source = candidates.find((candidate) => existsSync(candidate));
const destinationDir = join("public", "generated-fonts");
const destination = join(destinationDir, "NotoSansKR-VF.ttf");

if (!source) {
  console.error("[copy-korean-pdf-font] @noto-pdf-ts/fonts-kr NotoSansKR-VF.ttf not found; Korean PDF generation requires this font.");
  process.exit(1);
}

mkdirSync(destinationDir, { recursive: true });
copyFileSync(source, destination);
console.log(`[copy-korean-pdf-font] copied ${source} -> ${destination}`);
