// End-to-end browser tests: real Chromium, real DOM, real network (local site).
// Usage: node tests/run-browser.mjs [filter]
import fs from 'node:fs';
import path from 'node:path';
import { Assertions, ROOT, readBundle, chromiumPath, chromiumArgs } from './helpers.mjs';
import { startSite } from './site.mjs';
import { Harness } from './harness.mjs';

const t = new Assertions();
const filter = process.argv[2] || '';
const files = readBundle();
const site = await startSite();
const harness = new Harness({ executablePath: await chromiumPath(), browserArgs: await chromiumArgs() });
await harness.launch();

const only = name => !filter || name.includes(filter);

async function openApp(route = '/basic/', options = {}) {
  const { page, pageErrors, consoleMessages } = await harness.open(`${site.origin}${route}`, { files, ...options });
  page.on('dialog', async dialog => {
    page.__dialogs = page.__dialogs || [];
    page.__dialogs.push({ type: dialog.type(), message: dialog.message() });
    await dialog.accept().catch(() => {});
  });
  page.on('requestfailed', request => { (page.__failedRequests = page.__failedRequests || []).push(request.url()); });
  page.__pageErrors = pageErrors; page.__console = consoleMessages;
  if (options.expectUI !== false) await page.waitForFunction(() => document.getElementById('__image_scraper_v4__')?.shadowRoot?.querySelector('.launch'));
  else await page.waitForFunction(() => window.__gm && window.ImageScraperApp);
  return page;
}

const clickInUI = (page, selector) => page.evaluate(sel => {
  const root = document.getElementById('__image_scraper_v4__').shadowRoot;
  const node = root.querySelector(sel);
  if (!node) throw new Error('bulunamadı: ' + sel);
  node.click();
  return true;
}, selector);

const uiText = page => page.evaluate(() => document.getElementById('__image_scraper_v4__').shadowRoot.textContent);

const waitText = (page, needle, timeout = 30000) => page.waitForFunction(
  text => (document.getElementById('__image_scraper_v4__')?.shadowRoot?.textContent || '').includes(text),
  { timeout, polling: 100 }, needle);

const setStorage = (page, entries) => page.evaluate(data => { for (const [k, v] of Object.entries(data)) window.GM_setValue(k, typeof v === 'string' ? v : JSON.stringify(v)); }, entries);
const getStorage = (page, key) => page.evaluate(k => window.GM_getValue(k, null), key);

const dialogCount = page => page.evaluate(() => document.getElementById('__image_scraper_v4__').shadowRoot.querySelectorAll('.overlay').length);

async function runScan(page, { expectResults = true, timeout = 60000 } = {}) {
  await clickInUI(page, '.launch [data-isp-action="scan"]');
  if (!expectResults) {
    await page.waitForFunction(() => !document.getElementById('__image_scraper_v4__').shadowRoot.querySelector('.launch [data-isp-action="scan"]').textContent.includes('Taranıyor'), { timeout });
    return;
  }
  await page.waitForFunction(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    return [...root.querySelectorAll('.overlay h2')].some(node => node.textContent === 'Tarama sonuçları');
  }, { timeout, polling: 100 });
}

// ---------------------------------------------------------------------------
if (only('UI kurulumu')) {
  t.test('UI kurulumu: shadow root, başlat düğmeleri, CSS');
  const page = await openApp();
  const info = await page.evaluate(async () => {
    const host = document.getElementById('__image_scraper_v4__');
    const root = host.shadowRoot;
    const buttons = [...root.querySelectorAll('.launch button')].map(b => b.textContent.trim());
    const link = root.querySelector('link[rel="stylesheet"]');
    const stylesheetLoaded = !!link && (await new Promise(resolve => {
      if (link.sheet) return resolve(true);
      link.addEventListener('load', () => resolve(true), { once: true });
      link.addEventListener('error', () => resolve(false), { once: true });
      setTimeout(() => resolve(!!link.sheet), 2000);
    }));
    return { buttons, href: link?.getAttribute('href') || '', stylesheetLoaded, rules: link?.sheet?.cssRules?.length || 0 };
  });
  t.ok(info.buttons.length === 2, `Başlat düğmesi sayısı: ${info.buttons.length}`);
  t.ok(info.stylesheetLoaded && info.rules > 20, `Stil sayfası yüklenmedi (${info.href.slice(0, 40)}…, ${info.rules} kural)`);
  t.ok(await page.evaluate(() => getComputedStyle(document.getElementById('__image_scraper_v4__')).position === 'fixed'), 'Host konumu fixed değil');
  t.ok(page.__pageErrors.length === 0, 'Sayfa hatası: ' + page.__pageErrors.join(' | '));
  // Host stillerinin sayfayı bozmadığını doğrula
  t.ok(await page.evaluate(() => getComputedStyle(document.querySelector('h1')).fontSize !== '0px'), 'Sayfa h1 stili bozuldu');
  await page.close();
}

// ---------------------------------------------------------------------------
let lastResultSummary = '';
if (only('Temel tarama')) {
  t.test('Temel tarama: benzersiz görseller, boyut filtresi, tekrarlar');
  const page = await openApp('/basic/');
  await runScan(page);
  const summary = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const values = [...root.querySelectorAll('.metric-value')].map(n => n.textContent.trim());
    const images = [...root.querySelectorAll('.image-card')].map(card => card.querySelector('.meta strong')?.title || '');
    return { values, images, cards: root.querySelectorAll('.image-card').length };
  });
  lastResultSummary = JSON.stringify(summary);
  t.equal(summary.values[0], '5', 'Benzersiz görsel sayısı (blue-320x240 yükseklik filtresine takılır)');
  t.equal(summary.values[1], '1', 'Taranan sayfa sayısı');
  t.ok(Number(summary.values[2]) >= 2, `Tekrar sayısı beklenen ≥2, gelen ${summary.values[2]}`);
  const urls = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const textarea = root.querySelector('.output');
    return textarea ? textarea.value.split('\n').filter(Boolean) : [];
  });
  t.equal(urls.length, 5, 'Seçili URL sayısı');
  t.ok(urls.every(u => u.startsWith(site.origin)), 'URL tabanı hatalı: ' + urls[0]);
  t.ok(!urls.some(u => /thumb|1x1|pixel/.test(u)), 'Atlama deseni uygulanmadı: ' + urls.filter(u => /thumb|1x1|pixel/.test(u)).join(','));
  t.ok(!urls.some(u => /tiny-30x30/.test(u)), 'Min boyut filtresi uygulanmadı');
  t.ok(urls.some(u => u.includes('spaced%20name%20500x400.png') || u.includes('spaced name')), 'Boşluklu dosya adı yok');
  t.ok(urls.some(u => u.includes('green-1200x800')), 'srcset/picture görseli seçilmedi');
  t.ok(urls.some(u => u.endsWith('vector.svg')), 'SVG sonuçlarda yok');
  t.ok(urls.some(u => u.includes('pattern-900x600')), 'Lazy-load (data-src) görseli yok');
  t.ok(page.__pageErrors.length === 0, 'Sayfa hatası: ' + page.__pageErrors.join(' | '));
  await page.close();
}

// ---------------------------------------------------------------------------
if (only('Ayarlar arayüzü')) {
  t.test('Ayarlar: sekmeler, kaydetme, doğrulama, sıfırlama');
  const page = await openApp('/selector/');
  await clickInUI(page, '.launch [data-isp-action="settings"]');
  await page.waitForFunction(() => [...document.getElementById('__image_scraper_v4__').shadowRoot.querySelectorAll('.overlay h2')].some(n => n.textContent === 'Ayarlar'));
  const tabs = await page.evaluate(() => [...document.getElementById('__image_scraper_v4__').shadowRoot.querySelectorAll('.settings-tabs [data-tab-key]')].map(t => t.dataset.tabKey));
  t.equal(tabs, ['general', 'scan', 'images', 'zip', 'excluded', 'backup', 'records'], 'Sekme listesi');
  const visibility = [];
  for (const key of tabs) {
    await page.evaluate(k => document.getElementById('__image_scraper_v4__').shadowRoot.querySelector(`[data-tab-key="${k}"]`).click(), key);
    // Alpine sekme geçişini bir sonraki görev döngüsünde uygular; sabit süre
    // beklemek yerine koşulun gerçekleşmesini bekle (yavaş makinelerde de kararlı).
    await page.waitForFunction(k => {
      const root = document.getElementById('__image_scraper_v4__').shadowRoot;
      const selected = root.querySelector('.settings-tabs [aria-selected="true"]')?.dataset.tabKey;
      const pane = root.querySelector(`#isp-${k}-panel`);
      const generalHidden = root.querySelector('#isp-general-panel').getClientRects().length === 0;
      return selected === k && pane && pane.getClientRects().length > 0 && (k === 'general' || generalHidden);
    }, { timeout: 5000, polling: 50 }, key).catch(() => {});
    visibility.push(await page.evaluate(() => {
      const root = document.getElementById('__image_scraper_v4__').shadowRoot;
      const panes = [...root.querySelectorAll('[role="tabpanel"]')].filter(p => p.getClientRects().length);
      const selected = root.querySelector('.settings-tabs [aria-selected="true"]')?.dataset.tabKey;
      return { visible: panes.map(p => p.id), selected, generalHidden: root.querySelector('#isp-general-panel').getClientRects().length === 0 };
    }));
  }
  t.ok(visibility.every(v => v.selected && v.visible.length === 1), 'Sekme görünürlüğü hatalı: ' + JSON.stringify(visibility));
  t.ok(visibility[1].generalHidden, 'İkinci sekmede genel panel gizlenmedi');
  // Değer değiştir + kaydet
  await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    root.querySelector('[data-tab-key="general"]').click();
  });
  const saved = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    root.querySelector('[data-tab-key="scan"]').click();
    const max = root.querySelector('[data-control="max"]');
    max.value = '3';
    const real = root.querySelector('[data-control="real"]');
    real.checked = false;
    root.querySelector('[data-action="settings-save"]').click();
    const raw = GM_getValue('isp_config', null);
    return { raw, dialogs: root.querySelectorAll('.overlay').length };
  });
  const config = JSON.parse(saved.raw || '{}');
  t.equal(config.MAX_PAGES, 3, 'MAX_PAGES kaydedilmedi');
  t.equal(config.CHECK_REAL_SIZE, false, 'CHECK_REAL_SIZE kaydedilmedi');
  t.equal(saved.dialogs, 0, 'Kaydet sonrası pencere kapanmadı');
  // Geçersiz değer → hata mesajı
  await clickInUI(page, '.launch [data-isp-action="settings"]');
  const invalid = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    root.querySelector('[data-tab-key="scan"]').click();
    const max = root.querySelector('[data-control="max"]');
    max.value = '999';
    root.querySelector('[data-action="settings-save"]').click();
    return { error: root.querySelector('[data-control="settingsError"]').textContent, open: root.querySelectorAll('.overlay').length };
  });
  t.includes(invalid.error, '0–50', 'Aralık doğrulama mesajı');
  t.equal(invalid.open, 1, 'Geçersiz değerde pencere kapanmamalı');
  // Sıfırla
  const reset = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    root.querySelector('[data-action="settings-reset"]').click();
    return GM_getValue('isp_config', null);
  });
  t.equal(JSON.parse(reset || '{}').MAX_PAGES, 5, 'Varsayılana dönüş');
  await page.close();
}

// ---------------------------------------------------------------------------
if (only('Sayfalama')) {
  const cases = [
    ['html-slash', '/paged-html/index.html'],
    ['query-page', '/paged-query/'],
    ['page-path', '/paged-path/'],
    ['slash-page', '/paged-slash/'],
    ['dash-html', '/paged-dash/post-1.html'],
    ['custom', '/paged-custom/1'],
  ];
  for (const [mode, route] of cases) {
    t.test(`Sayfalama: ${mode}`);
    const page = await openApp(route);
    await setStorage(page, { isp_config: JSON.stringify({ PAGINATION_MODE: mode, MAX_PAGES: 5, MIN_WIDTH: 0, MIN_HEIGHT: 0, CHECK_REAL_SIZE: true, STOP_DUPLICATE_PAGES: true, CUSTOM_PAGINATION_TEMPLATE: mode === 'custom' ? '{url}/{n}' : '{url}/{n}' }) });
    await runScan(page);
    const summary = await page.evaluate(() => {
      const root = document.getElementById('__image_scraper_v4__').shadowRoot;
      return { values: [...root.querySelectorAll('.metric-value')].map(n => n.textContent.trim()), warnings: [...root.querySelectorAll('.link-warning-list p')].map(n => n.textContent) };
    });
    t.equal(summary.values[1], '3', `${mode}: taranan sayfa`);
    t.equal(summary.values[0], '3', `${mode}: benzersiz görsel`);
    await page.close();
  }
  t.test('Sayfalama: 404 sonrası durur ve hata raporlanır');
  const endPage = await openApp('/paged-query/');
  await setStorage(endPage, { isp_config: JSON.stringify({ PAGINATION_MODE: 'query-page', MAX_PAGES: 5, MIN_WIDTH: 0, MIN_HEIGHT: 0, STOP_DUPLICATE_PAGES: false }) });
  await runScan(endPage);
  const endSummary = await endPage.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    return { values: [...root.querySelectorAll('.metric-value')].map(n => n.textContent.trim()), text: root.textContent };
  });
  t.equal(endSummary.values[1], '3', 'Son sayfadan sonra 404 alındığında tarama durmalı');
  t.includes(endSummary.text, 'HTTP 404', '404 uyarısı gösterilmedi');
  await endPage.close();

  t.test('Sayfalama sınırı ve yinelenen sayfa koruması');
  const page = await openApp('/paged-query/');
  await setStorage(page, { isp_config: JSON.stringify({ PAGINATION_MODE: 'query-page', MAX_PAGES: 2, MIN_WIDTH: 0, MIN_HEIGHT: 0 }) });
  await runScan(page);
  let values = await page.evaluate(() => [...document.getElementById('__image_scraper_v4__').shadowRoot.querySelectorAll('.metric-value')].map(n => n.textContent.trim()));
  t.equal(values[1], '2', 'MAX_PAGES=2 uygulanmadı');
  await page.close();

  const dupPage = await openApp('/duplicate-page/');
  await setStorage(dupPage, { isp_config: JSON.stringify({ PAGINATION_MODE: 'query-page', MAX_PAGES: 5, MIN_WIDTH: 0, MIN_HEIGHT: 0, STOP_DUPLICATE_PAGES: true }) });
  await runScan(dupPage);
  const dup = await dupPage.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    return { values: [...root.querySelectorAll('.metric-value')].map(n => n.textContent.trim()), text: root.textContent };
  });
  t.equal(dup.values[1], '1', 'Yinelenen sayfa taranmış sayılmamalı');
  t.includes(dup.text, 'aynı metin ve görselleri', 'Yinelenen sayfa uyarısı yok');
  await dupPage.close();
}

// ---------------------------------------------------------------------------
if (only('Seçiciler')) {
  t.test('Görsel seçicisi yalnızca eşleşen alanı tarar');
  const page = await openApp('/selector/');
  await setStorage(page, { isp_config: JSON.stringify({ USE_SELECTOR: true, SELECTOR: '.single-content > p', MIN_WIDTH: 0, MIN_HEIGHT: 0, CHECK_REAL_SIZE: true }) });
  await runScan(page);
  const urls = await page.evaluate(() => document.getElementById('__image_scraper_v4__').shadowRoot.querySelector('.output').value.split('\n').filter(Boolean));
  t.equal(urls.length, 2, 'Seçici sonucu');
  t.ok(!urls.some(u => u.includes('green-1200x800')), 'Seçici dışındaki görsel alınmış');
  await page.close();

  t.test('Geçersiz seçici kaydetmeyi engeller');
  const page2 = await openApp('/selector/');
  await clickInUI(page2, '.launch [data-isp-action="settings"]');
  const message = await page2.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    root.querySelector('[data-tab-key="images"]').click();
    root.querySelector('[data-control="useSel"]').checked = true;
    root.querySelector('[data-control="selector"]').value = 'div[';
    root.querySelector('[data-action="settings-save"]').click();
    return root.querySelector('[data-control="settingsError"]').textContent;
  });
  t.ok(message.length > 5, 'Geçersiz CSS seçici hatası gösterilmedi');
  await page2.close();
}

// ---------------------------------------------------------------------------
if (only('Derin tarama')) {
  t.test('Derin tarama: kategori → içerik → alt sayfa');
  const page = await openApp('/category/');
  await setStorage(page, { isp_config: JSON.stringify({ DEEP_CRAWL: true, MAX_PAGES: 2, MAX_ARTICLES: 2, ARTICLE_MAX_PAGES: 2, MIN_WIDTH: 0, MIN_HEIGHT: 0, STOP_DUPLICATE_PAGES: true }) });
  await runScan(page, { timeout: 90000 });
  const summary = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    return { values: [...root.querySelectorAll('.metric-value')].map(n => n.textContent.trim()), cards: [...root.querySelectorAll('.image-card .meta')].map(n => n.textContent) };
  });
  // MAX_ARTICLES=2 ve ARTICLE_MAX_PAGES=2: makale 1 → 2 alt sayfa, makale 2 → 1 alt sayfa (sınır uyarısı)
  t.equal(summary.values[1], '3', 'Taranan içerik sayfaları');
  t.equal(summary.values[0], '3', 'Benzersiz görsel');
  t.includes((await page.evaluate(() => document.getElementById('__image_scraper_v4__').shadowRoot.textContent)), '2 sayfalık sınırda durdu', 'İçerik sayfa sınırı uyarısı');
  t.ok(summary.cards.some(c => c.includes('Konu: İçerik')), 'Konu bilgisi kartlarda yok');
  await page.close();
}

// ---------------------------------------------------------------------------
if (only('Sayfa kuyruğu')) {
  t.test('Sayfa önizleme kuyruğu: seçim yapılabilir ve yalnız seçilen taranır');
  const page = await openApp('/paged-query/');
  await setStorage(page, { isp_config: JSON.stringify({ PAGINATION_MODE: 'query-page', MAX_PAGES: 3, PREVIEW_PAGE_QUEUE: true, MIN_WIDTH: 0, MIN_HEIGHT: 0 }) });
  await clickInUI(page, '.launch [data-isp-action="scan"]');
  await waitText(page, 'Taranacak sayfalar');
  const rows = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const items = [...root.querySelectorAll('.page-queue-item')];
    items.slice(1).forEach(item => item.querySelector('input[type=checkbox]').click());
    const startButton = [...root.querySelectorAll('button')].find(b => b.textContent.includes('Seçilenleri tara'));
    startButton.click();
    return items.length;
  });
  t.equal(rows, 3, 'Kuyruk satır sayısı');
  await page.waitForFunction(() => [...document.getElementById('__image_scraper_v4__').shadowRoot.querySelectorAll('.overlay h2')].some(n => n.textContent === 'Tarama sonuçları'), { timeout: 30000 });
  const values = await page.evaluate(() => [...document.getElementById('__image_scraper_v4__').shadowRoot.querySelectorAll('.metric-value')].map(n => n.textContent.trim()));
  t.equal(values[1], '1', 'Yalnız seçilen sayfa taranmalı');
  await page.close();
}

// ---------------------------------------------------------------------------
if (only('ZIP')) {
  t.test('ZIP üretimi: dosyalar, adlar ve tekilleştirme');
  const page = await openApp('/basic/');
  await setStorage(page, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0, ZIP_FILENAME: 'test-arsiv.zip', CHECK_REAL_SIZE: true, DEDUPE_CONTENT: true, NAME_TEMPLATE: '{sira}_{orijinal_ad}' }) });
  await runScan(page);
  await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const tab = [...root.querySelectorAll('.result-tabs button')].find(b => b.textContent === 'ZIP ve indirme');
    tab.click();
    root.querySelector('.result-pane [class="primary"]').click();
  });
  // Bitişi durum metni yerine oluşan indirme bağlantısından doğrula (daha kesin).
  await page.waitForFunction(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    return !!root.querySelector('a.download-link');
  }, { timeout: 90000, polling: 100 });
  const zipInfo = await page.evaluate(async () => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const link = root.querySelector('a.download-link');
    if (!link) return { error: 'indirme bağlantısı yok' };
    const response = await fetch(link.href);
    const buffer = await response.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files);
    const signature = [...new Uint8Array(buffer.slice(0, 4))].map(x => x.toString(16).padStart(2, '0')).join(' ');
    return { name: link.getAttribute('download'), size: buffer.byteLength, names, signature, status: root.querySelector('.result-pane .status')?.textContent };
  });
  t.ok(!zipInfo.error, `ZIP: ${zipInfo.error || ''}`);
  t.equal(zipInfo.signature, '50 4b 03 04', 'ZIP imzası');
  t.ok(zipInfo.names.length >= 6, 'ZIP dosya sayısı: ' + (zipInfo.names || []).length);
  t.ok((zipInfo.names || []).some(n => n.startsWith('001_')), 'Ad şablonu uygulanmadı: ' + (zipInfo.names || []).slice(0, 3));
  t.ok(!(zipInfo.names || []).some(n => /thumb|1x1|pixel/.test(n)), 'Atlama deseni ZIP içinde de geçerli');
  t.includes(zipInfo.name, 'test-arsiv', 'ZIP dosya adı');
  await page.close();

  t.test('ZIP: hatalı görseller raporlanır, geçerli dosyalar eklenir');
  const page2 = await openApp('/broken-images/');
  await setStorage(page2, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0 }) });
  await runScan(page2);
  await page2.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    [...root.querySelectorAll('.result-tabs button')].find(b => b.textContent === 'ZIP ve indirme').click();
    root.querySelector('.result-pane [class="primary"]').click();
  });
  // "hata" kelimesi indirme ilerlemesinde ("hata: 0") de geçer; bitişi
  // doğrudan indirme bağlantısının oluşmasıyla bekle. Aksi halde test,
  // ZIP henüz hazır değilken okuyup kararsız sonuç verir.
  await page2.waitForFunction(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const link = root.querySelector('a.download-link');
    const statusText = root.querySelector('.result-pane .status')?.textContent || '';
    return !!link || statusText.startsWith('❌') || statusText.startsWith('⏹️');
  }, { timeout: 90000, polling: 100 });
  const broken = await page2.evaluate(async () => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const link = root.querySelector('a.download-link');
    const buffer = link ? await (await fetch(link.href)).arrayBuffer() : null;
    const names = buffer ? Object.keys((await JSZip.loadAsync(buffer)).files) : [];
    const details = root.querySelector('.result-pane details .error-list')?.textContent || '';
    return { names, details, status: root.querySelector('.result-pane .status')?.textContent };
  });
  t.ok(broken.names.includes('_indirme_hatalari.txt'), 'Hata raporu ZIP içinde yok: ' + broken.names.join(','));
  t.includes(broken.details, '404', 'Hata ayrıntısı 404 içermiyor');
  t.ok(!broken.names.some(n => n.includes('403.png') || n.includes('404.png')), 'Başarısız görsel ZIP’e eklenmiş');
  await page2.close();
}

// ---------------------------------------------------------------------------
if (only('Oturum')) {
  t.test('Oturum kaydet → kapat → kayıtlı oturumu aç');
  const page = await openApp('/basic/');
  await setStorage(page, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0 }) });
  await runScan(page);
  await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    [...root.querySelectorAll('.result-tabs button')].find(b => b.textContent === 'Oturum').click();
    [...root.querySelectorAll('.result-pane button')].find(b => b.textContent.includes('Oturumu kaydet')).click();
  });
  const stored = await getStorage(page, 'isp_session_v1');
  t.ok(stored && JSON.parse(stored).images.length === 7, 'Oturum deposu yazılmadı');
  await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    root.querySelector('.overlay [data-isp-action="close"]').click();
    root.querySelector('.launch [data-isp-action="settings"]').click();
  });
  const reopened = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    root.querySelector('[data-tab-key="records"]').click();
    const button = [...root.querySelectorAll('button')].find(b => b.textContent.includes('Kayıtlı oturumu aç'));
    button.click();
    return new Promise(resolve => setTimeout(() => resolve([...root.querySelectorAll('.overlay h2')].map(n => n.textContent)), 500));
  });
  t.ok(reopened.includes('Tarama sonuçları'), 'Kayıtlı oturum açılmadı: ' + reopened.join(','));
  const count = await page.evaluate(() => document.getElementById('__image_scraper_v4__').shadowRoot.querySelector('.metric-value').textContent);
  t.equal(count, '7', 'Açılan oturumdaki görsel sayısı');
  await page.close();
}

// ---------------------------------------------------------------------------
if (only('Hariç tutulan siteler')) {
  t.test('Hariç tutulan site: panel ve tarama çalışmaz');
  const page = await openApp('/basic/');
  await clickInUI(page, '.launch [data-isp-action="settings"]');
  const message = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    root.querySelector('[data-tab-key="excluded"]').click();
    root.querySelector('[data-control="excludedInput"]').value = new URL(location.href).hostname;
    [...root.querySelectorAll('button')].find(b => b.textContent === 'Siteyi ekle').click();
    return { status: root.querySelector('[data-control="excludedStatus"]').textContent, list: root.querySelector('[data-control="excludedList"]').textContent, storage: GM_getValue('isp_excluded_sites_v1', null) };
  });
  t.includes(message.status, 'yenile', 'Hariç tutma bilgi mesajı');
  t.ok(message.storage && message.storage.includes('127.0.0.1'), 'Hariç tutma listesi kaydedilmedi');
  await page.close();
  // Yeni sayfa (aynı kaynak, paylaşılan GM deposu) ile hariç tutma kontrolü
  const page2 = await openApp('/basic/', { resetStorage: false, expectUI: false });
  await new Promise(resolve => setTimeout(resolve, 500));
  t.equal(await page2.evaluate(() => !!document.getElementById('__image_scraper_v4__')), false, 'Hariç tutulan sitede panel oluşturuldu');
  const requests = await page2.evaluate(() => window.__gm.seenRequests.length);
  t.equal(requests, 0, 'Hariç tutulan sitede ağ isteği yapıldı');
  await page2.close();
}

// ---------------------------------------------------------------------------
if (only('Ağ hataları')) {
  t.test('Cloudflare/403 sonraki sayfa: tarama durur, uyarı ve doğrulama bağlantısı gösterilir');
  const page = await openApp('/challenge-link/');
  await setStorage(page, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0, MAX_PAGES: 3, STOP_DUPLICATE_PAGES: false }) });
  await runScan(page, { timeout: 60000 });
  const info = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    return { text: root.textContent, links: [...root.querySelectorAll('a')].map(a => a.textContent), values: [...root.querySelectorAll('.metric-value')].map(n => n.textContent) };
  });
  t.includes(info.text, 'Cloudflare', 'Cloudflare uyarısı yok');
  t.equal(info.values[1], '1', 'Challenge sonrası tarama durmalı');
  t.ok(info.links.some(l => l.includes('doğrulamayı tamamla')), 'Doğrulama bağlantısı yok');
  await page.close();

  t.test('Challenge/403 hata türleri tanılama raporuna yansır');
  const page3 = await openApp('/forbidden-link/');
  await setStorage(page3, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0, MAX_PAGES: 3 }) });
  await runScan(page3, { timeout: 60000 });
  const diagnostics = await page3.evaluate(async () => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    [...root.querySelectorAll('.result-tabs button')].find(b => b.textContent.startsWith('Bağlantılar')).click();
    const button = [...root.querySelectorAll('button')].find(b => b.textContent.includes('Tanılama'));
    let blob = null;
    const original = URL.createObjectURL;
    URL.createObjectURL = value => { blob = value; return original.call(URL, value); };
    button.click();
    URL.createObjectURL = original;
    return blob ? JSON.parse(await blob.text()) : null;
  });
  t.ok(diagnostics && diagnostics.format === 'image-scraper-diagnostics', 'Tanılama raporu üretilmedi');
  t.ok(diagnostics?.counts?.blockedPages === 1, 'Engellenen sayfa sayısı: ' + JSON.stringify(diagnostics?.counts?.blockedPages));
  t.ok(!JSON.stringify(diagnostics).includes('127.0.0.1'), 'Tanılama raporu ham URL/hostname içeriyor');
  await page3.close();

  t.test('Yerelleştirilmiş Cloudflare sayfası da challenge olarak tanınır (başlık İngilizce değil)');
  const page4 = await openApp('/challenge-tr-link/');
  await setStorage(page4, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0, MAX_PAGES: 3, STOP_DUPLICATE_PAGES: false }) });
  await runScan(page4, { timeout: 60000 });
  const localized = await page4.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    return { text: root.textContent, values: [...root.querySelectorAll('.metric-value')].map(n => n.textContent) };
  });
  // Sayfa normal HTML sanılsaydı tarama devam eder ve 2 sayfa taranmış görünürdü.
  t.equal(localized.values[1], '1', 'Yerelleştirilmiş challenge sonrası tarama durmalı');
  t.includes(localized.text, 'Cloudflare', 'Yerelleştirilmiş challenge için uyarı yok');
  await page4.close();
}

// ---------------------------------------------------------------------------
if (only('Performans')) {
  t.test('Büyük sayfa: 5.200 görselde tarama ve galeri makul sürede kalır');
  // Korunan davranış: sanallaştırılmış galeri (binlerce kart DOM'a yazılmaz)
  // ve ölçülü tarama süresi. Sayılar ölçümle belirlendi; eşikler bol paylı.
  const page = await openApp('/huge/');
  await setStorage(page, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0, CHECK_REAL_SIZE: false }) });
  const startedAt = Date.now();
  await runScan(page, { timeout: 120000 });
  const elapsed = Date.now() - startedAt;
  const info = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    return {
      values: [...root.querySelectorAll('.metric-value')].map(n => n.textContent.trim()),
      cards: root.querySelectorAll('.image-card').length,
      spacers: root.querySelectorAll('.virtual-spacer').length,
      rows: root.querySelectorAll('.gallery > *').length,
    };
  });
  t.equal(info.values[0], '5', 'Benzersiz görsel sayısı (5 farklı dosya)');
  // 5000 görsel 5 adı döngüyle kullanır (her biri 1000 kez) + 200 ek "red".
  t.equal(info.values[2], '5195', 'Tekrar edilen URL sayısı');
  t.ok(elapsed < 30000, `Tarama çok yavaş: ${elapsed} ms (sınır 30000)`);
  t.ok(info.cards < 60, `Galeri sanallaştırılmadı: ${info.cards} kart DOM'da`);
  await page.close();
}

// ---------------------------------------------------------------------------
// Görsel regresyon: galeri sekmesinin altında boş şerit kalmamalı ve
// "Görselleri filtrele ve seç" düğmesi galerinin üstünde ayrı bir araç
// çubuğunda değil, sekme çubuğunun sağ ucunda durmalı.
// Bu iki hata bir kez ürün olarak bildirildi; testlerle kilitlendi.
if (only('Galeri düzeni')) {
  t.test('Galeri düzeni: alt boşluk yok, filtre düğmesi sekme çubuğunda');
  const page = await openApp('/basic/');
  await page.setViewport({ width: 1280, height: 800 });
  await setStorage(page, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0 }) });
  await runScan(page);
  // Sanallaştırma/yerleşim bir sonraki karede oturur.
  await new Promise(resolve => setTimeout(resolve, 600));
  const geo = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const box = node => { if (!node) return null; const r = node.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), right: Math.round(r.right), height: Math.round(r.height) }; };
    const workspace = root.querySelector('.result-workspace');
    const grid = root.querySelector('.gallery');
    const tabs = root.querySelector('.result-tabs');
    const button = root.querySelector('.filter-open-button');
    return {
      isGallery: workspace?.classList.contains('is-gallery') === true,
      legacyBar: !!root.querySelector('.gallery-tools-bar'),
      workspace: box(workspace), grid: box(grid), tabs: box(tabs), button: box(button),
      buttonHidden: button?.hidden === true,
      buttonInsideTabs: !!button && !!tabs && tabs.contains(button),
      viewportHeight: innerHeight,
    };
  });
  t.ok(geo.isGallery, 'Galeri sekmesi is-gallery sınıfını almamış');
  t.ok(!geo.legacyBar, '.gallery-tools-bar hâlâ DOM’da (galeri üstünde ayrı araç çubuğu)');
  t.ok(geo.buttonInsideTabs, 'Filtre düğmesi sekme çubuğunun içinde değil');
  t.ok(!geo.buttonHidden, 'Filtre düğmesi galeri sekmesinde gizli');
  // Boş şerit: panel altı görünümün altına taşmamalı ve galeri panelin
  // dibine kadar inmeli (arada kullanılmayan boşluk kalmamalı).
  t.ok(geo.workspace.bottom <= geo.viewportHeight + 1, `Panel görünümden taşıyor: ${geo.workspace.bottom} > ${geo.viewportHeight}`);
  t.ok(geo.workspace.bottom >= geo.viewportHeight - 1, `Panel görünümün altına inmeli: ${geo.workspace.bottom} < ${geo.viewportHeight}`);
  t.ok(geo.grid !== null && geo.grid.bottom >= geo.workspace.bottom - 24, `Galeri altında boşluk var: grid ${geo.grid?.bottom}, panel ${geo.workspace.bottom}`);
  // Sağa yaslı: düğmenin sağ kenarı sekme çubuğunun sağ kenarına yakın olmalı.
  t.ok(geo.button.right <= geo.tabs.right, `Filtre düğmesi sekme çubuğunu aşıyor: ${geo.button.right} > ${geo.tabs.right}`);
  t.ok(geo.tabs.right - geo.button.right < 80, `Filtre düğmesi sağa yaslı değil: fark ${geo.tabs.right - geo.button.right} px`);
  t.equal(page.__pageErrors.length, 0, 'Galeri düzeninde sayfa hatası: ' + page.__pageErrors[0]);
  await page.close();
}

// ---------------------------------------------------------------------------
// Ayar arama: 30+ ayar 7 sekmeye dağılmış. Arama, sekme değiştirmeden ilgili
// ayarı bulmalı, o sekmeye atlamalı ve Türkçe karakterleri katlamalı
// ("sablon" → "şablon").
if (only('Ayar arama')) {
  t.test('Ayar arama: sekme atlama, Türkçe katlama, temizleme');
  const page = await openApp('/basic/');
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluate(() => document.getElementById('__image_scraper_v4__').shadowRoot.querySelector('.launch [data-isp-action="settings"]').click());
  await page.waitForFunction(() => [...document.getElementById('__image_scraper_v4__').shadowRoot.querySelectorAll('.overlay h2')].some(n => n.textContent === 'Ayarlar'));
  await new Promise(resolve => setTimeout(resolve, 400));

  const search = term => page.evaluate(value => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const input = root.querySelector('[data-control="settingsSearch"]');
    input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
  }, term);
  const state = () => page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const dialog = root.querySelector('.settings-dialog');
    const activeTab = [...root.querySelectorAll('.settings-tabs button')].find(b => b.getAttribute('aria-selected') === 'true');
    return {
      tab: activeTab?.textContent.trim() || '',
      hits: root.querySelectorAll('[data-isp-search-hit]').length,
      dimmed: root.querySelectorAll('[data-isp-search-dim]').length,
      message: root.querySelector('[data-control="settingsSearchResult"]')?.textContent || '',
      clearHidden: root.querySelector('[data-action="settings-search-clear"]')?.hidden !== false,
      dialogHeight: Math.round(dialog.getBoundingClientRect().height),
      dialogClient: dialog.clientHeight, dialogScroll: dialog.scrollHeight,
    };
  });

  // 1) "zip" → ZIP sekmesine atlamalı.
  await search('zip'); await new Promise(resolve => setTimeout(resolve, 250));
  const zipState = await state();
  t.includes(zipState.tab, 'ZIP', `"zip" araması ZIP sekmesine atlamadı: ${zipState.tab}`);
  t.ok(zipState.hits >= 1, '"zip" araması eşleşme bulamadı');
  t.ok(!zipState.clearHidden, 'Arama sırasında temizle düğmesi görünmüyor');
  t.ok(zipState.dimmed > 0, 'Arama sırasında eşleşmeyen satırlar soluklaşmadı');

  // 2) Türkçe katlama: "sablon" → "şablon" bulunmalı.
  await search('sablon'); await new Promise(resolve => setTimeout(resolve, 250));
  const folded = await state();
  t.ok(folded.hits >= 1, '"sablon" araması "şablon" ile eşleşmedi (Türkçe katlama eksik)');

  // 3) Olmayan terim: 0 eşleşme, kullanıcıya açık mesaj.
  await search('zzzz-yok-boyle-ayar'); await new Promise(resolve => setTimeout(resolve, 250));
  const none = await state();
  t.equal(none.hits, 0, 'Olmayan terim için eşleşme bulundu');
  t.includes(none.message, 'eşleşen ayar yok', 'Eşleşmeyen arama mesajı yok');

  // 4) Diyalog yüksekliği arama boyunca sabit kalmalı (başlık ekrandan çıkmasın).
  t.equal(zipState.dialogHeight, none.dialogHeight, `Arama diyalog yüksekliğini değiştirdi: ${zipState.dialogHeight} → ${none.dialogHeight}`);
  t.ok(folded.dialogScroll >= folded.dialogClient, 'Diyalog kaydırma hesabı tutarsız');

  // 5) Temizleme: vurgular kalkmalı.
  await page.evaluate(() => document.getElementById('__image_scraper_v4__').shadowRoot.querySelector('[data-action="settings-search-clear"]').click());
  await new Promise(resolve => setTimeout(resolve, 250));
  const cleared = await state();
  t.equal(cleared.hits, 0, 'Temizlemeden sonra vurgu kaldı');
  t.equal(cleared.dimmed, 0, 'Temizlemeden sonra soluklaştırma kaldı');
  t.ok(cleared.clearHidden, 'Temizlemeden sonra temizle düğmesi gizlenmedi');
  t.equal(page.__pageErrors.length, 0, 'Ayar aramasında sayfa hatası: ' + page.__pageErrors[0]);
  await page.close();
}

// ---------------------------------------------------------------------------
if (only('Yedekleme')) {
  t.test('Ayar yedeği dışa/içe aktarma');
  const page = await openApp('/selector/');
  const result = await page.evaluate(async () => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    GM_setValue('isp_config', JSON.stringify({ MAX_PAGES: 7 }));
    GM_setValue('isp_profiles_v1', JSON.stringify({ [location.origin]: { MAX_PAGES: 9 } }));
    GM_setValue('isp_excluded_sites_v1', JSON.stringify(['example.com']));
    root.querySelector('.launch [data-isp-action="settings"]').click();
    root.querySelector('[data-tab-key="backup"]').click();
    let exported = null;
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = blob => { exported = blob; return originalCreate.call(URL, blob); };
    [...root.querySelectorAll('button')].find(b => b.textContent.includes('Ayarları dışa aktar')).click();
    URL.createObjectURL = originalCreate;
    const payload = JSON.parse(await exported.text());
    // içe aktarma
    GM_setValue('isp_config', JSON.stringify({ MAX_PAGES: 1 }));
    const file = new File([JSON.stringify({ ...payload, excludedSites: ['example.org'], globalConfig: { MAX_PAGES: 4 } })], 'y.json', { type: 'application/json' });
    const input = root.querySelector('[data-control="backupFile"]');
    const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    return new Promise(resolve => setTimeout(() => resolve({
      payload, status: root.querySelector('[data-control="backupStatus"]').textContent,
      config: GM_getValue('isp_config', null), excluded: GM_getValue('isp_excluded_sites_v1', null), profiles: GM_getValue('isp_profiles_v1', null),
    }), 800));
  });
  t.equal(result.payload.format, 'image-scraper-settings', 'Yedek biçimi');
  t.equal(result.payload.globalConfig.MAX_PAGES, 7, 'Yedek genel ayarları');
  t.ok(result.payload.profiles[site.origin], 'Yedek site profilini içermiyor');
  t.equal(JSON.parse(result.config).MAX_PAGES, 4, 'İçe aktarılan ayar uygulanmadı');
  t.equal(JSON.parse(result.excluded), ['example.org'], 'İçe aktarılan hariç listesi');
  t.includes(result.status, 'Yedek yüklendi', 'İçe aktarma durum mesajı');
  await page.close();
}

// ---------------------------------------------------------------------------
if (only('Slayt gösterisi')) {
  t.test('Slayt gösterisi aç/kapat ve gezinme');
  const page = await openApp('/basic/');
  await setStorage(page, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0 }) });
  await runScan(page);
  const opened = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const trigger = root.querySelector('.thumb-wrap');
    trigger.click();
    const overlay = root.querySelector('.slideshow-overlay');
    return { exists: !!overlay, counter: overlay?.querySelector('.slideshow-count')?.textContent, image: overlay?.querySelector('.slideshow-image')?.getAttribute('src') };
  });
  t.ok(opened.exists, 'Slayt gösterisi açılmadı');
  t.includes(opened.counter, '1 /', 'Slayt sayacı');
  const navigated = await page.evaluate(async () => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const overlay = root.querySelector('.slideshow-overlay');
    overlay.querySelector('[aria-label="Sonraki görsel"]').click();
    await new Promise(r => setTimeout(r, 200));
    const counter = overlay.querySelector('.slideshow-count').textContent;
    overlay.querySelector('[aria-label="Slayt gösterisini kapat"]').click();
    await new Promise(r => setTimeout(r, 300));
    return { counter, closed: !root.querySelector('.slideshow-overlay') };
  });
  t.includes(navigated.counter, '2 /', 'Slayt ilerlemedi');
  t.ok(navigated.closed, 'Slayt gösterisi kapanmadı');
  await page.close();
}

const ok = t.summary('Tarayıcı testleri');
await harness.close();
await site.close();
process.exit(ok ? 0 : 1);
