// ==UserScript==
// @name         Image Scraper — GitHub'dan yüklenen alternatif
// @namespace    https://github.com/Webbhesap/TamperMonkey
// @version      0.8.0
// @description  Görsel toplayıcı panelini GitHub'daki kaynak dosyalardan yükler. HTML/CSS her açılışta tazelenir.
// @author       Webbhesap
// @match        *://*/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/lib/alpine.min.js
// @require      https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/lib/jszip.min.js
// @require      https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/modules/zip.js
// @require      https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/modules/settings-ui.js
// @require      https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/modules/page-tools.js
// @require      https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/modules/network.js
// @require      https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/modules/image-analysis.js
// @require      https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/modules/ui-results.js
// @require      https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/app.js
// @resource     appHtml https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/panel.html
// @resource     appCss https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/styles.css
// @updateURL    https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/tampermonkey-loader.user.js
// @downloadURL  https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/tampermonkey-loader.user.js
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
 * Kurulum
 * -------
 * 1) Tampermonkey/Violentmonkey → Yeni betik → bu dosyanın içeriğini yapıştır → Kaydet.
 *    (Depodaki dosyayı tarayıcıda açıp "Ham" görünümünden kopyalayabilirsin.)
 * 2) Herhangi bir sayfayı yenile; sağ altta 🖼️ düğmesi görünür.
 *
 * Neden @require ve ayrıca getirme var?
 * -------------------------------------
 * Eklentiler @require ile listelenen JS dosyalarını, betiğin @version değerine göre
 * önbelleğe alır. app.js veya modüller değiştiğinde yeni kodun gelmesi için bu
 * dosyadaki @version değerini artırman gerekir (depoda değişiklik yapan için:
 * sürümü artırmayı unutma). panel.html ve styles.css önbelleğe alınmaz; her sayfa
 * açılışında `?_=zaman` eklenerek GitHub'dan yeniden çekilir, böylece arayüz ve
 * stiller sürüm artırmadan güncellenir. Ağ erişimi başarısız olursa @resource
 * kopyaları (kurulum anındaki sürüm) devreye girer.
 *
 * @connect neden `*`?
 * -------------------
 * Bu betik yalnızca GitHub'dan kendi dosyalarını indirseydi @connect
 * raw.githubusercontent.com yeterdi. Ama asıl işi, gezdiğin sayfadaki
 * görselleri indirmek ve görsel ZIP'ine eklemek. Görseller herhangi bir
 * alan adından gelebilir; @connect daraltılırsa GM_xmlhttpRequest
 * "This domain is not a part of the @connect list" hatası verir ve ZIP
 * adımındaki tüm görseller başarısız olur. Bu yüzden `*` gerekli.
 * Betik yalnızca senin başlattığın taramalarda istek yapar; arka planda
 * kendiliğinden dışarıya veri göndermez.
 *
 * @require sırası
 * ---------------
 * Modüller birbirine bağımlı değildir; yalnızca app.js en sonda olmalıdır
 * (fabrikaları çalışma anında ImageScraperModules üzerinden çözer).
 *
 * JS'i de önbelleksiz denemek istersen: tampermonkey-loader.dev.user.js
 */

(function () {
  'use strict';

  const BASE = 'https://raw.githubusercontent.com/Webbhesap/TamperMonkey/main/image-scraper/';
  const EXCLUDED_SITES_KEY = 'isp_excluded_sites_v1';
  const LOG_PREFIX = '[Image Scraper]';
  // Eklenti yoklaması: dosya gerçekten değiştiğinde yeni içerik alınması için
  // önbelleği atlayan bir parametre. Değer her açılışta değişir.
  const cacheBust = () => `?_=${Date.now()}`;

  const log = (level, message, error) => {
    const method = typeof console[level] === 'function' ? level : 'log';
    if (error) console[method](`${LOG_PREFIX} ${message}`, error);
    else console[method](`${LOG_PREFIX} ${message}`);
  };

  /** GM_xmlhttpRequest ile metin getirir; hata durumunda reddeder. */
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
          headers: { Accept: 'text/plain,text/html,text/css,*/*' },
          onload: response => {
            if (response.status >= 200 && response.status < 300 && typeof response.responseText === 'string' && response.responseText.trim()) {
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

  /** @resource metni; izin yoksa null. */
  function readResource(name) {
    try {
      const text = typeof GM_getResourceText === 'function' ? GM_getResourceText(name) : null;
      return typeof text === 'string' && text.trim() ? text : null;
    } catch { return null; }
  }

  /** @resource'u CSS olarak kullanılabilir bir URL'e çevirir (yedek yol). */
  function resourceCssUrl() {
    const css = readResource('appCss');
    if (!css) return null;
    try {
      if (typeof GM_getResourceURL === 'function') {
        const url = GM_getResourceURL('appCss');
        if (url) return url;
      }
    } catch { /* aşağıdaki data: yoluna düşülür */ }
    // CSS'i base64'e çevirirken ASCII dışı karakterler bozulmasın.
    try { return `data:text/css;charset=utf-8,${encodeURIComponent(css)}`; } catch { return null; }
  }

  /** Kullanıcının bu sitede betiği kapattığı ayarı uygular (panel kurulmadan önce). */
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
   * panel.html her açılışta tazelenir; başarısız olursa kurulum anındaki @resource
   * kopyası kullanılır. Böylece arayüz güncellemeleri sürüm artırmadan gelir.
   */
  async function loadPanelHtml() {
    try {
      const html = await gmFetchText(`${BASE}panel.html${cacheBust()}`);
      if (!html.includes('isp-launch-template')) throw new Error('panel.html beklenen şablonları içermiyor');
      return html;
    } catch (error) {
      log('warn', 'panel.html GitHub’dan alınamadı; @resource kopyası kullanılacak.', error);
      return readResource('appHtml');
    }
  }

  /** styles.css için aynı tazeleme akışı; sonuç bir CSS URL'i. */
  async function loadCssUrl() {
    try {
      const css = await gmFetchText(`${BASE}styles.css${cacheBust()}`);
      const blob = new Blob([css], { type: 'text/css;charset=utf-8' });
      return URL.createObjectURL(blob);
    } catch (error) {
      log('warn', 'styles.css GitHub’dan alınamadı; @resource kopyası kullanılacak.', error);
      return resourceCssUrl();
    }
  }

  /** Panel ve stil hazır olduğunda uygulamayı başlatır. */
  function start(panelHtml, cssUrl) {
    const app = globalThis.ImageScraperApp;
    if (!app || typeof app.start !== 'function') {
      log('error', 'app.js yüklenemedi. @require listesini ve @connect iznini ' +
        '(raw.githubusercontent.com) kontrol et. Depo erişilemiyorsa @version artırıp betiği yeniden kur.');
      return;
    }
    if (!panelHtml) { log('error', 'panel.html yüklenemedi; panel oluşturulmadı.'); return; }
    if (!cssUrl) { log('error', 'styles.css yüklenemedi; panel oluşturulmadı.'); return; }
    const version = (() => {
      try { return GM_info?.script?.version || ''; } catch { return ''; }
    })();
    try {
      app.start({ panelHtml, cssUrl, version });
    } catch (error) {
      log('error', 'Panel başlatılamadı.', error);
    }
  }

  // Aynı belgeye iki kez enjekte edilirse panel ikilenmesin.
  if (document.getElementById('__image_scraper_v4__')) return;
  if (excludedHere()) return;

  (async () => {
    try {
      const [panelHtml, cssUrl] = await Promise.all([loadPanelHtml(), loadCssUrl()]);
      start(panelHtml, cssUrl);
    } catch (error) {
      log('error', 'Başlatma sırasında beklenmeyen hata.', error);
    }
  })();
})();
