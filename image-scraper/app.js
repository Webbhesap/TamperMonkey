/* Image Scraper Alternative app core. HTML and CSS are supplied by an entry point. */
(function (global) {
  global.ImageScraperApp = {
    start(options) {
      'use strict';
      options = options || {};

  // Dynamic denylist is checked before touching the page DOM. Matching entries
  // suppress the entire scraper UI and all scanning on that host and subdomains.
  const EXCLUDED_SITES_KEY = 'isp_excluded_sites_v1';
  function normalizeExcludedSite(value) {
    try {
      let raw = String(value || '').trim().toLowerCase();
      if (!raw) return '';
      raw = raw.replace(/^\*\./, '');
      const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
      if (!host || !/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])$/i.test(host) || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return '';
      return host;
    } catch { return ''; }
  }
  function readExcludedSites() {
    try {
      const raw = GM_getValue(EXCLUDED_SITES_KEY, []);
      const values = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(values) ? [...new Set(values.map(normalizeExcludedSite).filter(Boolean))] : [];
    } catch { return []; }
  }
  function isExcludedHost(hostname, entries) {
    const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
    return (entries || []).some(entry => {
      const rule = normalizeExcludedSite(entry);
      return rule && (host === rule || host.endsWith(`.${rule}`));
    });
  }
  try {
    if (isExcludedHost(location.hostname, readExcludedSites())) return;
  } catch { /* Fail open only if the userscript storage API itself is unavailable. */ }

  const templateDocument = new DOMParser().parseFromString(options.panelHtml || '', 'text/html');
  if (!templateDocument.getElementById('isp-launch-template') || !options.cssUrl) {
    console.error('[Image Scraper Alternative] panel.html or stylesheet is missing.');
    return;
  }
  const cloneTemplate = id => {
    const template = templateDocument.getElementById(id);
    if (!template?.content) throw new Error(`HTML şablonu bulunamadı: ${id}`);
    return document.importNode(template.content, true);
  };

  const DEFAULTS = Object.freeze({
    MAX_PAGES: 5,
    NEXT_SELECTOR: '',
    PAGINATION_MODE: 'auto',
    STOP_DUPLICATE_PAGES: true,
    MIN_WIDTH: 300,
    MIN_HEIGHT: 300,
    CHECK_REAL_SIZE: true,
    TIMEOUT_MS: 15000,
    USE_SELECTOR: false,
    SELECTOR: '.single-content > p',
    DECODE_URL: true, // Sadece sonuçların gösterimi/kopyalanması; istek URL'si korunur.
    RETRY_REFERER: true,
    USE_REPLACE: false,
    REPLACEMENTS: [
      { from: '/test/', to: '/deneme/' },
      { from: '/test1/', to: '/deneme1/' },
    ],
    ZIP_FILENAME: 'images.zip',
    ZIP_CONCURRENT: 3,
    EXCLUDE_UNKNOWN: false,
    DYNAMIC_SCROLL: false,
    DYNAMIC_STEPS: 10,
    PART_MAX_FILES: 250,
    PART_MAX_MB: 200,
    DEDUPE_CONTENT: false,
    NAME_TEMPLATE: '{sira}_{orijinal_ad}',
    SKIP_PATTERNS: 'thumb|icon|logo|avatar|emoji|banner|1x1|pixel|\\.gif(?:$|[?#])',
    CUSTOM_PAGINATION_TEMPLATE: '{url}/{n}',
    IMAGE_SOURCE_MODE: 'any',
    IMAGE_SOURCE_HOSTS: '',
    PREVIEW_PAGE_QUEUE: false,
    SAVE_SCAN_PROGRESS: false,
    GROUP_VISUAL_SIMILARITY: false,
    STREAM_ZIP_TO_DISK: false,
    DEEP_CRAWL: false,
    ARTICLE_LINK_SELECTOR: '',
    ARTICLE_TITLE_SELECTOR: 'h1',
    ARTICLE_NEXT_SELECTOR: '',
    ARTICLE_MAX_PAGES: 0,
    MAX_ARTICLES: 0,
  });
  const KEY = 'isp_config'; // Önceki sürümün ayarları da okunur.
  const $el = (tag, attrs = {}, text) => {
    const baseTemplate = templateDocument.getElementById(`isp-element-${tag}`);
    const baseNode = baseTemplate?.content?.firstElementChild;
    if (!baseNode) throw new Error(`panel.html içinde isp-element-${tag} şablonu bulunamadı`);
    const node = document.importNode(baseNode, true);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value;
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    }
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const abortError = () => new DOMException('İşlem iptal edildi.', 'AbortError');
  const isAbort = e => e && e.name === 'AbortError';
  const checkAbort = signal => { if (signal && signal.aborted) throw abortError(); };
  const createZipModule = global.ImageScraperModules?.createZipModule;
  if (typeof createZipModule !== 'function') throw new Error('ZIP modülü yüklenemedi. Loader @require sırasını kontrol et.');
  const { safeBaseName, zipName, zipEntryName, createUniqueZipFile, saveBlob, buildZip, consumeZipStream, generateZipBlob, generateZipToWritable } =
    createZipModule({ $el, document, URL, Blob, Uint8Array, checkAbort, abortError });
  const createNetworkModule = global.ImageScraperModules?.createNetworkModule;
  if (typeof createNetworkModule !== 'function') throw new Error('Ağ modülü yüklenemedi. Loader @require sırasını kontrol et.');
  const { isChallengeHTML, pageGM, fetchPage, gmBlob, downloadImage, downloadImageRetry } =
    createNetworkModule({ location, GM_xmlhttpRequest, checkAbort, abortError, isAbort, fetchImpl: fetch.bind(globalThis), DOMParserImpl: DOMParser });
  const clampInt = (v, min, max, fallback) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  };
  function loadConfig() {
    try {
      const raw = GM_getValue(KEY, null);
      let saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const profileRaw = GM_getValue('isp_profiles_v1', '{}');
      const profiles = typeof profileRaw === 'string' ? JSON.parse(profileRaw) : profileRaw;
      if (profiles && profiles[location.origin]) saved = { ...(saved || {}), ...profiles[location.origin] };
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...DEFAULTS };
      const c = { ...DEFAULTS, ...saved };
      for (const [k, min, max] of [['MAX_PAGES', 0, 50], ['MIN_WIDTH', 0, 100000], ['MIN_HEIGHT', 0, 100000], ['TIMEOUT_MS', 1000, 120000], ['ZIP_CONCURRENT', 1, 10], ['PART_MAX_FILES', 1, 10000], ['PART_MAX_MB', 1, 2000], ['ARTICLE_MAX_PAGES', 0, 10000], ['MAX_ARTICLES', 0, 100000]]) {
        c[k] = clampInt(c[k], min, max, DEFAULTS[k]);
      }
      c.DYNAMIC_STEPS = clampInt(c.DYNAMIC_STEPS, 0, Number.MAX_SAFE_INTEGER, DEFAULTS.DYNAMIC_STEPS);
      for (const k of ['CHECK_REAL_SIZE', 'USE_SELECTOR', 'USE_REPLACE', 'DECODE_URL', 'RETRY_REFERER', 'EXCLUDE_UNKNOWN', 'DYNAMIC_SCROLL', 'DEDUPE_CONTENT', 'STOP_DUPLICATE_PAGES', 'PREVIEW_PAGE_QUEUE', 'SAVE_SCAN_PROGRESS', 'GROUP_VISUAL_SIMILARITY', 'STREAM_ZIP_TO_DISK', 'DEEP_CRAWL']) c[k] = c[k] === true;
      if (!['auto','html-slash','query-page','page-path','slash-page','dash-html','underscore-html','custom'].includes(c.PAGINATION_MODE)) c.PAGINATION_MODE = 'auto';
      if (!['any','same-host','selected-hosts'].includes(c.IMAGE_SOURCE_MODE)) c.IMAGE_SOURCE_MODE = 'any';
      for (const k of ['SELECTOR', 'NEXT_SELECTOR', 'ZIP_FILENAME', 'SKIP_PATTERNS', 'NAME_TEMPLATE', 'CUSTOM_PAGINATION_TEMPLATE', 'IMAGE_SOURCE_HOSTS', 'ARTICLE_LINK_SELECTOR', 'ARTICLE_TITLE_SELECTOR', 'ARTICLE_NEXT_SELECTOR']) if (typeof c[k] !== 'string') c[k] = DEFAULTS[k];
      if (!Array.isArray(c.REPLACEMENTS) || !c.REPLACEMENTS.every(r => r && typeof r.from === 'string' && r.from.length > 0 && typeof r.to === 'string')) c.REPLACEMENTS = DEFAULTS.REPLACEMENTS;
      try { if (c.SKIP_PATTERNS) new RegExp(c.SKIP_PATTERNS, 'i'); } catch { c.SKIP_PATTERNS = DEFAULTS.SKIP_PATTERNS; }
      return c;
    } catch (e) { console.warn('[Image Scraper] Ayarlar okunamadı:', e); return { ...DEFAULTS }; }
  }
  function saveConfig(config) { GM_setValue(KEY, JSON.stringify(config)); }

  // Shadow DOM, sayfanın stillerinin ve yinelenen ID'lerin paneli bozmasını önler.
  const host = $el('div', { id: '__image_scraper_v4__' });
  if (document.getElementById(host.id)) return;
  document.documentElement.appendChild(host);
  const ui = host.attachShadow({ mode: 'open' });
  const style = $el('link', { rel: 'stylesheet', href: options.cssUrl });
  ui.appendChild(style);
  const launchTemplate = cloneTemplate('isp-launch-template');
  const launch = launchTemplate.querySelector('.launch');
  const settingsButton = launch.querySelector('[data-isp-action="settings"]');
  const scanButton = launch.querySelector('[data-isp-action="scan"]');
  ui.appendChild(launchTemplate);
  let overlay = null, closeCurrentDialog = null;
  // Sayfanın önceki inline overflow ayarlarını ve önceliklerini geri yükle.
  function lockPageScroll() {
    const x = window.scrollX, y = window.scrollY;
    const nodes = [...new Set([document.documentElement, document.body, document.scrollingElement].filter(Boolean))];
    const properties = ['overflow', 'overflow-x', 'overflow-y'];
    const saved = nodes.map(node => ({ node, values: properties.map(key => ({ key, value: node.style.getPropertyValue(key), priority: node.style.getPropertyPriority(key) })) }));
    nodes.forEach(node => node.style.setProperty('overflow', 'hidden', 'important'));
    window.scrollTo(x, y);
    return () => { saved.forEach(({ node, values }) => {
      node.style.removeProperty('overflow');
      for (const { key, value, priority } of values) {
        if (value) node.style.setProperty(key, value, priority);
        else node.style.removeProperty(key);
      }
    }); window.scrollTo(x, y); };
  }
  function dialog(title, subtitle = '') {
    if (closeCurrentDialog) closeCurrentDialog();
    const previousFocus = document.activeElement;
    const unlock = lockPageScroll();
    const dialogTemplate = cloneTemplate('isp-dialog-template');
    const bg = dialogTemplate.querySelector('.overlay'), box = dialogTemplate.querySelector('.dialog');
    const header = dialogTemplate.querySelector('.header'), identity = dialogTemplate.querySelector('.identity');
    const titles = dialogTemplate.querySelector('.dialog-titles'), titleNode = dialogTemplate.querySelector('[data-dialog-title]');
    const subtitleNode = dialogTemplate.querySelector('[data-dialog-subtitle]'), close = dialogTemplate.querySelector('[data-isp-action="close"]');
    box.setAttribute('aria-label', title); titleNode.textContent = title;
    subtitleNode.textContent = subtitle; subtitleNode.hidden = !subtitle;
    let onClose = null, closed = false;
    const closeDialog = () => {
      if (closed) return;
      closed = true;
      try { if (onClose) onClose(); } finally {
        bg.remove(); unlock();
        if (overlay === bg) { overlay = null; closeCurrentDialog = null; }
        try { previousFocus?.focus({ preventScroll: true }); } catch {}
      }
    };
    close.onclick = closeDialog;
    bg.onclick = e => { if (e.target === bg) closeDialog(); };
    // Sayfanın wheel/touch dinleyicilerine ulaşmasını engelle; panel kendi içinde kayabilir.
    bg.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    bg.addEventListener('touchmove', e => { if (e.target === bg) e.preventDefault(); e.stopPropagation(); }, { passive: false });
    bg.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); closeDialog(); return; }
      if (e.key !== 'Tab') return;
      const focusable = [...box.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]), textarea:not([disabled]), a[href]:not([hidden]), summary')]
        .filter(el => el.getClientRects().length > 0);
      if (!focusable.length) { e.preventDefault(); close.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1], active = ui.activeElement;
      if (e.shiftKey && (active === first || !box.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !box.contains(active))) { e.preventDefault(); first.focus(); }
    });
    ui.appendChild(bg);
    overlay = bg; closeCurrentDialog = closeDialog;
    try { close.focus({ preventScroll: true }); } catch {}
    return { box, header, identity, titles, subtitle:subtitleNode, closeDialog, close, setOnClose: fn => { onClose = fn; } };
  }
  function section(parent, title) {
    const fragment = cloneTemplate('isp-section-template'), node = fragment.querySelector('.section');
    node.querySelector('[data-section-title]').textContent = title;
    parent.appendChild(node); return node;
  }
  const createSettingsUI = global.ImageScraperModules?.createSettingsUI;
  if (typeof createSettingsUI !== 'function') throw new Error('Ayarlar UI modülü yüklenemedi. Loader @require sırasını kontrol et.');
  const showSettings = createSettingsUI({ loadConfig, saveConfig, dialog, cloneTemplate, readJSON, $el, saveBlob, KEY, DEFAULTS,
    EXCLUDED_SITES_KEY, readExcludedSites, normalizeExcludedSite, isExcludedHost, GM_getValue, GM_setValue, location, document, showStorageManager });
  settingsButton.onclick = () => showSettings('settings');

  // Tüm sitelerde tek Tampermonkey deposu: değerler açık kullanıcı eylemiyle kaydedilir.
  const SESSION_KEY = 'isp_session_v1', CACHE_KEY = 'isp_image_cache_v1', PROFILE_KEY = 'isp_profiles_v1', SCAN_STATE_KEY = 'isp_scan_state_v1';
  const CACHE_CAP = 20 * 1024 * 1024; // Kodlanmış veri ve JSON için uygulama üst sınırı; eklenti kotası daha düşük olabilir.
  const deleteKey = key => GM_deleteValue(key);
  function readJSON(key, fallback) {
    try { const raw = GM_getValue(key, null); return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : fallback; }
    catch { return fallback; }
  }
  function formatBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB'; }
  function etaSeconds(done, total, elapsedSeconds) {
    if (!(done > 0 && done < total && elapsedSeconds > 0)) return null;
    return Math.max(0, (total - done) * elapsedSeconds / done);
  }
  function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    const s = Math.ceil(seconds);
    if (s < 60) return `${s} sn`;
    if (s < 3600) return `${Math.floor(s / 60)} dk ${s % 60} sn`;
    return `${Math.floor(s / 3600)} sa ${Math.floor(s % 3600 / 60)} dk`;
  }
  function encodeData(buffer) {
    const bytes = new Uint8Array(buffer), parts = [];
    for (let i = 0; i < bytes.length; i += 32768) parts.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
    return btoa(parts.join(''));
  }
  function decodeData(base64) {
    const str = atob(base64), a = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) a[i] = str.charCodeAt(i);
    return a.buffer;
  }
  function showStorageManager(parent = null) {
    const d = parent ? null : dialog('Ayarlar ve kayıtlar', 'Ayarları düzenle veya kayıtları yönet');
    const root = parent || d.box;
    if (parent) root.replaceChildren();
    const info = section(root, 'Yerel veriler');
    const note = $el('p', { class:'muted' }, 'Yerel kayıtlar ve depolama bilgisi ');
    note.appendChild($el('span', { class:'help-tip', tabIndex:0, 'data-tooltip':'Kayıtlar Tampermonkey deposundadır. İmzalı URL’ler kişisel bilgi içerebilir. İndirme klasöründeki dosyalar, tarayıcı önbelleği ve çerezler burada silinmez. Açık sonuç pencerelerindeki görselleri bellekten temizlemek için pencereyi kapat.', 'aria-label':'Depolama bilgisi' }));
    info.appendChild(note);
    const state = $el('p', { class: 'status' }); info.appendChild(state);
    const status = () => {
      const session = readJSON(SESSION_KEY, null), cache = GM_getValue(CACHE_KEY, '');
      const scanState = readJSON(SCAN_STATE_KEY, null), profiles = readJSON(PROFILE_KEY, {});
      const configExists = GM_getValue(KEY, null) !== null;
      state.textContent = `Genel ayarlar: ${configExists ? 'var' : 'yok'}\nOturum: ${session ? `${session.images?.length || 0} bağlantı · ${session.origin || 'bilinmeyen site'}` : 'yok'}\nYarım kalan tarama: ${scanState ? `${scanState.pages?.length || 0} sayfa · ${scanState.origin || 'bilinmeyen site'}` : 'yok'}\nGörsel önbelleği: ${cache ? formatBytes(String(cache).length * 2) + ' (yaklaşık)' : 'yok'}\nSite profilleri: ${Object.keys(profiles || {}).length}\nHariç tutulan siteler: ${readExcludedSites().length}`;
    };
    const actions = $el('div', { class: 'storage-actions' });
    const resume = $el('button', { type: 'button', class: 'primary' }, '▶ Kayıtlı oturumu aç');
    const resumeScan = $el('button', { type: 'button', class: 'secondary' }, '↻ Yarım kalan taramayı sürdür');
    const clearCache = $el('button', { type: 'button', class: 'secondary' }, 'Görsel verilerini sil');
    const clearSession = $el('button', { type: 'button', class: 'secondary' }, 'Oturumu ve görselleri sil');
    const clearProfiles = $el('button', { type: 'button', class: 'secondary' }, 'Site profillerini sil');
    const clearAll = $el('button', { type: 'button', class: 'danger' }, 'Tüm betik verilerini sil');
    actions.append(resume, resumeScan, clearCache, clearSession, clearProfiles, clearAll); info.appendChild(actions);
    const pendingScan = readJSON(SCAN_STATE_KEY, null);
    resumeScan.disabled = !pendingScan?.nextUrl || pendingScan.origin !== location.origin;
    resumeScan.title = pendingScan && pendingScan.origin !== location.origin ? `Taramayı sürdürmek için ${pendingScan.origin} adresine git.` : '';
    resumeScan.onclick = () => {
      const latest = readJSON(SCAN_STATE_KEY, null);
      if (!latest?.nextUrl || latest.origin !== location.origin) { outcome.textContent = 'Bu sayfada sürdürülebilecek tarama kaydı yok.'; return; }
      if (d) d.closeDialog(); else closeCurrentDialog?.(); forceResumeScan = true; scanButton.click();
    };
    const outcome = $el('p', { class: 'status', role: 'status' }); info.appendChild(outcome); status();
    const perform = (message, keys) => {
      if (!confirm(message)) return;
      try {
        keys.forEach(deleteKey);
        const remaining = keys.filter(k => GM_getValue(k, null) !== null);
        status();
        outcome.textContent = remaining.length ? `⚠️ Bazı kayıtlar hâlâ mevcut: ${remaining.join(', ')}` : '✅ Seçilen kayıtların depoda bulunmadığı doğrulandı.';
      } catch (e) { status(); outcome.textContent = '❌ Silme tamamlanamadı: ' + e.message; }
    };
    clearCache.onclick = () => perform('Kaydedilmiş görsel verileri silinsin mi? Oturum bağlantıları kalır.', [CACHE_KEY]);
    clearSession.onclick = () => perform('Kayıtlı oturum, görsel verileri ve yarım kalan tarama kaydı silinsin mi?', [SESSION_KEY, CACHE_KEY, SCAN_STATE_KEY]);
    clearProfiles.onclick = () => perform('Tüm siteye özel ayar profilleri silinsin mi?', [PROFILE_KEY]);
    clearAll.onclick = () => perform('Oturum, görsel verileri, tüm site profilleri, hariç tutulan siteler ve genel ayarlar silinsin mi? İndirilmiş dosyalar etkilenmez.', [SESSION_KEY, CACHE_KEY, SCAN_STATE_KEY, PROFILE_KEY, EXCLUDED_SITES_KEY, KEY]);
    resume.onclick = () => {
      const saved = readJSON(SESSION_KEY, null);
      if (!saved || !Array.isArray(saved.images)) { outcome.textContent = 'Kayıtlı oturum yok.'; return; }
      if (saved.origin !== location.origin) { outcome.textContent = `Oturumu açmak için önce kaynak siteye git: ${saved.origin}`; return; }
      if (!confirm(`Kayıtlı oturum açılsın mı? ${saved.images.length} bağlantı · ${saved.origin}`)) return;
      if (d) d.closeDialog(); else closeCurrentDialog?.(); showResults({ images: saved.images, duplicates:saved.duplicates || [], contentDuplicates:saved.contentDuplicates || [], pages: saved.pages || [], warnings: saved.warnings || [], blocked: saved.blocked || [] }, loadConfig(), saved);
    };
  }

  const createPageTools = global.ImageScraperModules?.createPageTools;
  if (typeof createPageTools !== 'function') throw new Error('Sayfa analiz modülü yüklenemedi. Loader @require sırasını kontrol et.');
  const { buildUrl, srcsetUrl, imageUrl, documentBase, passesImageSourceHost, smartFitMode, htmlDimension, collect, nextByTemplate, pageOrdinal, nextPage } =
    createPageTools({ document, location, normalizeExcludedSite, isExcludedHost, DEFAULTS });
  function measure(url, timeout, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(abortError()); return; }
      const img = new Image(); let done = false;
      const finish = (err, result) => {
        if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', cancel);
        img.onload = img.onerror = null;
        if (err) { img.src = ''; reject(err); } else resolve(result);
      };
      const cancel = () => finish(abortError());
      const timer = setTimeout(() => { finish(null, { w: 0, h: 0 }); img.src = ''; }, timeout);
      signal.addEventListener('abort', cancel, { once: true });
      img.onload = () => finish(null, { w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => finish(null, { w: 0, h: 0 });
      img.src = url;
    });
  }
  async function pool(items, limit, task, progress, signal) {
    let index = 0, completed = 0;
    async function worker() {
      while (true) {
        checkAbort(signal);
        const i = index++; if (i >= items.length) return;
        await task(items[i], i);
        completed++; if (progress) progress(completed, items.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  }
  async function adaptivePool(items, maxLimit, task, progress, signal, getLimit) {
    let index = 0, completed = 0, active = 0;
    const cap = Math.max(1, Math.floor(Number(maxLimit) || 1));
    async function worker() {
      while (true) {
        checkAbort(signal);
        if (index >= items.length) return;
        let desired = Math.max(1, Math.min(cap, Math.floor(Number(getLimit?.()) || cap)));
        if (active >= desired) { await new Promise(resolve => setTimeout(resolve, 120)); continue; }
        const i = index++; active++;
        try { await task(items[i], i); }
        finally {
          active--; completed++;
          desired = Math.max(1, Math.min(cap, Math.floor(Number(getLimit?.()) || cap)));
          if (progress) progress(completed, items.length, { active, limit:desired });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(cap, items.length) }, worker));
  }
  function passesSize(img, c) {
    if (c.EXCLUDE_UNKNOWN && (!img.width || !img.height) && (c.MIN_WIDTH > 0 || c.MIN_HEIGHT > 0)) return false;
    return !(c.MIN_WIDTH > 0 && img.width > 0 && img.width < c.MIN_WIDTH) &&
      !(c.MIN_HEIGHT > 0 && img.height > 0 && img.height < c.MIN_HEIGHT);
  }
  function pageFingerprint(doc, found) {
    // Yalnızca hem içerik metni hem görsel URL'leri aynıysa yinelenmiş sayfa say.
    // Sayfalama ve çalıştırılmayan kod parçaları adresler arasında değişebilir.
    if (!found.length) return null;
    const root = doc.querySelector('.entry-content, article, main, #content') || doc.body;
    if (!root) return null;
    const clone = root.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, nav, .pagination, .pager, .wp-pagenavi, .page-links, .pgntn-page-pagination, .nav-links').forEach(x => x.remove());
    const text = (clone.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20000);
    return JSON.stringify([found.map(i => i.url).sort(), text]);
  }
  async function discoverPageQueue(c, signal, status) {
    const pages = [], warnings = [], blocked = [], visited = new Set();
    let currentUrl = location.href.split('#')[0], currentReason = 'Başlangıç sayfası';
    for (let i = 0; c.MAX_PAGES === 0 || i < c.MAX_PAGES; i++) {
      checkAbort(signal);
      if (visited.has(currentUrl)) break;
      let doc, actualUrl = currentUrl;
      if (i === 0) doc = document;
      else {
        try { const page = await fetchPage(currentUrl, c, signal); doc = page.doc; actualUrl = page.url.split('#')[0]; }
        catch (e) { if (isAbort(e)) throw e; warnings.push(`Sayfa alınamadı: ${currentUrl} (${e.message})`); if (e.status === 403) blocked.push(currentUrl); break; }
      }
      if (visited.has(actualUrl)) { warnings.push(`Sayfalama durdu: yönlendirme daha önce bulunan bir sayfaya dönüyor (${actualUrl}).`); break; }
      visited.add(currentUrl); visited.add(actualUrl);
      pages.push({ url: actualUrl, doc, reason: currentReason });
      status(`🔎 Sayfa kuyruğu bulunuyor: ${pages.length}${c.MAX_PAGES ? `/${c.MAX_PAGES}` : ''}…`);
      const next = nextPage(doc, actualUrl, visited, c, i + 1);
      if (next) currentReason = pageQueueReason(doc, actualUrl, next, c);
      if (!next) {
        if (c.MAX_PAGES > 0 && pages.length < c.MAX_PAGES) warnings.push(`Sayfa kuyruğu ${pages.length}. sayfada durdu: uygun sonraki bağlantı bulunamadı.`);
        break;
      }
      currentUrl = next;
    }
    return { pages, warnings, blocked };
  }
  function discoverArticleLinks(doc, pageUrl, config, categoryUrls) {
    const base = documentBase(doc, pageUrl);
    let anchors = [];
    if (config.ARTICLE_LINK_SELECTOR) {
      try { anchors = [...doc.querySelectorAll(config.ARTICLE_LINK_SELECTOR)].flatMap(node => node.matches('a[href]') ? [node] : [...node.querySelectorAll('a[href]')]); }
      catch (e) { throw new Error(`İçerik bağlantısı seçicisi geçersiz: ${e.message}`); }
    } else {
      const preferred = 'article a[href], .entry-title a[href], .post-title a[href], h2 a[href], h3 a[href], main a[href], #content a[href]';
      anchors = [...doc.querySelectorAll(preferred)];
      if (!anchors.length) anchors = [...doc.querySelectorAll('a[href]')];
    }
    const found = [], seen = new Set();
    for (const anchor of anchors) {
      if (anchor.closest('nav, header, footer, aside, .pagination, .pager, .page-numbers, .wp-pagenavi, [role="navigation"]')) continue;
      const raw = anchor.getAttribute('href'); if (!raw || /^\s*(?:#|javascript:|mailto:|tel:)/i.test(raw)) continue;
      try {
        const url = new URL(raw, base); url.hash = '';
        if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) continue;
        const href = url.href;
        if (href === pageUrl || categoryUrls.has(href) || seen.has(href)) continue;
        if (url.searchParams.has('page') || url.searchParams.has('paged') || url.searchParams.has('page_num') || /\/(?:page|paged)\/\d+\/?$/i.test(url.pathname) || /\/(?:\d{1,3})\/?$/.test(url.pathname) && /(?:page|category|tag|archive)/i.test(url.pathname)) continue;
        if (/\.(?:jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3)$/i.test(url.pathname)) continue;
        const label = `${anchor.textContent || ''} ${anchor.getAttribute('title') || ''} ${anchor.getAttribute('aria-label') || ''}`.replace(/\s+/g, ' ').trim();
        if (/^(?:next|previous|prev|sonraki|önceki|ileri|geri|\d{1,3}|read more|devamını oku|tümünü göster|all pages)$/i.test(label)) continue;
        seen.add(href); found.push({ url: href, label });
      } catch {}
    }
    return found;
  }
  function articleTopic(doc, config) {
    const selectors = [config.ARTICLE_TITLE_SELECTOR, 'h1', '.entry-title', 'article h2', 'title'].filter(Boolean);
    for (const selector of selectors) {
      try {
        const text = doc.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
        if (text) return text.slice(0, 240);
      } catch { /* saved/legacy selector may be malformed; fall back to common headings */ }
    }
    return '';
  }
  async function discoverDeepQueue(c, signal, status) {
    const warnings = [], blocked = [], categoryUrls = new Set(), articleMap = new Map();
    let currentUrl = location.href.split('#')[0];
    for (let i = 0; c.MAX_PAGES === 0 || i < c.MAX_PAGES; i++) {
      checkAbort(signal);
      if (categoryUrls.has(currentUrl)) break;
      let doc, actualUrl = currentUrl;
      if (i === 0) doc = document;
      else {
        try { const page = await fetchPage(currentUrl, c, signal); doc = page.doc; actualUrl = page.url.split('#')[0]; }
        catch (e) { if (isAbort(e)) throw e; warnings.push(`Kategori sayfası alınamadı: ${currentUrl} (${e.message})`); if (e.status === 403) blocked.push(currentUrl); break; }
      }
      if (categoryUrls.has(actualUrl)) break;
      categoryUrls.add(currentUrl); categoryUrls.add(actualUrl);
      status(`🗂️ Kategori sayfası ${i + 1}${c.MAX_PAGES ? `/${c.MAX_PAGES}` : ''} · içerik bağlantıları bulunuyor…`);
      try {
        for (const entry of discoverArticleLinks(doc, actualUrl, c, categoryUrls)) {
          if (!articleMap.has(entry.url)) articleMap.set(entry.url, entry);
          if (c.MAX_ARTICLES > 0 && articleMap.size >= c.MAX_ARTICLES) break;
        }
      } catch (e) { warnings.push(e.message); break; }
      if (c.MAX_ARTICLES > 0 && articleMap.size >= c.MAX_ARTICLES) break;
      const next = nextPage(doc, actualUrl, new Set(categoryUrls), c, i + 1);
      if (!next) {
        if (c.MAX_PAGES > 0 && i + 1 < c.MAX_PAGES) warnings.push(`Kategori sayfalaması ${i + 1}. sayfada durdu: uygun sonraki sayfa bağlantısı bulunamadı.`);
        break;
      }
      currentUrl = next;
    }
    const pageQueue = [], articleNextConfig = { ...c, PAGINATION_MODE: 'auto', NEXT_SELECTOR: c.ARTICLE_NEXT_SELECTOR || '' };
    const articles = [...articleMap.values()];
    for (let ai = 0; ai < articles.length; ai++) {
      checkAbort(signal);
      const article = articles[ai];
      status(`📚 İçerik ${ai + 1}/${articles.length} açılıyor…`);
      let current = article.url, topic = '', count = 0;
      const visited = new Set();
      while (current && (c.ARTICLE_MAX_PAGES === 0 || count < c.ARTICLE_MAX_PAGES)) {
        checkAbort(signal);
        if (visited.has(current)) break;
        let doc, actualUrl = current;
        try { const page = await fetchPage(current, c, signal); doc = page.doc; actualUrl = page.url.split('#')[0]; }
        catch (e) { if (isAbort(e)) throw e; warnings.push(`İçerik sayfası alınamadı: ${current} (${e.message})`); if (e.status === 403) blocked.push(current); break; }
        if (visited.has(actualUrl)) break;
        visited.add(current); visited.add(actualUrl);
        if (!topic) topic = articleTopic(doc, c) || article.label || new URL(article.url).pathname.split('/').filter(Boolean).pop() || article.url;
        pageQueue.push({ url: actualUrl, doc, reason: count === 0 ? `İçerik: ${topic}` : `İçerik alt sayfası ${count + 1}: ${topic}`, articleUrl: article.url, topic, articlePage: count + 1 });
        count++;
        const next = nextPage(doc, actualUrl, visited, articleNextConfig, count);
        if (!next) break;
        current = next;
      }
      if (c.ARTICLE_MAX_PAGES > 0 && count === c.ARTICLE_MAX_PAGES) warnings.push(`“${topic || article.url}” içeriği ${count} sayfalık sınırda durdu.`);
    }
    if (!articles.length) warnings.push('Kategori sayfalarında içerik bağlantısı bulunamadı. Gerekirse CSS bağlantı seçicisini ayarlayın.');
    return { pages: pageQueue, warnings, blocked, strictQueue: true, deep: true, categoryPages: categoryUrls.size, articles: articles.length };
  }
  function redactQueueUrl(value, reveal = false) {
    try {
      const url = new URL(value);
      if (!reveal && url.searchParams.size) return `${url.origin}${url.pathname}?…(${url.searchParams.size} parametre)`;
      return url.href;
    } catch { return reveal ? String(value) : 'Geçersiz URL'; }
  }
  function pageQueueReason(doc, currentUrl, targetUrl, config) {
    if (config.PAGINATION_MODE && config.PAGINATION_MODE !== 'auto') return `URL şablonu (${config.PAGINATION_MODE})`;
    const matches = node => { try { return new URL(node.getAttribute('href'), documentBase(doc, currentUrl)).href.split('#')[0] === targetUrl; } catch { return false; } };
    if (config.NEXT_SELECTOR) {
      try { if ([...doc.querySelectorAll(config.NEXT_SELECTOR)].some(node => matches(node.hasAttribute('href') ? node : node.querySelector('a[href]')))) return 'Kullanıcı CSS seçicisi'; } catch {}
    }
    try { if ([...doc.querySelectorAll('link[rel~="next"][href], a[rel~="next"][href]')].some(matches)) return 'rel=next'; } catch {}
    try {
      const link = [...doc.querySelectorAll('a[href]')].find(matches);
      if (link) {
        const label = `${link.textContent || ''} ${link.getAttribute('aria-label') || ''} ${link.getAttribute('title') || ''}`.trim();
        if (/(?:\bnext\b|sonraki|\bileri\b|›|»|→|older posts?)/i.test(label)) return 'Sonraki/ileri bağlantısı';
        if (/^\d{1,3}$/.test((link.textContent || '').trim())) return 'Sıradaki numaralı bağlantı';
      }
    } catch {}
    return 'Otomatik sayfalama sezgisi';
  }
  function previewPageQueue(plan, signal) {
    return new Promise(resolve => {
      const d = dialog('Taranacak sayfalar', `${plan.pages.length} sayfa bulundu; görseller henüz indirilmedi.`);
      const list = $el('div', { class: 'page-queue-list' });
      const warningCount = (plan.warnings || []).length;
      const status = $el('p', { class: 'muted' }, `Sorgu parametrelerinin değerleri varsayılan olarak gizlenir; bazı URL’ler imzalı/özel bilgi içerebilir.${warningCount ? ` Keşif sırasında ${warningCount} uyarı oluştu; ayrıntı URL’leri gizlendi.` : ''}${(plan.blocked || []).length ? ` Engellenen sayfa: ${(plan.blocked || []).length}.` : ''}`);
      const revealQuery = $el('input', { type: 'checkbox', 'aria-label': 'Tam sorgu parametrelerini göster' });
      const revealLabel = $el('label', { class: 'compact' }); revealLabel.append(revealQuery, $el('span', {}, 'Tam URL sorgu parametrelerini göster'));
      const queueItems = [...plan.pages], checks = [];
      const renderQueue = () => {
        list.replaceChildren(); checks.length = 0;
        for (const [i, item] of queueItems.entries()) {
          const row = $el('label', { class: 'page-queue-item' });
          const check = $el('input', { type: 'checkbox', checked: item.selected !== false, 'aria-label': `Sayfa ${i + 1} seç` });
          check.onchange = () => { item.selected = check.checked; };
          const info = $el('span'); info.append($el('span', {}, `${i + 1}. ${redactQueueUrl(item.url, revealQuery.checked)}`), $el('small', { class: 'muted' }, item.reason || 'Kullanıcı ekledi'));
          row.append(check, info); list.appendChild(row); checks.push(check);
        }
      };
      renderQueue(); revealQuery.onchange = renderQueue;
      const addRow = $el('div', { class: 'actions' });
      const addUrl = $el('input', { type: 'url', placeholder: 'Aynı siteden sayfa URL’si', 'aria-label': 'Kuyruğa eklenecek sayfa URL’si' });
      const addUrlButton = $el('button', { type: 'button', class: 'secondary' }, 'URL ekle');
      addRow.append(addUrl, addUrlButton);
      addUrlButton.onclick = () => {
        try {
          const parsed = new URL(addUrl.value.trim(), location.href); parsed.hash = '';
          if (parsed.username || parsed.password) throw new Error('URL içinde kullanıcı adı veya parola kullanılamaz.');
          if (parsed.origin !== location.origin || !['http:','https:'].includes(parsed.protocol)) throw new Error('Yalnızca aynı kaynaktan HTTP/HTTPS sayfaları eklenebilir.');
          if (queueItems.some(item => item.url === parsed.href)) throw new Error('Bu URL kuyrukta zaten var.');
          queueItems.push({ url: parsed.href, doc: null, reason: 'Kullanıcı ekledi', selected: true }); addUrl.value = ''; status.textContent = 'Sayfa kuyruğa eklendi; HTML tarama sırasında alınacak.'; renderQueue();
        } catch (e) { status.textContent = e.message; }
      };
      const selectActions = $el('div', { class: 'actions' });
      const all = $el('button', { type: 'button', class: 'secondary' }, 'Tümünü seç');
      const none = $el('button', { type: 'button', class: 'secondary' }, 'Tümünü kaldır');
      all.onclick = () => checks.forEach((x, i) => { x.checked = true; queueItems[i].selected = true; });
      none.onclick = () => checks.forEach((x, i) => { x.checked = false; queueItems[i].selected = false; });
      selectActions.append(all, none);
      const actions = $el('div', { class: 'actions' });
      const cancel = $el('button', { type: 'button', class: 'secondary' }, 'İptal');
      const start = $el('button', { type: 'button', class: 'primary' }, 'Seçilenleri tara');
      actions.append(cancel, start);
      d.box.append(status, revealLabel, addRow, list, selectActions, actions);
      let settled = false;
      const finish = value => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); d.closeDialog(); resolve(value); };
      const abort = () => finish(null);
      signal.addEventListener('abort', abort, { once: true });
      d.setOnClose(() => { if (!settled) { settled = true; signal.removeEventListener('abort', abort); resolve(null); } });
      cancel.onclick = () => finish(null);
      start.onclick = () => {
        const selected = queueItems.filter((_, i) => checks[i].checked);
        if (!selected.length) { status.textContent = 'En az bir sayfa seç.'; return; }
        finish(selected);
      };
    });
  }
  async function scan(c, signal, status, pagePlan = null, resumeState = null) {
    const priorPages = Array.isArray(resumeState?.pages) ? resumeState.pages : [];
    const pages = [...priorPages], images = Array.isArray(resumeState?.images) ? [...resumeState.images] : [];
    const visited = new Set(pages), seen = new Set(images.map(x => x.url));
    const duplicateRecords = new Map((Array.isArray(resumeState?.duplicates) ? resumeState.duplicates : []).filter(x => x && typeof x.url === 'string').map(x => [x.url, { url:x.url, count:Number.isSafeInteger(x.count) && x.count > 0 ? x.count : 1, firstPage:typeof x.firstPage === 'string' ? x.firstPage : '', pages:Array.isArray(x.pages) ? [...x.pages] : [] }]));
    let activeArticleMeta = null;
    const addDuplicate = (url, page) => {
      const original = images.find(item => item.url === url);
      if (original && activeArticleMeta?.articleUrl) {
        original.articleUrls = [...new Set([...(original.articleUrls || []), original.articleUrl, activeArticleMeta.articleUrl].filter(Boolean))];
        original.topics = [...new Set([...(original.topics || []), original.topic, activeArticleMeta.topic].filter(Boolean))];
      }
      let record = duplicateRecords.get(url);
      if (!record) { record = { url, count:0, firstPage:images.find(item => item.url === url)?.page || page || '', pages:[] }; duplicateRecords.set(url, record); }
      record.count++;
      if (page && !record.pages.includes(page)) record.pages.push(page);
    };
    const warnings = [...(resumeState?.warnings || []), ...(pagePlan?.warnings || [])];
    const blocked = [...(resumeState?.blocked || []), ...(pagePlan?.blocked || [])];
    const fingerprints = new Map(resumeState?.fingerprints || []);
    let queue = pagePlan?.pages ? [...pagePlan.pages] : null;
    let queueIndex = 0;
    const strictQueue = pagePlan?.strictQueue ?? resumeState?.strictQueue ?? false;
    if (!queue && resumeState?.strictQueue) queue = (resumeState.queueRemaining || []).map(item => typeof item === 'string' ? ({ url:item, doc:null }) : ({ ...item, doc:null }));
    let currentUrl = resumeState?.nextUrl || queue?.[0]?.url || location.href.split('#')[0];
    let stoppedByDuplicate = false;
    const saveProgress = nextUrl => {
      if (!c.SAVE_SCAN_PROGRESS) { deleteKey(SCAN_STATE_KEY); return; }
      if (!nextUrl) { deleteKey(SCAN_STATE_KEY); return; }
      const state = { version: 1, origin: location.origin, savedAt: Date.now(), nextUrl, strictQueue, deep: !!pagePlan?.deep || !!resumeState?.deep,
        queueRemaining: strictQueue && queue ? queue.slice(queueIndex).map(x => typeof x === 'string' ? x : ({ url:x.url, reason:x.reason, articleUrl:x.articleUrl, topic:x.topic, articlePage:x.articlePage })) : [],
        pages, images, duplicates:[...duplicateRecords.values()], warnings, blocked, fingerprints: [...fingerprints] };
      const serialized = JSON.stringify(state);
      if (serialized.length * 2 > 2 * 1024 * 1024) {
        deleteKey(SCAN_STATE_KEY);
        warnings.push('Tarama ilerleme kaydı 2 MB uygulama sınırını aştı; tarama sürüyor ancak kaldığı yer kaydedilmedi.');
        return;
      }
      try { GM_setValue(SCAN_STATE_KEY, serialized); }
      catch (e) { deleteKey(SCAN_STATE_KEY); warnings.push(`Tarama ilerlemesi kaydedilemedi: ${e.message}`); }
    };
    // Deep-crawl page plans already apply MAX_PAGES to category discovery;
    // their selected article pages are counted separately.
    const scanPageBudget = strictQueue ? Infinity : (c.MAX_PAGES === 0 ? Infinity : c.MAX_PAGES);
    while (pages.length - priorPages.length < scanPageBudget) {
      checkAbort(signal);
      let doc, actualUrl = currentUrl, queueEntry = null;
      if (queue && queueIndex < queue.length) {
        const queued = queue[queueIndex++]; queueEntry = typeof queued === 'string' ? { url:queued } : queued; actualUrl = queueEntry.url; currentUrl = actualUrl;
        if (queueEntry.doc) doc = queueEntry.doc;
        else {
          try { const page = await fetchPage(actualUrl, c, signal); doc = page.doc; actualUrl = page.url.split('#')[0]; }
          catch (e) { if (isAbort(e)) throw e; warnings.push(`Sayfa alınamadı: ${actualUrl} (${e.message})`); if (e.status === 403) blocked.push(actualUrl); if (strictQueue && c.SAVE_SCAN_PROGRESS) { queueIndex--; saveProgress(actualUrl); break; } if (strictQueue) continue; saveProgress(currentUrl); break; }
        }
      } else {
        if (strictQueue) { saveProgress(null); break; }
        queue = null;
        if (!currentUrl || visited.has(currentUrl)) { saveProgress(null); break; }
        if (!pages.length && currentUrl === location.href.split('#')[0]) doc = document;
        else {
          try { const page = await fetchPage(currentUrl, c, signal); doc = page.doc; actualUrl = page.url.split('#')[0]; }
          catch (e) { if (isAbort(e)) throw e; warnings.push(`Sayfa alınamadı: ${currentUrl} (${e.message})`); if (e.status === 403) blocked.push(currentUrl); saveProgress(null); break; }
        }
      }
      if (visited.has(actualUrl)) { warnings.push(`Sayfalama durdu: yönlendirme daha önce taranan bir sayfaya dönüyor (${actualUrl}).`); saveProgress(null); break; }
      visited.add(currentUrl); visited.add(actualUrl);
      status(`📄 Sayfa ${pages.length + 1} taranıyor…`);
      activeArticleMeta = queueEntry?.articleUrl ? { articleUrl:queueEntry.articleUrl, topic:queueEntry.topic || '' } : null;
      const pageSeen = new Set(), pageImageNodes = new WeakMap(), pageImages = collect(doc, actualUrl, c, pageSeen, pageImageNodes, addDuplicate);
      if (activeArticleMeta) for (const image of pageImages) { image.articleUrl = activeArticleMeta.articleUrl; image.articleUrls = [activeArticleMeta.articleUrl]; image.topic = activeArticleMeta.topic; image.topics = activeArticleMeta.topic ? [activeArticleMeta.topic] : []; }
      if (doc === document && c.DYNAMIC_SCROLL) {
        const sx = window.scrollX, sy = window.scrollY;
        try {
          const infinite = c.DYNAMIC_STEPS === 0, maxIdleAtBottom = 3;
          let step = 0, idleAtBottom = 0;
          const metrics = () => {
            const body = document.body, root = document.documentElement;
            return {
              height: Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0),
              images: document.images?.length || 0,
              elements: body?.getElementsByTagName('*').length || 0,
              text: body?.textContent?.length || 0,
            };
          };
          while (infinite ? idleAtBottom < maxIdleAtBottom : step < c.DYNAMIC_STEPS) {
            checkAbort(signal);
            status(infinite ? `↕ Dinamik tarama ${step + 1} · yeni içerik izleniyor…` : `↕ Dinamik tarama ${step + 1}/${c.DYNAMIC_STEPS}`);
            const before = metrics(), beforeUniqueImages = pageSeen.size;
            window.scrollBy(0, Math.max(300, window.innerHeight * 0.8));
            await new Promise(resolve => setTimeout(resolve, 750)); checkAbort(signal);
            pageImages.push(...collect(doc, actualUrl, c, pageSeen, pageImageNodes, addDuplicate));
            const after = metrics();
            const contentGrew = pageSeen.size > beforeUniqueImages || after.height > before.height || after.images > before.images || after.elements > before.elements || after.text > before.text;
            const atBottom = window.scrollY + window.innerHeight >= after.height - Math.max(24, window.innerHeight * 0.08);
            if (infinite) {
              if (contentGrew) idleAtBottom = 0;
              else if (atBottom) idleAtBottom++;
              else idleAtBottom = 0;
            }
            step++;
          }
        } finally { window.scrollTo(sx, sy); }
      }
      const fingerprint = c.STOP_DUPLICATE_PAGES ? pageFingerprint(doc, pageImages) : null;
      const fingerprintKey = fingerprint && queueEntry?.articleUrl ? `${queueEntry.articleUrl}\n${fingerprint}` : fingerprint;
      if (fingerprintKey && fingerprints.has(fingerprintKey)) {
        warnings.push(`Sayfalama durdu: ${actualUrl} önceki sayfayla (${fingerprints.get(fingerprintKey)}) aynı metin ve görselleri döndürdü. URL şablonu bu siteye uymuyor olabilir; yinelenen sayfa sayılmadı.`);
        if (queueEntry?.articleUrl && strictQueue) {
          const duplicateArticle = queueEntry.articleUrl;
          while (queueIndex < queue.length && queue[queueIndex]?.articleUrl === duplicateArticle) queueIndex++;
          const following = queue[queueIndex];
          currentUrl = following?.url || null; saveProgress(currentUrl);
          if (!currentUrl) break;
          continue;
        }
        stoppedByDuplicate = true; saveProgress(null); break;
      }
      if (fingerprintKey) fingerprints.set(fingerprintKey, actualUrl);
      pages.push(actualUrl);
      for (const image of pageImages) {
        if (!seen.has(image.url)) { seen.add(image.url); images.push(image); }
        else addDuplicate(image.url, actualUrl);
      }
      let nextUrl = null;
      if (queue && queueIndex < queue.length) nextUrl = queue[queueIndex].url;
      else if (!strictQueue) nextUrl = nextPage(doc, actualUrl, visited, c, pages.length);
      if (!nextUrl && !strictQueue && c.MAX_PAGES > 0 && pages.length < c.MAX_PAGES) warnings.push(`Sayfalama ${pages.length}. sayfada durdu: uygun, ziyaret edilmemiş aynı kaynaklı sonraki sayfa bağlantısı bulunamadı. Maksimum sayfa hedef değil, üst sınırdır.`);
      currentUrl = nextUrl;
      saveProgress(nextUrl);
      if (!nextUrl) break;
    }
    if (!c.SAVE_SCAN_PROGRESS || stoppedByDuplicate) deleteKey(SCAN_STATE_KEY);
    if (c.CHECK_REAL_SIZE) {
      await pool(images, c.ZIP_CONCURRENT, async img => {
        if (!img.width || !img.height) {
          const size = await measure(img.url, c.TIMEOUT_MS, signal);
          img.width = size.w; img.height = size.h;
        }
      }, (done, total) => status(`📐 Boyutlar kontrol ediliyor: ${done}/${total}`), signal);
    }
    return { images: images.filter(img => passesSize(img, c)), duplicates:[...duplicateRecords.values()], pages, warnings, blocked };
  }
  let scanController = null, forceResumeScan = false;
  scanButton.onclick = async () => {
    if (scanController) { scanController.abort(); return; }
    const c = loadConfig(); scanController = new AbortController();
    settingsButton.disabled = true;
    scanButton.textContent = '⏳ Taranıyor… (iptal için tıkla)';
    try {
      const status = text => {
        const memory = window.performance?.memory, used = Number(memory?.usedJSHeapSize), limit = Number(memory?.jsHeapSizeLimit);
        const heapText = Number.isFinite(used) && used > 0 && Number.isFinite(limit) && limit > 0 ? ` · heap ~${formatBytes(used)}/${formatBytes(limit)}` : '';
        scanButton.textContent = `${text}${heapText} (iptal)`;
      };
      let result;
      const forceResume = forceResumeScan; forceResumeScan = false;
      const savedScan = readJSON(SCAN_STATE_KEY, null);
      let resume = null;
      if (savedScan?.nextUrl && savedScan.origin === location.origin && (c.SAVE_SCAN_PROGRESS || forceResume)) {
        if (forceResume || confirm(`Yarım kalan tarama (${savedScan.pages?.length || 0} sayfa) kaldığı yerden sürdürülsün mü?`)) { resume = savedScan; c.SAVE_SCAN_PROGRESS = true; }
        else if (confirm('Yarım kalan tarama kaydı silinsin mi?')) deleteKey(SCAN_STATE_KEY);
      } else if (!c.SAVE_SCAN_PROGRESS) deleteKey(SCAN_STATE_KEY);
      if (resume?.strictQueue) {
        let plan = { pages: (resume.queueRemaining || []).map(item => typeof item === 'string' ? ({ url:item, doc:null, reason:'Kaldığı yerden devam' }) : ({ ...item, doc:null, reason:item.reason || 'Kaldığı yerden devam' })), warnings: [], blocked: [], strictQueue: true, deep: !!resume.deep };
        if (c.PREVIEW_PAGE_QUEUE && plan.pages.length) {
          const selectedPages = await previewPageQueue(plan, scanController.signal);
          if (!selectedPages) return;
          plan = { ...plan, pages: selectedPages };
        }
        result = await scan(c, scanController.signal, status, plan, resume);
      } else if (resume) result = await scan(c, scanController.signal, status, null, resume);
      else if (c.DEEP_CRAWL) {
        let plan = await discoverDeepQueue(c, scanController.signal, status);
        if (c.PREVIEW_PAGE_QUEUE && plan.pages.length) {
          const selectedPages = await previewPageQueue(plan, scanController.signal);
          if (!selectedPages) return;
          plan = { ...plan, pages:selectedPages, strictQueue:true };
        }
        result = await scan(c, scanController.signal, status, plan);
      } else if (c.PREVIEW_PAGE_QUEUE) {
        const plan = await discoverPageQueue(c, scanController.signal, status);
        const selectedPages = await previewPageQueue(plan, scanController.signal);
        if (!selectedPages) return;
        result = await scan(c, scanController.signal, status, { ...plan, pages: selectedPages, strictQueue: true });
      } else result = await scan(c, scanController.signal, status);
      showResults(result, c);
    } catch (e) { if (!isAbort(e)) { console.error('[Image Scraper]', e); alert('Tarama hatası: ' + e.message); } }
    finally { scanController = null; settingsButton.disabled = false; scanButton.textContent = '🖼️ Resimleri Topla'; }
  };

  const createImageAnalysisModule = global.ImageScraperModules?.createImageAnalysisModule;
  if (typeof createImageAnalysisModule !== 'function') throw new Error('Görsel analiz modülü yüklenemedi. Loader @require sırasını kontrol et.');
  const { imageFormat, perceptualHash, hashDistance } = createImageAnalysisModule({ document, Blob, createImageBitmapImpl: global.createImageBitmap?.bind(global) });
  async function copyText(text) {
    if (typeof GM_setClipboard === 'function') { GM_setClipboard(text, 'text'); return; }
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return; }
    throw new Error('Pano erişimi yok. Metni elle seçip kopyalayın.');
  }
  // decodeURI, bir adresi kullanıcıya daha okunur göstermek içindir; dosyayı
  // indirmede ve tekilleştirmede her zaman orijinal URL kullanılır.
  function displayUrl(url, config) {
    if (!config.DECODE_URL) return url;
    try { return decodeURI(url); } catch { return url; }
  }
  function buildDiagnosticSummary(result, config, images) {
    const warningKinds = {};
    for (const warning of result.warnings || []) {
      const kind = /cloudflare|challenge|403/i.test(warning) ? 'challenge_or_403' : /404|bulunamadı|not found/i.test(warning) ? 'not_found' : /timeout|zaman aşımı/i.test(warning) ? 'timeout' : /yinelenen|aynı metin/i.test(warning) ? 'duplicate_page' : 'other';
      warningKinds[kind] = (warningKinds[kind] || 0) + 1;
    }
    const statuses = {}, imageErrorKinds = {};
    const classifyError = message => /403|cloudflare|challenge/i.test(message) ? 'challenge_or_403' : /404|not found|bulunamadı/i.test(message) ? 'not_found' : /429|rate.?limit/i.test(message) ? 'rate_limited' : /5\d\d/.test(message) ? 'server_error' : /timeout|timed out|zaman aşımı/i.test(message) ? 'timeout' : /network|ağ hatası|failed to fetch|connection reset/i.test(message) ? 'network_error' : /format|image|resim/i.test(message) ? 'invalid_image' : 'other';
    for (const image of images || []) {
      statuses[image.status || 'unknown'] = (statuses[image.status || 'unknown'] || 0) + 1;
      if (image.error) { const kind = classifyError(image.error); imageErrorKinds[kind] = (imageErrorKinds[kind] || 0) + 1; }
    }
    return {
      format: 'image-scraper-diagnostics', schemaVersion: 1, scriptVersion: '6.5.6', generatedAt: new Date().toISOString(),
      settings: { paginationMode: config.PAGINATION_MODE || 'auto', pageLimit: config.MAX_PAGES, duplicatePageProtection: !!config.STOP_DUPLICATE_PAGES, imageSourceMode: config.IMAGE_SOURCE_MODE || 'any', pageQueuePreview: !!config.PREVIEW_PAGE_QUEUE, scanProgressOptIn: !!config.SAVE_SCAN_PROGRESS, visualSimilarityGrouping: !!config.GROUP_VISUAL_SIMILARITY, streamZipToDiskOptIn: !!config.STREAM_ZIP_TO_DISK },
      counts: { scannedPages: (result.pages || []).length, discoveredImages: (images || []).length, blockedPages: (result.blocked || []).length, imageStatuses: statuses, warningKinds, imageErrorKinds },
      privacy: { rawUrlsIncluded: false, hostnamesIncluded: false, cookiesIncluded: false, imageDataIncluded: false },
    };
  }
  const createResultsUI = global.ImageScraperModules?.createResultsUI;
  if (typeof createResultsUI !== 'function') throw new Error('Sonuç arayüzü modülü yüklenemedi. Loader @require sırasını kontrol et.');
  const showResults = createResultsUI({ $el, dialog, section, ui, readJSON, deleteKey, DEFAULTS, SESSION_KEY, CACHE_KEY, CACHE_CAP, GM_getValue, GM_setValue,
    formatBytes, etaSeconds, formatEta, encodeData, decodeData, adaptivePool, copyText, displayUrl, buildDiagnosticSummary,
    safeBaseName, zipName, zipEntryName, createUniqueZipFile, saveBlob, generateZipToWritable, generateZipBlob,
    downloadImageRetry, imageFormat, perceptualHash, hashDistance, smartFitMode, checkAbort, isAbort, location, document, window,
    navigator, URL, Blob, AbortController, TextEncoder, crypto: global.crypto });

    }
  };
})(globalThis);
