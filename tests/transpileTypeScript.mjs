import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export async function importTranspiledTypeScript(sourceUrl) {
  const sourcePath = fileURLToPath(sourceUrl);
  const directory = await mkdtemp(
    join(dirname(fileURLToPath(import.meta.url)), ".transpiled-"),
  );
  try {
    const source = await readFile(sourcePath, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: sourcePath,
    });
    const outputPath = join(directory, `${basename(sourcePath, ".ts")}.mjs`);
    await writeFile(outputPath, output.outputText);
    return await import(pathToFileURL(outputPath).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
