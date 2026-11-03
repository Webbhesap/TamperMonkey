// Loader tests: the real userscript file is executed in Chromium while GitHub
// traffic is emulated through GM_xmlhttpRequest, so no internet is needed.
// Covers: metadata contract, fresh panel/CSS fetch, @resource fallback,
// excluded sites, dev loader (uncaught @require), re-injection guard.
import fs from 'node:fs';
import path from 'node:path';
import { Assertions, ROOT, readBundle, readMetadata, chromiumPath, chromiumArgs } from './helpers.mjs';
import { Harness } from './harness.mjs';
import { startSite } from './site.mjs';

const t = new Assertions();
const files = readBundle();
const site = await startSite();
const filter = process.argv[2] || '';
const only = name => !filter || name.includes(filter);

const REPO_RAW = 'https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/';
const SCRIPTS = ['lib/alpine.min.js', 'lib/jszip.min.js', 'modules/zip.js', 'modules/settings-ui.js',
  'modules/page-tools.js', 'modules/network.js', 'modules/image-analysis.js', 'modules/ui-results.js', 'app.js'];
const SCRIPT_NAMES = SCRIPTS.map(name => name.split('/').pop());

/** Loads a userscript file and splits metadata from code. */
function loadUserscript(name) {
  const { text, map } = readMetadata(name);
  const body = text.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/, '');
  return { text, map, body };
}

const stable = loadUserscript('tampermonkey-loader.user.js');
const dev = loadUserscript('tampermonkey-loader.dev.user.js');

// ---------------------------------------------------------------------------
if (only('metadata')) {
  t.test('Metadata: file:// kalmadı, tüm adresler https ve doğru depo yolunda');
  for (const [label, loader] of [['kararlı', stable], ['geliştirme', dev]]) {
    t.ok(!loader.text.includes('file://'), `${label}: metadata içinde file:// kaldı`);
    const requires = loader.map.get('require') || [];
    const resources = loader.map.get('resource') || [];
    if (label === 'kararlı') {
      t.equal(requires.length, 9, `${label}: @require sayısı`);
      t.ok(requires.every(url => url.startsWith(REPO_RAW)), `${label}: @require depo yolu hatalı`);
      t.equal(requires.map(url => path.basename(new URL(url).pathname)), SCRIPT_NAMES, `${label}: @require sırası`);
      t.equal(resources.length, 2, `${label}: @resource sayısı`);
      t.ok(resources.every(entry => entry.split(/\s+/)[1].startsWith(REPO_RAW)), `${label}: @resource depo yolu hatalı`);
      t.ok((loader.map.get('version') || []).length === 1, `${label}: @version eksik`);
      t.ok((loader.map.get('updateURL') || [])[0]?.startsWith(REPO_RAW), `${label}: @updateURL yok/ham adres değil`);
      t.ok((loader.map.get('downloadURL') || [])[0]?.startsWith(REPO_RAW), `${label}: @downloadURL yok/ham adres değil`);
    } else {
      t.equal(requires.length, 0, `${label}: dev loader @require kullanmamalı`);
      t.ok((loader.map.get('updateURL') || [])[0]?.startsWith(REPO_RAW), `${label}: @updateURL yok`);
    }
    const connect = (loader.map.get('connect') || []).join(' ');
    t.ok(connect.includes('raw.githubusercontent.com'), `${label}: @connect eksik`);
    t.ok(!connect.includes('*'), `${label}: @connect fazla geniş (*)`);
    for (const grant of ['GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest']) {
      t.ok((loader.map.get('grant') || []).includes(grant), `${label}: @grant ${grant} yok`);
    }
    t.ok((loader.map.get('match') || []).includes('*://*/*'), `${label}: @match eksik`);
    t.ok((loader.map.get('run-at') || [])[0] === 'document-idle', `${label}: @run-at document-idle değil`);
    // Geliştirme kılavuzu: sürüm artırma kuralı açıkça yazılmalı.
    t.includes(loader.text, '@version', `${label}: sürüm/önbellek notu`);
  }
}

const harness = new Harness({ executablePath: await chromiumPath(), browserArgs: await chromiumArgs() });
await harness.launch();

/**
 * Opens a page with the userscript environment, stubs GitHub, and runs the loader.
 * `files` map is served for both @require injection and GM fetch URLs.
 */
async function runLoader(loader, { route = '/basic/', failing = [], excluded = false, cssOverride = null, htmlOverride = null, start = false } = {}) {
  const { page } = await harness.open(`${site.origin}${route}`, { files, start, requireScripts: start ? SCRIPTS : [] });
  await page.evaluate(payload => {
    const { html, css, failing, excluded, byPath } = payload;
    if (excluded) window.GM_setValue('isp_excluded_sites_v1', JSON.stringify([location.hostname]));
    window.__gm.requests = [];
    window.__gmResources = { appHtml: html, appCss: css };
    // GitHub'ı taklit et: her istek kaydedilir, istenen dosyalar 404 döner.
    window.GM_xmlhttpRequest = options => {
      const name = options.url.split('?')[0].split('/').pop();
      window.__gm.requests.push(options.url);
      const body = failing.includes(name) ? '' : (byPath[name] ?? '');
      const status = failing.includes(name) || body === '' ? 404 : 200;
      setTimeout(() => {
        if (status === 200) options.onload?.({ status: 200, responseText: body, responseHeaders: 'content-type: text/plain' });
        else options.onload?.({ status: 404, responseText: '', responseHeaders: '' });
      }, 0);
      return { abort() {} };
    };
    window.GM_getResourceText = name => name === 'appHtml' ? html : name === 'appCss' ? css : null;
    window.GM_getResourceURL = name => name === 'appCss' ? 'data:text/css;charset=utf-8,' + encodeURIComponent(css) : null;
  }, {
    html: htmlOverride ?? files['panel.html'],
    css: cssOverride ?? files['styles.css'],
    failing, excluded,
    byPath: Object.fromEntries(Object.entries(files).map(([key, value]) => [key.split('/').pop(), value])),
  });
  const logs = [];
  page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
  page.__loaderLogs = logs;
  await page.evaluate(loader.body);
  return page;
}

const hasPanel = page => page.evaluate(() => !!document.getElementById('__image_scraper_v4__')?.shadowRoot?.querySelector('.launch'));

// ---------------------------------------------------------------------------
if (only('kararlı')) {
  t.test('Kararlı loader: app.js @require ile geldi, panel ve CSS GitHub’dan tazelenir');
  {
    const page = await runLoader(stable, { start: false });
    // @require dosyaları loader'dan önce yüklenmiş olmalı.
    await page.evaluate(SCRIPTS.map(name => files[name]).join('\n;\n'));
    // Loader'ı yeniden çalıştır: bu kez ImageScraperApp hazır.
    await page.evaluate(stable.body);
    await page.waitForFunction(() => document.getElementById('__image_scraper_v4__')?.shadowRoot?.querySelector('.launch'), { timeout: 15000 }).catch(() => {});
    const info = await page.evaluate(() => {
      const root = document.getElementById('__image_scraper_v4__')?.shadowRoot;
      return {
        panel: !!root?.querySelector('.launch'),
        requests: window.__gm.requests.slice(),
        cssLink: root?.querySelector('link[rel=stylesheet]')?.href?.slice(0, 5) || '',
      };
    });
    t.ok(info.panel, 'Panel oluşturulmadı');
    t.ok(info.requests.some(url => url.includes('panel.html?_=')), 'panel.html önbellek atlatarak istenmedi');
    t.ok(info.requests.some(url => url.includes('styles.css?_=')), 'styles.css önbellek atlatarak istenmedi');
    t.equal(info.cssLink, 'blob:', 'CSS blob URL olarak bağlanmadı');
    await page.close();
  }

  t.test('Kararlı loader: GitHub erişilemezse @resource yedeğine düşer');
  {
    const page = await runLoader(stable, { failing: ['panel.html', 'styles.css'] });
    await page.evaluate(SCRIPTS.map(name => files[name]).join('\n;\n'));
    await page.evaluate(stable.body);
    await page.waitForFunction(() => document.getElementById('__image_scraper_v4__')?.shadowRoot?.querySelector('.launch'), { timeout: 15000 }).catch(() => {});
    t.ok(await hasPanel(page), '@resource yedeğiyle panel oluşturulmadı');
    t.ok(page.__loaderLogs.some(line => line.includes('@resource kopyası kullanılacak')), 'Yedek kullanımı günlüğe yazılmadı');
    await page.close();
  }

  t.test('Kararlı loader: panel.html bozuk gelirse yedeğe düşer (şablon doğrulaması)');
  {
    const page = await runLoader(stable, { htmlOverride: '<html><body>bozuk</body></html>' });
    await page.evaluate(SCRIPTS.map(name => files[name]).join('\n;\n'));
    await page.evaluate(stable.body);
    await page.waitForFunction(() => document.getElementById('__image_scraper_v4__')?.shadowRoot?.querySelector('.launch'), { timeout: 15000 }).catch(() => {});
    t.ok(await hasPanel(page), 'Bozuk GitHub yanıtı yedeğe düşürmedi');
    await page.close();
  }

  t.test('Kararlı loader: hariç tutulan sitede hiç ağ isteği yapılmaz');
  {
    const page = await runLoader(stable, { excluded: true });
    await page.evaluate(SCRIPTS.map(name => files[name]).join('\n;\n'));
    await page.evaluate(stable.body);
    await new Promise(resolve => setTimeout(resolve, 500));
    const state = await page.evaluate(() => ({ requests: window.__gm.requests.slice(), panel: !!document.getElementById('__image_scraper_v4__') }));
    t.equal(state.requests.length, 0, 'Hariç tutulan sitede istek yapıldı: ' + state.requests.join(','));
    t.equal(state.panel, false, 'Hariç tutulan sitede panel oluşturuldu');
    await page.close();
  }

  t.test('Kararlı loader: app.js yüklenemezse anlaşılır hata verir, sayfayı bozmaz');
  {
    const { page } = await harness.open(`${site.origin}/basic/`, { files, start: false });
    const logs = [];
    page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
    await page.evaluate(() => { window.GM_xmlhttpRequest = options => { setTimeout(() => options.onload({ status: 200, responseText: '<html></html>' }), 0); return { abort() {} }; }; });
    await page.evaluate(stable.body);
    await new Promise(resolve => setTimeout(resolve, 800));
    const state = await page.evaluate(() => ({ panel: !!document.getElementById('__image_scraper_v4__'), title: document.title }));
    t.ok(logs.some(line => line.includes('app.js yüklenemedi')), 'Anlaşılır hata mesajı yok: ' + logs.join(' | ').slice(0, 300));
    t.equal(state.panel, false, 'app.js yokken panel oluşturuldu');
    t.equal(state.title, 'Temel sayfa', 'Sayfa başlığı bozuldu');
    await page.close();
  }
}

// ---------------------------------------------------------------------------
if (only('geliştirme')) {
  t.test('Geliştirme loader: dokuz JS dosyasını da indirir, sırayla çalıştırır');
  {
    const page = await runLoader(dev);
    await page.waitForFunction(() => document.getElementById('__image_scraper_v4__')?.shadowRoot?.querySelector('.launch'), { timeout: 20000 }).catch(() => {});
    const info = await page.evaluate(() => ({
      panel: !!document.getElementById('__image_scraper_v4__')?.shadowRoot?.querySelector('.launch'),
      requests: window.__gm.requests.slice(),
      hasApp: typeof globalThis.ImageScraperApp?.start === 'function',
      hasModules: typeof globalThis.ImageScraperModules === 'object',
    }));
    t.ok(info.panel, 'Geliştirme loader paneli oluşturmadı');
    t.ok(info.hasApp && info.hasModules, 'Modüller çalıştırılmadı');
    for (const name of [...SCRIPT_NAMES, 'panel.html', 'styles.css']) {
      t.ok(info.requests.some(url => url.includes(name)), `${name} istenmedi`);
    }
    t.ok(info.requests.every(url => url.includes('?_=')), 'İsteklerde önbellek atlatma yok');
    await page.close();
  }
}

// ---------------------------------------------------------------------------
if (only('yeniden')) {
  t.test('Aynı belgeye iki kez enjekte edilirse panel ikilenmez');
  {
    const page = await runLoader(dev);
    await page.waitForFunction(() => document.getElementById('__image_scraper_v4__')?.shadowRoot?.querySelector('.launch'), { timeout: 20000 }).catch(() => {});
    const before = await page.evaluate(() => document.querySelectorAll('#__image_scraper_v4__').length);
    await page.evaluate(dev.body);
    await new Promise(resolve => setTimeout(resolve, 600));
    const after = await page.evaluate(() => document.querySelectorAll('#__image_scraper_v4__').length);
    t.equal(before, 1, 'Başlangıçta tek panel yok');
    t.equal(after, 1, 'İkinci enjeksiyon paneli çoğalttı');
    await page.close();
  }
}

t.summary('Loader testleri');
await harness.close();
await site.close();
process.exit(t.failed ? 1 : 0);
