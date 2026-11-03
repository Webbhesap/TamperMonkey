// Shared test utilities: Chrome discovery, user script bundle and assertions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ROOT = root;

/** Reads every file the userscript bundle needs, keyed by manifest-relative path. */
export function readBundle() {
  const files = {};
  for (const relative of [
    'lib/alpine.min.js', 'lib/jszip.min.js', 'modules/zip.js', 'modules/settings-ui.js',
    'modules/page-tools.js', 'modules/network.js', 'modules/image-analysis.js',
    'modules/ui-results.js', 'app.js', 'panel.html', 'styles.css',
  ]) files[relative] = fs.readFileSync(path.join(root, relative), 'utf8');
  return files;
}

/** Parses the userscript metadata block into a key -> value[] map. */
export function readMetadata(file = 'tampermonkey-loader.user.js') {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const block = /\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/.exec(text);
  if (!block) throw new Error('UserScript metadata bloğu bulunamadı');
  const map = new Map();
  for (const line of block[1].split(/\r?\n/)) {
    const m = /^\s*\/\/\s*@(\S+)\s*(.*)$/.exec(line);
    if (!m) continue;
    if (!map.has(m[1])) map.set(m[1], []);
    map.get(m[1]).push(m[2].trim());
  }
  return { map, text };
}

/** Returns the Chrome/Chromium executable provided by the environment. */
export async function chromiumPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const mod = await import('@sparticuz/chromium');
    const chromium = mod.default || mod;
    return await chromium.executablePath();
  } catch (error) {
    throw new Error(`Chrome bulunamadı. CHROME_PATH ayarlayın veya @sparticuz/chromium kurun. (${error.message})`);
  }
}

export async function chromiumArgs() {
  try {
    const mod = await import('@sparticuz/chromium');
    const chromium = mod.default || mod;
    return chromium.args || [];
  } catch { return []; }
}

export class Assertions {
  constructor() { this.passed = 0; this.failed = 0; this.failures = []; this.current = ''; }

  test(name) { this.current = name; process.stdout.write(`  • ${name}`); }

  ok(condition, message) {
    if (condition) { this.passed++; process.stdout.write(' ✔\n'); return true; }
    this.failed++; this.failures.push(`${this.current}: ${message}`);
    process.stdout.write(` ✘ ${message}\n`);
    return false;
  }

  equal(actual, expected, message = '') {
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    return this.ok(same, `${message || 'değer eşit değil'} — beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)}`);
  }

  includes(haystack, needle, message = '') {
    return this.ok(String(haystack).includes(needle), `${message || 'metin bulunamadı'} — "${needle}" içinde ${String(haystack).slice(0, 400)}`);
  }

  summary(label) {
    const total = this.passed + this.failed;
    console.log(`\n${label}: ${this.passed}/${total} kontur geçti${this.failed ? `, ${this.failed} başarısız` : ''}.`);
    if (this.failed) { console.log('\nBaşarısız testler:'); for (const f of this.failures) console.log(' - ' + f); }
    return this.failed === 0;
  }
}
