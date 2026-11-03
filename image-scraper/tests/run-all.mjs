// Runs the whole suite in order and stops at the first failing group.
// Usage: npm test          (or: node tests/run-all.mjs)
//        npm test -- ZIP    (passes the filter to the browser/loader suites)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';

const groups = [
  ['Statik denetimler', 'run-static.mjs'],
  ['Loader', 'run-loader.mjs'],
  ['Tarayıcı', 'run-browser.mjs'],
];

function run(file) {
  return new Promise(resolve => {
    const args = [path.join(here, file)];
    if (filter) args.push(filter);
    // stdio "inherit": ilerleme canlı görünür, çıktı renkleri korunur.
    const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: here });
    child.on('exit', code => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

let failed = 0;
for (const [label, file] of groups) {
  console.log(`\n=== ${label} ===`);
  const code = await run(file);
  if (code !== 0) { failed++; console.log(`\n${label} başarısız (çıkış kodu ${code}).`); break; }
}

console.log(failed ? '\nTest paketi: BAŞARISIZ' : '\nTest paketi: tümü geçti ✔');
process.exit(failed ? 1 : 0);
