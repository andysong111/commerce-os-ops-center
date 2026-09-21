import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
/** Execute the actual production TS module with explicit dependency boundaries. */
export function loadModule(path, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const dependency = (key) => Object.hasOwn(dependencies,key) ? dependencies[key] : key.startsWith('node:') ? require(key) : (()=>{ throw new Error(`Unmocked dependency: ${key}`); })();
  vm.runInNewContext(code, { module, exports: module.exports, require: dependency, console, process, Error, URL, Request, Response, AbortSignal, setTimeout, clearTimeout, Buffer }, { filename: path });
  return module.exports;
}
