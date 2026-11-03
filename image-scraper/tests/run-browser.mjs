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
// Dosya adı şablonu önizlemesi: kaydetmeden önce örnek çıktı, geçersiz
// karakterler, bilinmeyen değişkenler ve çakışma riski gösterilmeli.
if (only('Şablon önizleme')) {
  t.test('Dosya adı şablonu önizlemesi: örnek, uyarı ve temizleme');
  const page = await openApp('/basic/');
  await page.evaluate(() => document.getElementById('__image_scraper_v4__').shadowRoot.querySelector('.launch [data-isp-action="settings"]').click());
  await page.waitForFunction(() => [...document.getElementById('__image_scraper_v4__').shadowRoot.querySelectorAll('.overlay h2')].some(n => n.textContent === 'Ayarlar'));
  await new Promise(resolve => setTimeout(resolve, 400));
  await page.evaluate(() => document.getElementById('__image_scraper_v4__').shadowRoot.querySelector('[data-tab-key="zip"]').click());
  await new Promise(resolve => setTimeout(resolve, 250));

  const preview = tpl => page.evaluate(value => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const input = root.querySelector('[data-control="template"]');
    input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    const node = root.querySelector('[data-control="templatePreview"]');
    return { state: node.dataset.state || '', text: node.textContent || '', hidden: node.hidden };
  }, tpl);

  const good = await preview('{sira}_{orijinal_ad}');
  t.equal(good.state, 'ok', 'Geçerli şablon uyarı verdi: ' + good.text);
  t.includes(good.text, '001_ornek-gorsel.png', 'Örnek çıktı beklenen biçimde değil');
  t.ok(!good.hidden, 'Önizleme gizli');

  const unknown = await preview('{bilinmeyen}_{sira}_{orijinal_ad}');
  t.equal(unknown.state, 'warn', 'Bilinmeyen değişken uyarı vermedi');
  t.includes(unknown.text, 'bilinmeyen değişken', 'Bilinmeyen değişken mesajı yok');

  const unsafeName = await preview('a/b:c*{orijinal_ad}');
  t.equal(unsafeName.state, 'warn', 'Geçersiz karakter uyarısı yok');
  t.includes(unsafeName.text, 'a_b_c_ornek-gorsel.png', 'Geçersiz karakter temizlenmedi: ' + unsafeName.text);

  const collision = await preview('{sayfa}-{boyut}');
  t.equal(collision.state, 'warn', 'Çakışma riski uyarısı yok');

  const reserved = await preview('CON');
  t.includes(reserved.text, 'ayrılmış', 'Windows ayrılmış adı uyarısı yok');

  t.equal(page.__pageErrors.length, 0, 'Şablon önizlemesinde sayfa hatası: ' + page.__pageErrors[0]);
  await page.close();
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
// Derin tarama sınırları: sayfalama aynı içerikte kalmıyorsa durmalı ve özet
// sayaçları (kategori/aday/içerik/sayfa/görsel) raporda görünmeli.
if (only('Derin tarama sınırları')) {
  t.test('Derin tarama: içerik sınırı ve özet sayaçları');
  const page = await openApp('/drift/');
  await setStorage(page, { isp_config: JSON.stringify({ DEEP_CRAWL: true, MAX_PAGES: 1, MAX_ARTICLES: 0, ARTICLE_MAX_PAGES: 0, MIN_WIDTH: 0, MIN_HEIGHT: 0, STOP_DUPLICATE_PAGES: true }) });
  await runScan(page, { timeout: 90000 });
  const report = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    return {
      text: root.textContent,
      counters: [...root.querySelectorAll('.deep-report-cell strong')].map(node => node.textContent.trim()),
      rows: [...root.querySelectorAll('.deep-article-row')].map(row => row.textContent.trim()),
      metrics: [...root.querySelectorAll('.metric-value')].map(node => node.textContent.trim()),
      cards: [...root.querySelectorAll('.image-card .meta')].map(node => node.textContent),
    };
  });
  t.includes(report.text, 'farklı bir içeriğe', 'Başlık değişince içerik sınırında durulmalı');
  t.includes(report.text, 'kategori/arşiv sayfasına', 'Arşive dönen sayfalama içeriğe eklenmemeli');
  t.equal(report.rows.length, 2, 'İçerik bazlı özet satır sayısı');
  t.equal(report.counters[0], '1', 'Kategori sayfası sayacı');
  t.equal(report.counters[2], '2', 'İçerik bağlantısı sayacı');
  t.equal(report.counters[3], '2', 'İçerik sayacı');
  t.equal(report.counters[4], '2', 'İçerik sayfası sayacı');
  t.equal(report.counters[5], '2', 'Benzersiz görsel sayacı');
  t.equal(report.metrics[1], '2', 'Taranan sayfa metriği sınırla uyumlu');
  t.equal(report.cards.length, 2, 'Sınırdan sonraki sayfanın görseli alınmamalı');
  t.ok(report.rows.every(row => row.includes('1 sayfa')), 'Her içerik 1 sayfa olarak raporlanmalı');
  t.ok(report.cards.some(card => card.includes('Konu: Kayma testi başlığı')), 'İçerik konusu kartlarda görünmeli');
  await page.close();
}

// ---------------------------------------------------------------------------
// İçerik bazlı tekrar sayacı: aynı görsel bir içeriğin alt sayfalarında
// yeniden geçtiğinde özet satırında "tekrar atlandı" olarak görünmeli.
if (only('İçerik tekrarı')) {
  t.test('Derin tarama: içerik bazlı tekrar sayacı');
  const page = await openApp('/dupe-listing/');
  await setStorage(page, { isp_config: JSON.stringify({ DEEP_CRAWL: true, MAX_PAGES: 1, MAX_ARTICLES: 0, ARTICLE_MAX_PAGES: 0, MIN_WIDTH: 0, MIN_HEIGHT: 0, STOP_DUPLICATE_PAGES: false }) });
  await runScan(page, { timeout: 60000 });
  const summary = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    return {
      rows: [...root.querySelectorAll('.deep-article-row')].map(row => row.textContent.trim()),
      metrics: [...root.querySelectorAll('.metric-value')].map(node => node.textContent.trim()),
    };
  });
  t.equal(summary.metrics[0], '1', 'Aynı görsel bir kez sayılmalı');
  t.equal(summary.metrics[2], '1', 'Tekrar sayısı metriği');
  t.includes(summary.rows[0] || '', '2 sayfa', 'İçerik iki sayfa göstermeli');
  t.includes(summary.rows[0] || '', '1 tekrar atlandı', 'İçerik bazlı tekrar sayısı');
  await page.close();
}

// ---------------------------------------------------------------------------
// Keşif önizlemesi: aday bağlantı sayısı ve kullanılan keşif yöntemi
// görseller indirilmeden önce gösterilir.
if (only('Keşif sayaçları')) {
  t.test('Derin tarama: keşif önizlemesinde sayaçlar');
  const page = await openApp('/category/');
  await setStorage(page, { isp_config: JSON.stringify({ DEEP_CRAWL: true, MAX_PAGES: 1, MAX_ARTICLES: 2, ARTICLE_MAX_PAGES: 2, PREVIEW_PAGE_QUEUE: true, MIN_WIDTH: 0, MIN_HEIGHT: 0 }) });
  await clickInUI(page, '.launch [data-isp-action="scan"]');
  await waitText(page, 'Taranacak sayfalar');
  const dialogText = await page.evaluate(() => [...document.getElementById('__image_scraper_v4__').shadowRoot.querySelectorAll('.overlay')].map(node => node.textContent).join(' '));
  t.includes(dialogText, 'kategori sayfası', 'Önizleme kategori sayfası sayısını göstermeli');
  t.includes(dialogText, 'içerik', 'Önizleme içerik sayısını göstermeli');
  t.includes(dialogText, 'Keşif yöntemi', 'Önizleme keşif yöntemini göstermeli');
  await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    [...root.querySelectorAll('button')].find(button => button.textContent.includes('Seçilenleri tara')).click();
  });
  await page.waitForFunction(() => [...document.getElementById('__image_scraper_v4__').shadowRoot.querySelectorAll('.overlay h2')].some(node => node.textContent === 'Tarama sonuçları'), { timeout: 60000 });
  const counters = await page.evaluate(() => [...document.getElementById('__image_scraper_v4__').shadowRoot.querySelectorAll('.deep-report-cell strong')].map(node => node.textContent.trim()));
  t.equal(counters[3], '2', 'İçerik sayacı önizlemeden sonra da doğru');
  await page.close();
}

// ---------------------------------------------------------------------------
// Keşif yarıda kalırsa: tamamlanan kategori ve içerikler kaydedilir, devam
// ederken yeniden keşfedilmez (yalnızca kalan içerik açılır).
if (only('Derin tarama devam')) {
  t.test('Derin tarama: keşif yarıda kalınca kaldığı yerden devam eder');
  const page = await openApp('/slow-listing/');
  await setStorage(page, { isp_config: JSON.stringify({ DEEP_CRAWL: true, MAX_PAGES: 1, MAX_ARTICLES: 0, ARTICLE_MAX_PAGES: 2, SAVE_SCAN_PROGRESS: true, CHECK_REAL_SIZE: false, MIN_WIDTH: 0, MIN_HEIGHT: 0 }) });
  await clickInUI(page, '.launch [data-isp-action="scan"]');
  await page.waitForFunction(() => (document.getElementById('__image_scraper_v4__')?.shadowRoot?.textContent || '').includes('İçerik 2/2'), { timeout: 30000, polling: 40 });
  await clickInUI(page, '.launch [data-isp-action="scan"]');
  await page.waitForFunction(() => !document.getElementById('__image_scraper_v4__').shadowRoot.querySelector('.launch [data-isp-action="scan"]').textContent.includes('Taranıyor'), { timeout: 20000 });
  const state = JSON.parse(await getStorage(page, 'isp_scan_state_v1') || 'null');
  t.equal(state?.phase, 'discovery', 'Keşif aşaması kaydı yazılmalı');
  t.equal(state?.deepState?.articles?.length, 2, 'Keşfedilen içerik sayısı kayıtta');
  t.equal(state?.deepState?.articles?.[0]?.pages?.length, 2, 'Tamamlanan içeriğin alt sayfaları kayıtta');
  const requests = [];
  page.on('request', request => { if (request.url().includes('/slow-article/')) requests.push(request.url()); });
  await runScan(page, { timeout: 90000 });
  const firstIndex = fragment => requests.findIndex(url => url.includes(fragment));
  t.ok(firstIndex('/slow-article/slow-2') >= 0, 'Kalan içerik istendi');
  t.ok(firstIndex('/slow-article/slow-2') < firstIndex('/slow-article/slow-1'), 'Devam ederken tamamlanan içerik yeniden keşfedilmedi');
  const result = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    return {
      metrics: [...root.querySelectorAll('.metric-value')].map(node => node.textContent.trim()),
      rows: [...root.querySelectorAll('.deep-article-row')].map(row => row.textContent.trim()),
    };
  });
  t.equal(result.metrics[1], '4', 'Devam eden tarama dört içerik sayfası toplamalı');
  t.equal(result.metrics[0], '4', 'Devam eden tarama dört görsel toplamalı');
  t.ok(result.rows.every(row => row.includes('2 sayfa')), 'İçerik özeti ikişer sayfa göstermeli');
  t.equal(await getStorage(page, 'isp_scan_state_v1'), null, 'Başarılı tarama kaydı temizlemeli');
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
// İş akışı profilleri: tarama + görsel + ZIP ayarlarını birlikte uygulayan
// adlandırılmış kombinasyonlar. Üç hazır profil var, kullanıcı kendi profilini
// kaydedebilir; hazır profiller silinemez.
if (only('İş akışı profilleri')) {
  t.test('İş akışı profilleri: uygula, kaydet, sil');
  const page = await openApp('/basic/');
  await page.evaluate(() => document.getElementById('__image_scraper_v4__').shadowRoot.querySelector('.launch [data-isp-action="settings"]').click());
  await new Promise(resolve => setTimeout(resolve, 400));

  const initial = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const select = root.querySelector('[data-control="workflowPreset"]');
    const options = [...select.options].map(option => option.textContent);
    root.querySelector('[data-action="workflow-apply"]').click();
    return { options, status: root.querySelector('[data-control="workflowStatus"]').textContent };
  });
  t.equal(initial.options, ['Profil seç…', 'Hızlı tarama (hazır)', 'Düşük bellek (hazır)', 'Yüksek çözünürlük (hazır)'], 'Hazır profiller listelenmiyor');
  t.includes(initial.status, 'profil seç', 'Seçimsiz uygulama yönlendirmiyor: ' + initial.status);

  const applied = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const select = root.querySelector('[data-control="workflowPreset"]');
    select.value = 'Düşük bellek';
    root.querySelector('[data-action="workflow-apply"]').click();
    const config = JSON.parse(window.GM_getValue('isp_config', '{}'));
    return {
      status: root.querySelector('[data-control="workflowStatus"]').textContent,
      concurrent: config.ZIP_CONCURRENT, maxFiles: config.PART_MAX_FILES, maxMB: config.PART_MAX_MB,
      formConcurrent: root.querySelector('[data-control="concurrent"]').value,
      formMaxMB: root.querySelector('[data-control="maxMB"]').value,
    };
  });
  t.includes(applied.status, 'uygulandı', 'Uygulama geri bildirimi yok: ' + applied.status);
  t.equal(applied.concurrent, 1, 'Profil ZIP eşzamanlılığını uygulamadı');
  t.equal(applied.formConcurrent, '1', 'Profil form alanını güncellemedi');
  t.equal(applied.maxMB, 50, 'Profil parça MB sınırını uygulamadı');
  t.equal(applied.formMaxMB, '50', 'Form parça MB sınırı güncellenmedi');

  const saved = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const name = root.querySelector('[data-control="workflowName"]');
    name.value = 'Benim profilim';
    root.querySelector('[data-action="workflow-save"]').click();
    const select = root.querySelector('[data-control="workflowPreset"]');
    const options = [...select.options].map(option => option.textContent);
    const stored = JSON.parse(window.GM_getValue('isp_workflows_v1', '{}'));
    // Hazır adla kaydetmeyi dene
    name.value = 'Hızlı tarama';
    root.querySelector('[data-action="workflow-save"]').click();
    const reserved = root.querySelector('[data-control="workflowStatus"]').textContent;
    // Hazır profili silmeyi dene
    select.value = 'Düşük bellek';
    root.querySelector('[data-action="workflow-delete"]').click();
    const builtinDelete = root.querySelector('[data-control="workflowStatus"]').textContent;
    // Kullanıcı profilini sil
    select.value = 'Benim profilim';
    root.querySelector('[data-action="workflow-delete"]').click();
    return {
      options, names: Object.keys(stored), savedConfig: stored['Benim profilim']?.PART_MAX_MB,
      reserved, builtinDelete,
      afterDelete: [...select.options].map(option => option.textContent),
      deleteStatus: root.querySelector('[data-control="workflowStatus"]').textContent,
      storage: window.GM_getValue('isp_workflows_v1', '{}'),
    };
  });
  t.ok(saved.options.includes('Benim profilim'), 'Kaydedilen profil listede yok: ' + saved.options.join(', '));
  t.equal(saved.names, ['Benim profilim'], 'Profil deposu beklenmedik: ' + saved.names.join(', '));
  t.equal(saved.savedConfig, 50, 'Profil kayıtlı ayarı yakalamamış');
  t.includes(saved.reserved, 'Hazır profil adları', 'Hazır adla kaydetme engellenmiyor: ' + saved.reserved);
  t.includes(saved.builtinDelete, 'silinemez', 'Hazır profil silinebiliyor: ' + saved.builtinDelete);
  t.ok(!saved.afterDelete.includes('Benim profilim'), 'Kullanıcı profili silinmedi');
  t.includes(saved.deleteStatus, 'silindi', 'Silme geri bildirimi yok: ' + saved.deleteStatus);
  t.equal(saved.storage, '{}', 'Profil deposu silme sonrası boş değil: ' + saved.storage);
  t.equal(page.__pageErrors.length, 0, 'İş akışı profilinde sayfa hatası: ' + page.__pageErrors[0]);
  await page.close();
}

// ---------------------------------------------------------------------------
// ZIP içi klasörleme, kaynak manifesti ve oturum başına kaynak sınırı.
if (only('ZIP klasörleme')) {
  t.test('ZIP klasörleme ve kaynak manifesti');
  const readZip = async page => {
    await page.evaluate(() => {
      const root = document.getElementById('__image_scraper_v4__').shadowRoot;
      const tab = [...root.querySelectorAll('.result-tabs button')].find(b => b.textContent === 'ZIP ve indirme');
      tab.click();
      root.querySelector('.result-pane [class="primary"]').click();
    });
    await page.waitForFunction(() => {
      const root = document.getElementById('__image_scraper_v4__').shadowRoot;
      const panes = [...root.querySelectorAll('.result-pane')];
      const status = panes[2]?.querySelector('.status')?.textContent || '';
      return !!panes[2]?.querySelector('a.download-link') || status.startsWith('⛔') || status.startsWith('❌');
    }, { timeout: 90000, polling: 100 });
    return page.evaluate(async () => {
      const root = document.getElementById('__image_scraper_v4__').shadowRoot;
      const panes = [...root.querySelectorAll('.result-pane')];
      const link = panes[2]?.querySelector('a.download-link');
      const status = panes[2]?.querySelector('.status')?.textContent || '';
      if (!link) return { error: true, status };
      const zip = await JSZip.loadAsync(await (await fetch(link.href)).arrayBuffer());
      const names = Object.keys(zip.files).filter(name => !zip.files[name].dir);
      const manifestName = names.find(name => name.endsWith('manifest.json'));
      const manifest = manifestName ? JSON.parse(await zip.file(manifestName).async('string')) : null;
      return { error: false, status, names, manifestName, manifest };
    });
  };

  // 1) Alan adına göre klasörleme + manifest
  const hostPage = await openApp('/basic/');
  await setStorage(hostPage, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0, ZIP_FILENAME: 'klasor.zip', ZIP_FOLDERS: 'host', ZIP_MANIFEST: true }) });
  await runScan(hostPage);
  const hostZip = await readZip(hostPage);
  t.ok(!hostZip.error, 'Klasörlü ZIP üretilemedi: ' + hostZip.status);
  t.ok(hostZip.names.every(name => name === hostZip.manifestName || name.includes('/')), 'Klasörsüz dosya kaldı: ' + hostZip.names.join(', '));
  t.ok(hostZip.names.every(name => !name.includes(':')), 'Klasör adında geçersiz karakter var');
  t.equal(hostZip.manifestName, 'manifest.json', 'Manifest kökte değil');
  t.equal(hostZip.manifest?.dosyalar?.length, hostZip.names.length - 1, 'Manifest dosya sayısı arşivle uyuşmuyor');
  t.equal(hostZip.manifest?.ayarlar?.klasorleme, 'host', 'Manifest klasörleme ayarını yazmıyor');
  t.ok(hostZip.manifest?.dosyalar?.every(entry => entry.url && entry.dosya && entry.kaynak_sayfa), 'Manifest kayıtları eksik');
  t.equal(hostPage.__pageErrors.length, 0, 'Klasörlü ZIP’te sayfa hatası: ' + hostPage.__pageErrors[0]);
  await hostPage.close();

  // 2) Kaynak sayfa yoluna göre klasörleme
  const pageMode = await openApp('/basic/');
  await setStorage(pageMode, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0, ZIP_FILENAME: 'sayfa.zip', ZIP_FOLDERS: 'page', ZIP_MANIFEST: false }) });
  await runScan(pageMode);
  const pageZip = await readZip(pageMode);
  t.ok(!pageZip.error, 'Sayfa klasörlemeli ZIP üretilemedi: ' + pageZip.status);
  t.ok(pageZip.names.every(name => name.startsWith('127.0.0.1_')), 'Sayfa klasörü alan adıyla başlamıyor: ' + pageZip.names.slice(0, 2).join(', '));
  t.ok(!pageZip.names.some(name => name.endsWith('manifest.json')), 'Manifest kapalıyken eklendi');
  await pageMode.close();

  // 3) Kaynak sınırı: sınır aşılırsa işlem başlamaz
  const limitPage = await openApp('/basic/');
  await setStorage(limitPage, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0, MAX_IMAGES: 3 }) });
  await runScan(limitPage);
  const limited = await readZip(limitPage);
  t.ok(limited.error, 'Sınır aşılmasına rağmen ZIP üretildi');
  t.includes(limited.status, 'Kaynak sınırı aşıldı', 'Sınır hatası açıklanmıyor: ' + limited.status);
  t.includes(limited.status, 'sınır 3', 'Sınır değeri mesajda yok: ' + limited.status);
  t.equal(limitPage.__pageErrors.length, 0, 'Sınır senaryosunda sayfa hatası: ' + limitPage.__pageErrors[0]);
  await limitPage.close();
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
// ZIP aşama göstergesi ve takılma tespiti. Kullanıcı "🗜️ ZIP 1/1 · 0%" görüp
// işlemin nerede olduğunu anlayamıyordu. Aşamalar görünmeli, uzun süre
// ilerleme gelmezse iptal/tekrar dene yolu sunulmalı.
if (only('ZIP aşamaları')) {
  t.test('ZIP aşamaları: rozetler ilerliyor, takılma tespit ediliyor');
  // --- 1) Normal akış: tüm aşamalar tamamlanmalı, rozetler işaretlenmeli.
  const page = await openApp('/basic/');
  await setStorage(page, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0, ZIP_FILENAME: 'stages.zip' }) });
  await runScan(page);
  await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    [...root.querySelectorAll('.result-tabs button')].find(b => b.textContent === 'ZIP ve indirme').click();
  });
  await new Promise(resolve => setTimeout(resolve, 250));
  const stageLabels = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    return [...root.querySelectorAll('.zip-stage')].map(n => n.dataset.stage);
  });
  t.equal(stageLabels.join(','), 'download,analysis,dedupe,archive,verify,ready', 'ZIP aşama rozetleri eksik');
  await page.evaluate(() => document.getElementById('__image_scraper_v4__').shadowRoot.querySelector('.result-pane [class="primary"]').click());
  await page.waitForFunction(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    return !!root.querySelector('a.download-link') || (root.querySelector('.result-pane .status')?.textContent || '').startsWith('❌');
  }, { timeout: 90000, polling: 100 });
  const done = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    return {
      ready: root.querySelector('.zip-stage[data-stage="ready"]')?.classList.contains('is-active') === true,
      doneCount: root.querySelectorAll('.zip-stage.is-done').length,
      stallHidden: root.querySelector('.zip-stall')?.hidden === true,
      link: root.querySelector('a.download-link')?.download || '',
    };
  });
  t.ok(done.ready, 'Bitişte "Hazır" aşaması etkin değil');
  t.ok(done.doneCount >= 4, `Tamamlanan aşama sayısı az: ${done.doneCount}`);
  t.ok(done.stallHidden, 'Başarılı işlemde takılma uyarısı görünür kaldı');
  t.ok(done.link.length > 0, 'ZIP indirme bağlantısı oluşmadı');
  t.equal(page.__pageErrors.length, 0, 'ZIP aşamalarında sayfa hatası: ' + page.__pageErrors[0]);
  await page.close();

  // --- 2) Takılma: görsel indirmeleri asla tamamlanmaz, uyarı çıkmalı.
  // openApp() varsayılan olarak .launch bekler; start:false ile UI henüz yok.
  // Bu yüzden harness.open doğrudan kullanılır, UI sonra elle kurulur.
  const stallOpen = await harness.open(`${site.origin}/basic/`, { files, start: false });
  const stallPage = stallOpen.page;
  stallPage.__pageErrors = stallOpen.pageErrors;
  await stallPage.evaluate(() => {
    const isImage = url => /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(String(url));
    const realFetch = window.fetch, realGM = window.GM_xmlhttpRequest;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (isImage(url)) return new Promise(() => {});   // hiç çözülmez = takılma
      return realFetch.call(this, input, init);
    };
    window.GM_xmlhttpRequest = function (options) {
      if (isImage(options.url)) return { abort() {} };
      return realGM.call(this, options);
    };
  });
  for (const script of ['lib/alpine.min.js', 'lib/jszip.min.js', 'modules/zip.js', 'modules/settings-ui.js', 'modules/page-tools.js', 'modules/network.js', 'modules/image-analysis.js', 'modules/ui-results.js', 'app.js']) {
    await stallPage.evaluate(files[script]);
  }
  await stallPage.evaluate(async (panelHtml, cssPath) => {
    const response = await fetch(cssPath);
    window.__gmCssUrl = URL.createObjectURL(await response.blob());
    window.__gmResources = { appHtml: panelHtml };
    globalThis.ImageScraperApp.start({ panelHtml, cssUrl: window.__gmCssUrl });
  }, files['panel.html'], 'https://userscript.test/styles.css');
  await stallPage.waitForFunction(() => document.getElementById('__image_scraper_v4__')?.shadowRoot?.querySelector('.launch'), { timeout: 20000 });
  await setStorage(stallPage, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0 }) });
  await runScan(stallPage);
  await stallPage.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    [...root.querySelectorAll('.result-tabs button')].find(b => b.textContent === 'ZIP ve indirme').click();
  });
  await new Promise(resolve => setTimeout(resolve, 250));
  await stallPage.evaluate(() => document.getElementById('__image_scraper_v4__').shadowRoot.querySelector('.result-pane [class="primary"]').click());
  // STALL_MS = 20 sn; uyarı 20–30 sn arasında çıkmalı.
  await stallPage.waitForFunction(() => {
    const box = document.getElementById('__image_scraper_v4__').shadowRoot.querySelector('.zip-stall');
    return box && !box.hidden && (box.textContent || '').includes('ilerlemiyor');
  }, { timeout: 45000, polling: 500 });
  const stalled = await stallPage.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const box = root.querySelector('.zip-stall');
    return {
      text: box.textContent,
      active: root.querySelector('.zip-stage.is-active')?.dataset.stage,
      retryVisible: [...box.querySelectorAll('button')].some(b => !b.hidden),
      cancelVisible: !root.querySelector('.result-pane .cancel, .result-pane [data-role="cancel"]')?.hidden,
    };
  });
  t.includes(stalled.text, 'ilerlemiyor', 'Takılma metni beklenen biçimde değil');
  t.equal(stalled.active, 'download', `Takılma "İndirme" aşamasında beklenirdi, "${stalled.active}" bulundu`);
  t.ok(stalled.retryVisible, 'Takılma anında "yeniden dene" düğmesi yok');
  t.equal(stallPage.__pageErrors.length, 0, 'Takılma senaryosunda sayfa hatası: ' + stallPage.__pageErrors[0]);
  await stallPage.close();
}

// ---------------------------------------------------------------------------
// ZIP bütünlük kontrolü: "başarılı" mesajı verip bozuk dosya sunmayı önler.
// Doğrulayıcı, gerçek/kesik/çöp arşivleri ayırt etmeli.
if (only('ZIP bütünlük')) {
  t.test('ZIP bütünlük kontrolü: geçerli/kesik/çöp arşiv ayrımı');
  const page = await openApp('/basic/');
  const verdicts = await page.evaluate(async () => {
    const mod = globalThis.ImageScraperModules.createZipModule({
      $el: () => ({}), document: window.document, URL: window.URL, Blob: window.Blob,
      Uint8Array: window.Uint8Array, checkAbort: () => {}, abortError: () => new Error('abort'),
    });
    const payload = [{ name: 'a.png', data: new Uint8Array([1, 2, 3, 4]) }, { name: 'b.png', data: new Uint8Array([5, 6, 7, 8]) }];
    const blob = await mod.generateZipBlob(payload, new AbortController().signal);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      valid: mod.verifyZipBytes(bytes, 2),
      wrongCount: mod.verifyZipBytes(bytes, 5),
      truncated: mod.verifyZipBytes(bytes.slice(0, Math.floor(bytes.length / 2)), 2),
      garbage: mod.verifyZipBytes(new Uint8Array(100).fill(7), 2),
      tooSmall: mod.verifyZipBytes(new Uint8Array(5), 1),
    };
  });
  t.ok(verdicts.valid.ok, 'Geçerli arşiv doğrulamadan geçmedi: ' + verdicts.valid.problems.join(' '));
  t.equal(verdicts.valid.entries, 2, 'Geçerli arşivde dosya sayısı yanlış okundu');
  t.ok(!verdicts.wrongCount.ok, 'Yanlış dosya sayısı yakalanmadı');
  t.includes(verdicts.wrongCount.problems.join(' '), 'uyuşmuyor', 'Dosya sayısı uyuşmazlığı mesajı yok');
  t.ok(!verdicts.truncated.ok, 'Kesik arşiv yakalanmadı');
  t.includes(verdicts.truncated.problems.join(' '), 'EOCD', 'Kesik arşiv mesajı EOCD demiyor');
  t.ok(!verdicts.garbage.ok, 'Çöp veri geçerli sayıldı');
  t.ok(!verdicts.tooSmall.ok, 'Çok küçük veri geçerli sayıldı');
  t.equal(page.__pageErrors.length, 0, 'Doğrulamada sayfa hatası: ' + page.__pageErrors[0]);
  await page.close();

  // Uçtan uca: VERIFY_ZIP açıkken doğrulama aşaması çalışmalı ve sonuç yazılmalı.
  const vPage = await openApp('/basic/');
  await setStorage(vPage, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0, ZIP_FILENAME: 'verify.zip', VERIFY_ZIP: true }) });
  await runScan(vPage);
  await vPage.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    [...root.querySelectorAll('.result-tabs button')].find(b => b.textContent === 'ZIP ve indirme').click();
  });
  await new Promise(resolve => setTimeout(resolve, 250));
  await vPage.evaluate(() => document.getElementById('__image_scraper_v4__').shadowRoot.querySelector('.result-pane [class="primary"]').click());
  await vPage.waitForFunction(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    return !!root.querySelector('a.download-link') || (root.querySelector('.result-pane .status')?.textContent || '').startsWith('❌');
  }, { timeout: 90000, polling: 100 });
  const verified = await vPage.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    return {
      status: root.querySelector('.result-pane .status')?.textContent || '',
      hasVerifyStage: !!root.querySelector('.zip-stage[data-stage="verify"]'),
      link: root.querySelector('a.download-link')?.download || '',
    };
  });
  t.ok(verified.hasVerifyStage, 'Doğrulama aşaması rozeti yok');
  t.includes(verified.status, 'doğrulandı', 'Başarı mesajında doğrulama bilgisi yok: ' + verified.status);
  t.ok(!verified.status.startsWith('❌'), 'Doğrulama açıkken ZIP başarısız: ' + verified.status);
  t.ok(verified.link.length > 0, 'Doğrulama açıkken indirme bağlantısı yok');
  t.equal(vPage.__pageErrors.length, 0, 'Doğrulama senaryosunda sayfa hatası: ' + vPage.__pageErrors[0]);
  await vPage.close();
}

// ---------------------------------------------------------------------------
// Toplu seçim kısayolları: "tümünü seç" yerine sayfa / alan adı / formata göre
// hedefli seçim. Etkilenecek görsel sayısı işlemden sonra bildirilir.
if (only('Toplu seçim')) {
  t.test('Toplu seçim: format/sayfa/alan adına göre seç ve kaldır');
  const page = await openApp('/basic/');
  await setStorage(page, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0 }) });
  await runScan(page);
  await page.evaluate(() => document.getElementById('__image_scraper_v4__').shadowRoot.querySelector('.filter-open-button').click());
  await new Promise(resolve => setTimeout(resolve, 400));

  const bulk = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const selects = [...root.querySelectorAll('.bulk-row select')];
    return {
      selectCount: selects.length,
      options: selects.map(select => [...select.options].filter(o => o.value).map(o => o.textContent)),
      labels: selects.map(select => select.getAttribute('aria-label')),
    };
  });
  t.equal(bulk.selectCount, 3, 'Üç toplu seçim kutusu beklenirdi');
  t.ok(bulk.labels.every(Boolean), 'Toplu seçim kutularında aria-label yok');
  t.ok(bulk.options[0].length >= 1, 'Sayfa seçenekleri boş (sayaçlar üretilmemiş)');
  t.ok(bulk.options[1].length >= 1, 'Alan adı seçenekleri boş');
  t.ok(bulk.options[0][0].includes('('), 'Seçeneklerde görsel sayısı yok: ' + bulk.options[0][0]);

  // Seçim yapılmadan uyarı
  const empty = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    root.querySelectorAll('.bulk-row button')[0].click();
    return root.querySelector('.bulk-count')?.textContent || '';
  });
  t.includes(empty, 'seç', 'Seçimsiz durumda yönlendirme mesajı yok: ' + empty);

  // Formata göre seç → tümü seçili, sonra kaldır → hiçbiri
  const toggled = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const fmt = [...root.querySelectorAll('.bulk-row select')][2];
    fmt.value = [...fmt.options].find(o => o.value)?.value || '';
    // NOT: galeri sanallaştırılmıştır; DOM'daki kart sayısı seçili görsellerin
    // tamamını göstermez. Bu yüzden seçim sayısı üstteki "Seçili görsel"
    // metriğinden okunur (10/12 hatası bu varsayımdan kaynaklanmıştı).
    // DİKKAT: .header-metric .metric-value ilk metrik "Benzersiz görsel"dir;
    // seçili sayısı için etiket metnine göre aramak gerekir.
    const selectedMetric = () => {
      const metric = [...root.querySelectorAll('.header-metric')]
        .find(m => (m.querySelector('.metric-label')?.textContent || '').includes('Seçili'));
      return Number(metric?.querySelector('.metric-value')?.textContent || 0);
    };
    // Tarama sonrası görseller varsayılan olarak seçilidir. Testin anlamlı
    // olması için önce seçimi sıfırla; sonra toplu seçimin eklediğini ölç.
    const selectNone = [...root.querySelectorAll('.toolbar button')].find(b => b.textContent.includes('kaldır') && b.textContent.includes('Filtredekileri'));
    selectNone?.click();
    const before = selectedMetric();
    root.querySelectorAll('.bulk-row button')[0].click();
    const first = { msg: root.querySelector('.bulk-count')?.textContent || '', selected: selectedMetric(), before };
    root.querySelectorAll('.bulk-row button')[0].click();
    const second = { msg: root.querySelector('.bulk-count')?.textContent || '', selected: selectedMetric() };
    return { first, second };
  });
  t.includes(toggled.first.msg, 'değiştirildi', 'Seçim mesajı beklenen biçimde değil: ' + toggled.first.msg);
  t.ok(toggled.first.selected > 0, `Toplu seçim hiçbir görseli seçmedi (önce ${toggled.first.before}, sonra ${toggled.first.selected})`);
  t.equal(toggled.second.selected, 0, `İkinci tıklama seçimi kaldırmadı (${toggled.second.selected} seçili kaldı)`);

  // "Seçime ekle" tekrar seçer
  const added = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    root.querySelectorAll('.bulk-row button')[1].click();
    const selected = Number([...root.querySelectorAll('.header-metric')].find(m => (m.querySelector('.metric-label')?.textContent || '').includes('Seçili'))?.querySelector('.metric-value')?.textContent || 0);
    return { msg: root.querySelector('.bulk-count')?.textContent || '', selected };
  });
  t.includes(added.msg, 'eklendi', '"Seçime ekle" mesajı yok: ' + added.msg);
  t.ok(added.selected > 0, '"Seçime ekle" görsel seçmedi');

  t.equal(page.__pageErrors.length, 0, 'Toplu seçimde sayfa hatası: ' + page.__pageErrors[0]);
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
// Filtre çekmecesi v2: eşit ağırlıklı satırlar yerine başlıklı bölümler,
// canlı sonuç sayacı, tek tıkla kaldırılan filtre rozetleri ve galeri görünüm
// ayarları (resim altı açıklamaları, ızgara sütun sayısı, küçük resim
// görünümü). Görünüm tercihleri oturumlar arası saklanır.
if (only('Filtre çekmecesi')) {
  t.test('Filtre çekmecesi: bölümler, canlı sayaç, rozetler ve görünüm ayarları');
  const page = await openApp('/basic/');
  await page.setViewport({ width: 1280, height: 860 });
  await setStorage(page, { isp_config: JSON.stringify({ MIN_WIDTH: 0, MIN_HEIGHT: 0 }) });
  await runScan(page);
  await page.evaluate(() => document.getElementById('__image_scraper_v4__').shadowRoot.querySelector('.filter-open-button').click());
  await new Promise(resolve => setTimeout(resolve, 350));

  const structure = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const body = root.querySelector('.filter-drawer-body');
    const fields = [...body.querySelectorAll('.drawer-field')];
    return {
      sections: [...body.querySelectorAll('.drawer-section h4')].map(n => n.textContent),
      subtitle: root.querySelector('.drawer-subtitle')?.textContent || '',
      unlabeledFields: fields.filter(field => !(field.querySelector('.drawer-field-label')?.textContent || '').trim()
        && !field.querySelector('.drawer-toggle')).length,
      chipsHidden: root.querySelector('.drawer-chips')?.hidden === true,
      toggleCount: root.querySelectorAll('.drawer-toggle').length,
      hasReset: !!root.querySelector('.drawer-reset'),
      hasApply: !!root.querySelector('.drawer-apply'),
      drawerWidth: Math.round(root.querySelector('.filter-drawer-panel').getBoundingClientRect().width),
    };
  });
  t.equal(structure.sections, ['Ara', 'Filtreler', 'Görünüm', 'Toplu seçim', 'İşlemler'], 'Çekmece bölüm başlıkları');
  t.includes(structure.subtitle, ' / ', 'Başlıkta canlı sayaç yok: ' + structure.subtitle);
  t.equal(structure.unlabeledFields, 0, 'Etiketsiz alan var');
  t.ok(structure.chipsHidden, 'Filtre yokken rozet şeridi gizli değil');
  t.ok(structure.toggleCount >= 3, `Görünüm anahtarı sayısı beklenen altında: ${structure.toggleCount}`);
  t.ok(structure.hasReset && structure.hasApply, 'Sıfırla / Sonuçları gör düğmeleri yok');

  // --- Resim altı açıklamaları ---------------------------------------------
  const captionsOff = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const input = [...root.querySelectorAll('.drawer-toggle')].find(l => l.textContent.includes('açıklama')).querySelector('input');
    input.click();
    const grid = root.querySelector('.gallery');
    return {
      mode: grid.dataset.captions,
      metaVisible: (root.querySelector('.image-card .meta')?.getClientRects().length || 0) > 0,
      thumb: Math.round(root.querySelector('.image-card .thumb-wrap').getBoundingClientRect().height),
      card: Math.round(root.querySelector('.image-card').getBoundingClientRect().height),
      stored: JSON.parse(window.GM_getValue('isp_view_prefs_v1', '{}')),
    };
  });
  t.equal(captionsOff.mode, 'off', 'Açıklama gizleme galeriye uygulanmadı');
  t.ok(!captionsOff.metaVisible, 'Açıklamalar gizlenmedi');
  t.ok(captionsOff.card - captionsOff.thumb <= 4, `Küçük resim kartı doldurmuyor: kart ${captionsOff.card}, resim ${captionsOff.thumb}`);
  t.equal(captionsOff.stored.captions, false, 'Açıklama tercihi saklanmadı');
  const captionsOn = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const input = [...root.querySelectorAll('.drawer-toggle')].find(l => l.textContent.includes('açıklama')).querySelector('input');
    input.click();
    return { mode: root.querySelector('.gallery').dataset.captions, metaVisible: (root.querySelector('.image-card .meta')?.getClientRects().length || 0) > 0 };
  });
  t.equal(captionsOn.mode, 'on', 'Açıklamalar geri açılmadı');
  t.ok(captionsOn.metaVisible, 'Açıklamalar geri gelmedi');

  // --- Izgara sütun sayısı -------------------------------------------------
  const columns = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const select = root.querySelector('[aria-label="Izgara sütun sayısı"]');
    const read = () => getComputedStyle(root.querySelector('.gallery')).gridTemplateColumns.split(' ').length;
    const auto = read();
    select.value = '4'; select.dispatchEvent(new Event('input', { bubbles: true }));
    const four = read();
    select.value = '2'; select.dispatchEvent(new Event('input', { bubbles: true }));
    const two = read();
    // Sanallaştırma satır hesabı sütun sayısıyla uyumlu kalmalı: kartlar
    // ızgarayı taşırmamalı ve alt boşluk şeridi bırakmamalı.
    const grid = root.querySelector('.gallery');
    const cards = [...grid.querySelectorAll('.image-card')].map(c => c.getBoundingClientRect());
    const gridBox = grid.getBoundingClientRect();
    return {
      auto, four, two,
      perRow: Math.max(1, new Set(cards.map(c => Math.round(c.top))).size === 0 ? 1 : cards.filter(c => Math.round(c.top) === Math.round(cards[0].top)).length),
      overflow: cards.some(c => c.right > gridBox.right + 1),
      stored: JSON.parse(window.GM_getValue('isp_view_prefs_v1', '{}')).columns,
    };
  });
  t.ok(columns.auto >= 2, `Otomatik sütun sayısı beklenmedik: ${columns.auto}`);
  t.equal(columns.four, 4, '4 sütun seçimi uygulanmadı');
  t.equal(columns.two, 2, '2 sütun seçimi uygulanmadı');
  t.equal(columns.perRow, 2, `Sütun sayısı ile kart sayısı uyuşmuyor: satırda ${columns.perRow} kart`);
  t.ok(!columns.overflow, 'Kartlar ızgarayı taşırıyor');
  t.equal(columns.stored, 2, 'Sütun tercihi saklanmadı');

  // --- Küçük resim görünümü -------------------------------------------------
  const fit = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const select = root.querySelector('[aria-label="Küçük resim görünümü"]');
    select.value = 'cover'; select.dispatchEvent(new Event('input', { bubbles: true }));
    const cover = getComputedStyle(root.querySelector('.image-card img')).objectFit;
    select.value = 'contain'; select.dispatchEvent(new Event('input', { bubbles: true }));
    const contain = getComputedStyle(root.querySelector('.image-card img')).objectFit;
    return { cover, contain, mode: root.querySelector('.gallery').dataset.fit };
  });
  t.equal(fit.cover, 'cover', 'Kırpma görünümü uygulanmadı');
  t.equal(fit.contain, 'contain', 'Sığdırma görünümüne dönülmedi');

  // --- Etkin filtre rozetleri ----------------------------------------------
  const chips = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const width = root.querySelector('[aria-label="Filtre minimum genişlik"]');
    width.value = '200'; width.dispatchEvent(new Event('input', { bubbles: true }));
    const format = root.querySelector('[aria-label="Dosya türü"]');
    format.value = 'png'; format.dispatchEvent(new Event('input', { bubbles: true }));
    const after = [...root.querySelectorAll('.drawer-chip-text')].map(n => n.textContent);
    const subtitle = root.querySelector('.drawer-subtitle').textContent;
    const chip = [...root.querySelectorAll('.drawer-chip')].find(c => c.textContent.includes('genişlik'));
    chip.click();
    return {
      after, subtitle,
      afterClear: [...root.querySelectorAll('.drawer-chip-text')].map(n => n.textContent),
      widthValue: width.value,
      subtitleAfter: root.querySelector('.drawer-subtitle').textContent,
      buttonActive: root.querySelector('.filter-open-button').classList.contains('filter-active'),
      chipsVisible: root.querySelector('.drawer-chips')?.hidden === false,
    };
  });
  t.equal(chips.after.length, 2, `Rozet sayısı beklenmedik: ${chips.after.join(' | ')}`);
  t.includes(chips.subtitle, '2 etkin filtre', 'Sayaç etkin filtre sayısını göstermiyor: ' + chips.subtitle);
  t.equal(chips.afterClear.length, 1, 'Rozete tıklamak filtreyi kaldırmadı');
  t.equal(chips.widthValue, '', 'Rozete tıklamak alanı temizlemedi');
  t.includes(chips.subtitleAfter, '1 etkin filtre', 'Sayaç rozet kaldırılınca güncellenmedi: ' + chips.subtitleAfter);
  t.ok(chips.buttonActive, 'Etkin filtre varken düğme vurgulanmıyor');
  t.ok(chips.chipsVisible, 'Etkin filtre varken rozet şeridi görünmüyor');

  // --- Sıfırlama ------------------------------------------------------------
  const reset = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    root.querySelector('.drawer-reset').click();
    return {
      chips: root.querySelectorAll('.drawer-chip').length,
      format: root.querySelector('[aria-label="Dosya türü"]').value,
      subtitle: root.querySelector('.drawer-subtitle').textContent,
      columns: root.querySelector('[aria-label="Izgara sütun sayısı"]').value,
      active: root.querySelector('.filter-open-button').classList.contains('filter-active'),
    };
  });
  t.equal(reset.chips, 0, 'Sıfırlama rozetleri temizlemedi');
  t.equal(reset.format, '', 'Sıfırlama filtreleri temizlemedi');
  t.includes(reset.subtitle, 'filtre yok', 'Sıfırlama sayacı güncellemedi: ' + reset.subtitle);
  t.equal(reset.columns, '2', 'Sıfırlama görünüm tercihini de değiştirdi');
  t.ok(!reset.active, 'Sıfırlama sonrası düğme hâlâ etkin görünüyor');

  // --- Yalnız seçili görseller ----------------------------------------------
  const onlySelected = await page.evaluate(() => {
    const root = document.getElementById('__image_scraper_v4__').shadowRoot;
    const box = [...root.querySelectorAll('.drawer-toggle')].find(l => l.textContent.includes('Yalnız seçili')).querySelector('input');
    box.click();
    const selectNone = [...root.querySelectorAll('.toolbar button')].find(b => b.textContent.includes('kaldır') && b.textContent.includes('Filtredekileri'));
    selectNone.click();
    const empty = { cards: root.querySelectorAll('.image-card').length, subtitle: root.querySelector('.drawer-subtitle').textContent };
    box.click();
    const restored = root.querySelectorAll('.image-card').length;
    return { empty, restored };
  });
  t.equal(onlySelected.empty.cards, 0, 'Seçim yokken "yalnız seçili" görünümü kart gösteriyor');
  t.includes(onlySelected.empty.subtitle, '0 /', 'Sayaç sıfır eşleşmeyi göstermiyor: ' + onlySelected.empty.subtitle);
  t.ok(onlySelected.restored > 0, 'Seçim filtresi kapatılınca kartlar geri gelmedi');

  // --- Kalıcılık ------------------------------------------------------------
  const prefs = await page.evaluate(() => JSON.parse(window.GM_getValue('isp_view_prefs_v1', '{}')));
  t.equal(prefs.captions, true, 'Açıklama tercihi güncel değil');
  t.equal(prefs.columns, 2, 'Sütun tercihi güncel değil');
  t.equal(prefs.fit, 'contain', 'Küçük resim görünümü güncel değil');
  t.equal(page.__pageErrors.length, 0, 'Filtre çekmecesinde sayfa hatası: ' + page.__pageErrors[0]);
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
