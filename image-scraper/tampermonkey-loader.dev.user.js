// ==UserScript==
// @name         Image Scraper — geliştirme (önbelleksiz)
// @namespace    https://github.com/Webbhesap/TamperMonkey
// @version      0.6.0
// @description  Geliştirme sürümü: tüm JS dosyalarını her açılışta GitHub'dan çeker, @require önbelleği kullanmaz.
// @author       Webbhesap
// @match        *://*/*
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/tampermonkey-loader.dev.user.js
// @downloadURL  https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/tampermonkey-loader.dev.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @grant        GM_getResourceURL
// @connect      raw.githubusercontent.com
// @connect      *
// ==/UserScript==

/*
 * Ne zaman kullanılır?
 * -------------------
 * Kararlı loader JS dosyalarını @require ile çeker ve eklenti bunları @version
 * değerine göre önbelleğe alır. Bu dosya hiç @require kullanmaz: modülleri her
 * sayfa açılışında `?_=zaman` ile indirip sırayla çalıştırır. Yani kodu
 * değiştirip depoya gönderdikten sonra sürüm artırmadan test edebilirsin.
 *
 * Bedeli: her sayfa açılışında birkaç ek ağ isteği ve ~30 ms ek gecikme.
 * Günlük kullanım için kararlı loader'ı tercih et.
 *
 * @connect hakkında (kararlı loader ile aynı gerekçe)
 * ------------------------------------------------
 * Görseller herhangi bir alan adından gelebilir ve bunlar GM_xmlhttpRequest
 * ile indirilir. @connect daraltılırsa o istekler "not a part of the
 * @connect list" hatasıyla reddedilir.
 *
 * Sayfa CSP'si hakkında
 * ---------------------
 * Modüller userscript kapsamında çalıştırılır, sayfanın içine <script> olarak
 * enjekte edilmez. Çoğu eklenti bu kapsamı sayfanın Content-Security-Policy
 * kurallarından muaf tutar; yine de kod çalıştırılamazsa hata günlüğe yazılır
 * ve sayfa bozulmaz (kararlı loader bu kısıtlamadan hiç etkilenmez).
 */

(function () {
  'use strict';

  const BASE = 'https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/';
  // Yükleme sırası önemli: bağımlılıklar önce.
  const SCRIPTS = [
    'lib/alpine.min.js',
    'lib/jszip.min.js',
    'modules/zip.js',
    'modules/settings-ui.js',
    'modules/page-tools.js',
    'modules/network.js',
    'modules/image-analysis.js',
    'modules/ui-results.js',
    'app.js',
  ];
  const EXCLUDED_SITES_KEY = 'isp_excluded_sites_v1';
  const LOG_PREFIX = '[Image Scraper dev]';

  const log = (level, message, error) => {
    const method = typeof console[level] === 'function' ? level : 'log';
    if (error) console[method](`${LOG_PREFIX} ${message}`, error);
    else console[method](`${LOG_PREFIX} ${message}`);
  };

  function gmFetchText(url, timeout = 15000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve(value);
      };
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout,
          headers: { Accept: 'text/plain,text/javascript,text/css,text/html,*/*' },
          onload: response => {
            if (response.status >= 200 && response.status < 300 && typeof response.responseText === 'string') {
              finish(null, response.responseText);
            } else {
              finish(new Error(`HTTP ${response.status || '?'}`));
            }
          },
          onerror: () => finish(new Error('Ağ hatası')),
          ontimeout: () => finish(new Error('Zaman aşımı')),
        });
      } catch (error) { finish(error); }
    });
  }

  function excludedHere() {
    try {
      const raw = GM_getValue(EXCLUDED_SITES_KEY, []);
      const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(list)) return false;
      const host = String(location.hostname || '').toLowerCase().replace(/\.$/, '');
      const normalize = value => {
        const text = String(value || '').trim().toLowerCase().replace(/^\*\./, '');
        if (!text) return '';
        try { return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`).hostname.replace(/\.$/, ''); }
        catch { return ''; }
      };
      return list.map(normalize).filter(Boolean).some(rule => host === rule || host.endsWith(`.${rule}`));
    } catch { return false; }
  }

  /**
   * Kodu userscript kapsamında çalıştırır. Sayfaya <script> eklemediği için
   * inline-script CSP kurallarından etkilenmez. sourceURL, hata ayıklarken
   * yığın izlerinde gerçek dosya adını gösterir.
   */
  function runInScope(code, filename) {
    const source = `${code}\n//# sourceURL=${BASE}${filename}`;
    try {
      (0, eval)(source);
      return true;
    } catch (error) {
      log('error', `${filename} çalıştırılamadı. Sayfa CSP'si kod çalıştırmayı engelliyor olabilir; ` +
        'kararlı loader (@require) bu kısıtlamadan etkilenmez.', error);
      return false;
    }
  }

  if (document.getElementById('__image_scraper_v4__')) return;
  if (excludedHere()) return;

  (async () => {
    const startedAt = Date.now();
    try {
      const stamp = `?_=${startedAt}`;
      // Dosyalar paralel indirilir, çalıştırma sırası korunur: ağ beklemesi kısalır.
      const sources = await Promise.all(SCRIPTS.map(file =>
        gmFetchText(`${BASE}${file}${stamp}`).then(code => ({ file, code }))));
      for (const { file, code } of sources) if (!runInScope(code, file)) return;

      const [panelHtml, css] = await Promise.all([
        gmFetchText(`${BASE}panel.html${stamp}`),
        gmFetchText(`${BASE}styles.css${stamp}`),
      ]);
      if (!panelHtml.includes('isp-launch-template')) throw new Error('panel.html beklenen şablonları içermiyor');
      const app = globalThis.ImageScraperApp;
      if (!app || typeof app.start !== 'function') { log('error', 'app.js çalıştırılamadı.'); return; }
      const cssUrl = URL.createObjectURL(new Blob([css], { type: 'text/css;charset=utf-8' }));
      app.start({ panelHtml, cssUrl, version: 'dev' });
      log('info', `hazır (${sources.length} dosya, ${Date.now() - startedAt} ms)`);
    } catch (error) {
      log('error', 'Dosyalar GitHub’dan yüklenemedi. Depo yolu, @connect izni ve ' +
        'internet bağlantısını kontrol et.', error);
    }
  })();
})();
