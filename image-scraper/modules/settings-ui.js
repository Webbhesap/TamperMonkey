/* Settings view module: static structure is in panel.html; this module binds data and actions. */
(function (global) {
  const modules = global.ImageScraperModules || (global.ImageScraperModules = Object.create(null));
  modules.createSettingsUI = function createSettingsUI(deps) {
    // Bağımlılık sözleşmesi: eksik bağımlılık ilk kullanımda değil, modül
    // kurulurken anlaşılır bir hatayla bildirilir (geç ReferenceError yerine).
    const requireDeps = (label, names) => {
      const missing = names.filter(name => deps?.[name] === undefined);
      if (missing.length) throw new Error(`${label} modülü için eksik bağımlılık: ${missing.join(', ')}`);
    };
    requireDeps('Ayarlar', ['loadConfig', 'saveConfig', 'dialog', 'cloneTemplate', 'readJSON', '$el', 'saveBlob', 'KEY', 'DEFAULTS', 'EXCLUDED_SITES_KEY', 'readExcludedSites', 'GM_getValue', 'GM_setValue', 'location', 'showStorageManager']);
    const { loadConfig, saveConfig, dialog, cloneTemplate, readJSON, $el, saveBlob, KEY, DEFAULTS, EXCLUDED_SITES_KEY,
      readExcludedSites, normalizeExcludedSite, isExcludedHost, GM_getValue, GM_setValue, location, document,
      showStorageManager } = deps;
      return function showSettings(initialTab = 'general') {
      const c = loadConfig();
      const d = dialog('Ayarlar', 'Düzenli kategoriler halinde ayarları yönet');
      d.box.classList.add('settings-dialog');
      const settingsNav = cloneTemplate('isp-settings-navigation-template').querySelector('.settings-navigation');
      const q = name => settingsNav.querySelector(`[data-control="${name}"]`);
      const action = name => settingsNav.querySelector(`[data-action="${name}"]`);
      const settingsTabs = settingsNav.querySelector('.settings-tabs');
      const tabButtons = new Map([...settingsTabs.querySelectorAll('[data-tab-key]')].map(tab => [tab.dataset.tabKey, tab]));
      const settingsPanes = new Map([...settingsNav.querySelectorAll('[role="tabpanel"]')].map(pane => [pane.id.replace(/^isp-/, '').replace(/-panel$/, ''), pane]));
      // Yalnızca 'records' paneli doğrudan kullanılır; diğerlerine selectSettingsTab
      // üzerinden erişilir. Kullanılmayan bağlamalar kaldırıldı.
      const recordsPane = settingsPanes.get('records');
      d.box.appendChild(settingsNav);
      const selectSettingsTab = name => {
        const selected = name === 'settings' ? 'general' : (settingsPanes.has(name) ? name : 'general');
        const state = globalThis.Alpine?.$data?.(settingsNav);
        if (state) state.active = selected;
        else for (const [key, pane] of settingsPanes) {
          const active = key === selected; pane.hidden = !active;
          const tab = tabButtons.get(key); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
        }
        if (selected === 'records') showStorageManager(recordsPane);
        d.box.scrollTop = 0;
      };
      for (const [key, tab] of tabButtons) tab.onclick = () => selectSettingsTab(key);

      // ---------------------------------------------------------------------
      // Ayar arama: 30+ ayar 7 sekmeye dağılmış durumda. Kullanıcı sekme
      // sekme gezmek yerine yazarak arar; eşleşen ayarın sekmesine atlanır,
      // satır vurgulanır, eşleşmeyenler soluklaştırılır (gizlenmez; böylece
      // ayarın hangi bölümde olduğu bağlamı korunur).
      // ---------------------------------------------------------------------
      const searchInput = q('settingsSearch'), searchClear = action('settings-search-clear');
      const searchResult = q('settingsSearchResult');
      // Türkçe arama: kullanıcı "sablon" yazınca "şablon" da bulunmalı.
      // Aksan/özel harf katlama (normalize NFKD + birleşik işaret temizliği)
      // "ç/ğ/ı/ö/ş/ü" → "c/g/i/o/s/u" dönüşümünü sağlar.
      const fold = value => String(value ?? '')
        .replace(/[ıİ]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('tr');
      // Aranabilir etiket: satırın görünen metni + kontrolün name/placeholder
      // değeri (ör. data-control="filename" aramada "filename" ile de bulunur).
      const searchRows = [];
      for (const [key, pane] of settingsPanes) {
        if (!pane || key === 'records') continue;
        const section = () => pane.querySelector('.section h3')?.textContent || '';
        for (const node of pane.querySelectorAll('label, .actions, p.muted')) {
          if (node.closest('.settings-footer')) continue;
          const control = node.querySelector('input,select,textarea');
          const keys = [
            node.textContent || '',
            control?.dataset?.control || '',
            control?.placeholder || '',
            control?.getAttribute('aria-label') || '',
          ].join(' ');
          searchRows.push({ node, pane: key, section: section(), keys: fold(keys) });
        }
      }
      const clearSearch = () => {
        for (const row of searchRows) { row.node.removeAttribute('data-isp-search-dim'); row.node.removeAttribute('data-isp-search-hit'); }
        searchResult.hidden = true; searchResult.textContent = '';
        searchClear.hidden = true;
      };
      const runSearch = () => {
        const term = fold(searchInput.value.trim());
        if (!term) { clearSearch(); return; }
        searchClear.hidden = false;
        const hits = searchRows.filter(row => row.keys.includes(term));
        for (const row of searchRows) {
          const hit = hits.includes(row);
          row.node.toggleAttribute('data-isp-search-hit', hit);
          row.node.setAttribute('data-isp-search-dim', String(!hit));
        }
        if (!hits.length) {
          searchResult.hidden = false;
          searchResult.textContent = `“${searchInput.value.trim()}” ile eşleşen ayar yok.`;
          return;
        }
        // İlk eşleşmenin sekmesine geç ve satırı görünür alana getir.
        selectSettingsTab(hits[0].pane);
        // Paneller Alpine ile açıldığında ölçüm bir sonraki karede doğru olur.
        (window.requestAnimationFrame || (callback => setTimeout(callback, 16)))(() => {
          // NOT: scrollIntoView kullanılmaz — odak arama kutusundayken dialogun
          // kendisini de kaydırıp başlığı ekrandan çıkarıyordu. Kaydırma
          // yalnızca dialog gövdesi içinde yapılır (offset ile hesaplanır).
          const dialogScroll = d.box;
          const rowBox = hits[0].node.getBoundingClientRect();
          const dialogBox = dialogScroll.getBoundingClientRect();
          const delta = rowBox.top - dialogBox.top - dialogBox.height / 2 + rowBox.height / 2;
          try { dialogScroll.scrollBy({ top: delta, behavior: 'smooth' }); } catch { dialogScroll.scrollTop += delta; }
        });
        searchResult.hidden = false;
        searchResult.textContent = hits.length === 1
          ? `1 ayar bulundu: ${hits[0].section}`
          : `${hits.length} ayar bulundu. İlk eşleşme: ${hits[0].section}`;
      };
      searchInput.oninput = runSearch;
      searchInput.onkeydown = event => { if (event.key === 'Escape') { searchInput.value = ''; clearSearch(); event.stopPropagation(); } };
      searchClear.onclick = () => { searchInput.value = ''; clearSearch(); searchInput.focus(); };

      settingsTabs.onkeydown = e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const keys = [...tabButtons.keys()], current = keys.findIndex(key => tabButtons.get(key) === e.target);
        const next = keys[(current + (e.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length];
        selectSettingsTab(next); tabButtons.get(next).focus();
      };

      // Bind the static HTML controls to the existing settings model.
      // Form alanları tek bir yerden doldurulur; iş akışı profili uygulanınca
      // da aynı eşleme kullanıldığı için ekran ile ayarlar ayrışmaz.
      const configToControls = config => ({
        max: config.MAX_PAGES, pageMode: config.PAGINATION_MODE, customTpl: config.CUSTOM_PAGINATION_TEMPLATE || DEFAULTS.CUSTOM_PAGINATION_TEMPLATE,
        duplicatePages: config.STOP_DUPLICATE_PAGES, previewPages: config.PREVIEW_PAGE_QUEUE, saveScanProgress: config.SAVE_SCAN_PROGRESS, nextSelector: config.NEXT_SELECTOR,
        minw: config.MIN_WIDTH, minh: config.MIN_HEIGHT, real: config.CHECK_REAL_SIZE, unknown: config.EXCLUDE_UNKNOWN, dynamic: config.DYNAMIC_SCROLL, steps: config.DYNAMIC_STEPS, timeout: config.TIMEOUT_MS,
        useSel: config.USE_SELECTOR, selector: config.SELECTOR, skip: config.SKIP_PATTERNS, decode: config.DECODE_URL, useRep: config.USE_REPLACE,
        replacements: JSON.stringify(config.REPLACEMENTS, null, 2), sourceMode: config.IMAGE_SOURCE_MODE, sourceHosts: config.IMAGE_SOURCE_HOSTS,
        retryReferer: config.RETRY_REFERER, filename: config.ZIP_FILENAME, concurrent: config.ZIP_CONCURRENT, maxFiles: config.PART_MAX_FILES, maxMB: config.PART_MAX_MB,
        dedupe: config.DEDUPE_CONTENT, visualGroups: config.GROUP_VISUAL_SIMILARITY, streamZip: config.STREAM_ZIP_TO_DISK, verifyZip: config.VERIFY_ZIP, template: config.NAME_TEMPLATE,
        zipFolders: config.ZIP_FOLDERS || 'none', zipManifest: config.ZIP_MANIFEST,
        maxImages: config.MAX_IMAGES, maxTotalMB: config.MAX_TOTAL_MB,
        deepCrawl: config.DEEP_CRAWL, articleLinkSelector: config.ARTICLE_LINK_SELECTOR, articleTitleSelector: config.ARTICLE_TITLE_SELECTOR,
        articleNextSelector: config.ARTICLE_NEXT_SELECTOR, articleMaxPages: config.ARTICLE_MAX_PAGES, maxArticles: config.MAX_ARTICLES,
      });
      const syncControls = config => {
        for (const [name, value] of Object.entries(configToControls(config))) {
          const control = q(name);
          if (!control) continue;
          if (control.type === 'checkbox') control.checked = !!value;
          else control.value = String(value ?? '');
        }
      };
      syncControls(c);
      const max = q('max'), pageMode = q('pageMode'), customTpl = q('customTpl'), duplicatePages = q('duplicatePages');
      const previewPages = q('previewPages'), saveScanProgress = q('saveScanProgress'), nextSelector = q('nextSelector');
      const minw = q('minw'), minh = q('minh'), real = q('real'), unknown = q('unknown'), dynamic = q('dynamic');
      const steps = q('steps'), timeout = q('timeout'), useSel = q('useSel'), selector = q('selector'), skip = q('skip');
      const decode = q('decode'), useRep = q('useRep'), replacements = q('replacements'), sourceMode = q('sourceMode'), sourceHosts = q('sourceHosts');
      const retryReferer = q('retryReferer'), filename = q('filename'), concurrent = q('concurrent'), maxFiles = q('maxFiles'), maxMB = q('maxMB');
      const dedupe = q('dedupe'), visualGroups = q('visualGroups'), streamZip = q('streamZip'), verifyZip = q('verifyZip'), template = q('template');
      const zipFolders = q('zipFolders'), zipManifest = q('zipManifest'), maxImages = q('maxImages'), maxTotalMB = q('maxTotalMB');
      // Dosya adı şablonu önizlemesi: kaydetmeden önce örnek çıktıyı göster,
      // geçersiz karakterleri ve bilinmeyen değişkenleri uyar.
      const templatePreview = q('templatePreview');
      const renderTemplatePreview = () => {
        const raw = template.value.trim() || DEFAULTS.NAME_TEMPLATE;
        const allowed = new Set(['sira', 'sayfa', 'orijinal_ad', 'boyut']);
        const unknown = [...raw.matchAll(/\{([^}]+)\}/g)].map(m => m[1]).filter(k => !allowed.has(k));
        const sample = { sira: '001', sayfa: '1', orijinal_ad: 'ornek-gorsel', boyut: '1200x800' };
        // Betikteki ad üretimiyle aynı kurallar (zip.js safeBaseName/zipEntryName).
        const produced = raw.replace(/\{(sira|sayfa|orijinal_ad|boyut)\}/g, (_, k) => sample[k]);
        const unsafe = /[\\/<>:"|?*\x00-\x1f\x7f]/.test(produced);
        const cleaned = produced.replace(/[\\/<>:"|?*\x00-\x1f\x7f]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 150) || 'image';
        const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned);
        const problems = [];
        if (unknown.length) problems.push(`bilinmeyen değişken: ${[...new Set(unknown)].join(', ')} (yok sayılır)`);
        if (unsafe) problems.push('ad içinde geçersiz karakter var, "_" ile değiştirilir');
        if (reserved) problems.push('Windows ayrılmış adı, başına "_" eklenir');
        if (!/\{orijinal_ad\}/.test(raw)) problems.push('{orijinal_ad} yok: farklı görseller aynı adı alabilir, çakışma "_2" ile çözülür');
        if (!problems.length) {
          templatePreview.dataset.state = 'ok';
          templatePreview.textContent = `Örnek: ${cleaned}.png`;
        } else {
          templatePreview.dataset.state = 'warn';
          templatePreview.textContent = `Örnek: ${cleaned}.png\n⚠ ${problems.join(' · ')}`;
        }
        templatePreview.hidden = false;
      };
      template.addEventListener('input', renderTemplatePreview);
      renderTemplatePreview();
      const deepCrawl = q('deepCrawl'), articleLinkSelector = q('articleLinkSelector'), articleTitleSelector = q('articleTitleSelector');
      const articleNextSelector = q('articleNextSelector'), articleMaxPages = q('articleMaxPages'), maxArticles = q('maxArticles');
      const deepOnlyControls = [articleLinkSelector, articleTitleSelector, articleNextSelector, articleMaxPages, maxArticles];
      const syncDeepControls = () => deepOnlyControls.forEach(control => { control.disabled = !deepCrawl.checked; });
      deepCrawl.addEventListener('change', syncDeepControls); syncDeepControls();

      // ---------------------------------------------------------------------
      // İş akışı profilleri: tarama + görsel + ZIP ayarlarını birlikte
      // uygulayan adlandırılmış kombinasyonlar. Üç hazır profil var; kullanıcı
      // kayıtlı ayarlarını adlandırıp kendi profilini ekleyebilir.
      // Profiller site profillerinden ayrıdır ve genel ayarlara uygulanır.
      // ---------------------------------------------------------------------
      const WORKFLOW_KEY = 'isp_workflows_v1';
      const BUILTIN_WORKFLOWS = {
        'Hızlı tarama': { MAX_PAGES: 1, DYNAMIC_SCROLL: false, CHECK_REAL_SIZE: false, TIMEOUT_MS: 8000, ZIP_CONCURRENT: 2, PART_MAX_MB: 50 },
        'Düşük bellek': { ZIP_CONCURRENT: 1, PART_MAX_FILES: 100, PART_MAX_MB: 50, STREAM_ZIP_TO_DISK: false, VERIFY_ZIP: false, GROUP_VISUAL_SIMILARITY: false, ZIP_MANIFEST: false },
        'Yüksek çözünürlük': { MIN_WIDTH: 1200, MIN_HEIGHT: 800, CHECK_REAL_SIZE: true, MAX_PAGES: 5, PART_MAX_MB: 500, ZIP_CONCURRENT: 3 },
      };
      const workflowPreset = q('workflowPreset'), workflowName = q('workflowName'), workflowStatus = q('workflowStatus');
      const readWorkflows = () => {
        try {
          const raw = JSON.parse(GM_getValue(WORKFLOW_KEY, '{}') || '{}');
          return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        } catch { return {}; }
      };
      const workflowCatalogue = () => ({ ...BUILTIN_WORKFLOWS, ...readWorkflows() });
      const renderWorkflowOptions = () => {
        const previous = workflowPreset.value;
        workflowPreset.replaceChildren($el('option', { value: '' }, 'Profil seç…'));
        for (const name of Object.keys(BUILTIN_WORKFLOWS)) workflowPreset.appendChild($el('option', { value: name }, `${name} (hazır)`));
        for (const name of Object.keys(readWorkflows())) workflowPreset.appendChild($el('option', { value: name }, name));
        workflowPreset.value = [...workflowPreset.options].some(option => option.value === previous) ? previous : '';
      };
      renderWorkflowOptions();
      const applyWorkflow = () => {
        const name = workflowPreset.value;
        if (!name) { workflowStatus.textContent = 'Önce listeden bir profil seç.'; return; }
        const preset = workflowCatalogue()[name];
        if (!preset || typeof preset !== 'object') { workflowStatus.textContent = 'Profil bulunamadı.'; return; }
        const merged = { ...loadConfig(), ...preset };
        saveConfig(merged); syncControls(merged);
        const siteNote = hasSiteProfile ? ' Bu sitede etkin site profili olduğu için değerler site profili tarafından geçersiz kılınabilir.' : '';
        workflowStatus.textContent = `✅ "${name}" uygulandı · ${Object.keys(preset).length} ayar güncellendi.${siteNote}`;
      };
      const saveWorkflow = () => {
        const name = workflowName.value.trim();
        if (!name) { workflowStatus.textContent = 'Profil adı boş olamaz.'; return; }
        if (name.length > 40) { workflowStatus.textContent = 'Profil adı en fazla 40 karakter olabilir.'; return; }
        if (BUILTIN_WORKFLOWS[name]) { workflowStatus.textContent = 'Hazır profil adları kullanılamaz; başka bir ad seç.'; return; }
        const stored = readWorkflows();
        // Kayıtlı ayarlar profile alınır; formda kaydedilmemiş değişiklik varsa
        // önce "Kaydet" ile uygulanması gerekir.
        stored[name] = loadConfig();
        GM_setValue(WORKFLOW_KEY, JSON.stringify(stored));
        renderWorkflowOptions(); workflowPreset.value = name; workflowName.value = '';
        workflowStatus.textContent = `✅ "${name}" profili kaydedildi.`;
      };
      const deleteWorkflow = () => {
        const name = workflowPreset.value;
        if (!name) { workflowStatus.textContent = 'Silinecek profili seç.'; return; }
        if (BUILTIN_WORKFLOWS[name]) { workflowStatus.textContent = 'Hazır profiller silinemez.'; return; }
        const stored = readWorkflows();
        if (!stored[name]) { workflowStatus.textContent = 'Profil bulunamadı.'; return; }
        delete stored[name]; GM_setValue(WORKFLOW_KEY, JSON.stringify(stored));
        renderWorkflowOptions();
        workflowStatus.textContent = `🗑 "${name}" profili silindi.`;
      };
      action('workflow-apply').onclick = applyWorkflow;
      action('workflow-save').onclick = saveWorkflow;
      action('workflow-delete').onclick = deleteWorkflow;

      const activeProfiles = readJSON('isp_profiles_v1', {});
      const hasSiteProfile = !!(activeProfiles && activeProfiles[location.origin]);
      q('profile-active').hidden = !hasSiteProfile;
      q('profile-inactive').hidden = hasSiteProfile;
      action('profile-remove').hidden = !hasSiteProfile;
      action('profile-remove').onclick = () => {
        if (!confirm('Bu siteye özel profil silinsin mi?')) return;
        delete activeProfiles[location.origin]; GM_setValue('isp_profiles_v1', JSON.stringify(activeProfiles)); showSettings();
      };

      const excludedInput = q('excludedInput'), excludedStatus = q('excludedStatus'), excludedList = q('excludedList');
      const excludedAdd = action('excluded-add'), excludeCurrent = action('excluded-current');
      const renderExcludedSites = () => {
        excludedList.replaceChildren();
        const entries = readExcludedSites();
        if (!entries.length) { excludedList.appendChild($el('p', { class: 'muted' }, 'Hariç tutulan site yok.')); return; }
        for (const entry of entries) {
          const row = cloneTemplate('isp-excluded-site-row-template').querySelector('.actions');
          row.querySelector('[data-site-name]').textContent = `${entry} (alt alan adları dahil)`;
          row.querySelector('[data-action="remove-site"]').onclick = () => {
            const remaining = readExcludedSites().filter(x => x !== entry);
            GM_setValue(EXCLUDED_SITES_KEY, JSON.stringify(remaining)); renderExcludedSites();
            excludedStatus.textContent = 'Hariç tutma listesi güncellendi.';
          };
          excludedList.appendChild(row);
        }
      };
      const addExcludedSite = value => {
        const host = normalizeExcludedSite(value);
        if (!host) { excludedStatus.textContent = 'Geçerli bir alan adı veya URL gir (örn. example.com).'; return; }
        const entries = readExcludedSites();
        if (!entries.includes(host)) { entries.push(host); GM_setValue(EXCLUDED_SITES_KEY, JSON.stringify(entries)); }
        excludedInput.value = ''; renderExcludedSites();
        excludedStatus.textContent = isExcludedHost(location.hostname, [host])
          ? 'Site eklendi. Bu açık sekmede betik yenileme sonrası devre dışı kalacak; sayfayı yenile.'
          : 'Site hariç tutma listesine eklendi.';
      };
      excludedAdd.onclick = () => addExcludedSite(excludedInput.value);
      excludedInput.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addExcludedSite(excludedInput.value); } };
      excludeCurrent.onclick = () => addExcludedSite(location.hostname);
      renderExcludedSites();

      const backupFile = q('backupFile'), backupStatus = q('backupStatus');
      action('backup-export').onclick = () => {
        const payload = { format: 'image-scraper-settings', schemaVersion: 1, exportedAt: new Date().toISOString(), globalConfig: readJSON(KEY, DEFAULTS), profiles: readJSON('isp_profiles_v1', {}), excludedSites: readExcludedSites() };
        saveBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }), 'image-scraper-settings.json');
        backupStatus.textContent = 'Ayar yedeği indirildi. Bu dosya site profillerini içerir; paylaşmadan önce kontrol et.';
      };
      action('backup-import').onclick = () => backupFile.click();
      backupFile.onchange = async () => {
        try {
          const file = backupFile.files?.[0]; if (!file) return;
          const data = JSON.parse(await file.text());
          if (data?.format !== 'image-scraper-settings' || data.schemaVersion !== 1 || !data.globalConfig || typeof data.globalConfig !== 'object') throw new Error('Desteklenmeyen veya bozuk yedek biçimi.');
          if (!confirm('Genel ayarlar, site profilleri ve hariç tutma listesi bu yedekten değiştirilsin mi? Oturum ve görsel verileri etkilenmez.')) return;
          const pickConfig = value => Object.fromEntries(Object.keys(DEFAULTS).filter(key => Object.prototype.hasOwnProperty.call(value || {}, key)).map(key => [key, value[key]]));
          const profiles = {};
          for (const [origin, value] of Object.entries(data.profiles || {})) {
            try { const parsed = new URL(origin); if (['http:','https:'].includes(parsed.protocol) && parsed.origin === origin) profiles[origin] = pickConfig(value); } catch {}
          }
          const excluded = [...new Set((Array.isArray(data.excludedSites) ? data.excludedSites : []).map(normalizeExcludedSite).filter(Boolean))];
          GM_setValue(KEY, JSON.stringify(pickConfig(data.globalConfig)));
          GM_setValue('isp_profiles_v1', JSON.stringify(profiles));
          GM_setValue(EXCLUDED_SITES_KEY, JSON.stringify(excluded));
          backupStatus.textContent = 'Yedek yüklendi. Ayarların uygulanması için bu sayfayı yenile.';
          renderExcludedSites();
        } catch (e) { backupStatus.textContent = 'Yedek yüklenemedi: ' + e.message; }
        finally { backupFile.value = ''; }
      };

      const error = q('settingsError'), reset = action('settings-reset'), save = action('settings-save'), siteSave = action('settings-site-save');
      siteSave.textContent = hasSiteProfile ? '🌍 Genel ayarlara kaydet' : '🌐 Bu siteye kaydet';
      reset.onclick = () => {
        try {
          if (!confirm('Genel ayarlar varsayılana dönsün ve bu site profili silinsin mi?')) return;
          const profiles = readJSON('isp_profiles_v1', {}); delete profiles[location.origin];
          GM_setValue('isp_profiles_v1', JSON.stringify(profiles)); saveConfig(DEFAULTS); showSettings();
        } catch (e) { error.textContent = 'Ayarlar kaydedilemedi: ' + e.message; }
      };
      let saveForSite = hasSiteProfile;
      siteSave.onclick = () => { saveForSite = !hasSiteProfile; save.onclick(); };
      save.onclick = () => {
        try {
          const num = (input, label, lo, hi) => {
            if (input.value.trim() === '') throw new Error(label + ' boş olamaz.');
            const n = Number(input.value);
            if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${label}: ${lo}–${hi} arasında bir tam sayı girin.`);
            return n;
          };
          const rules = JSON.parse(replacements.value);
          if (!Array.isArray(rules) || !rules.every(r => r && typeof r.from === 'string' && r.from.length && typeof r.to === 'string')) throw new Error('Kurallar, boş olmayan from ve metin to içeren nesnelerden oluşan bir dizi olmalı.');
          if (skip.value) new RegExp(skip.value, 'i');
          const nextSel = nextSelector.value.trim(); if (nextSel) document.querySelector(nextSel);
          const sel = selector.value.trim();
          if (useSel.checked) { if (!sel) throw new Error('CSS seçici boş olamaz.'); document.querySelector(sel); }
          const articleLinkSel = articleLinkSelector.value.trim();
          const articleTitleSel = articleTitleSelector.value.trim();
          const articleNextSel = articleNextSelector.value.trim();
          if (deepCrawl.checked) {
            if (articleLinkSel) document.querySelector(articleLinkSel);
            if (articleTitleSel) document.querySelector(articleTitleSel);
            if (articleNextSel) document.querySelector(articleNextSel);
          }
          const deepLimit = (input, label, lo, hi, current) => {
            if (deepCrawl.checked) return num(input, label, lo, hi);
            const raw = input.value.trim(), value = Number(raw);
            return raw && Number.isInteger(value) && value >= lo && value <= hi ? value : current;
          };
          const config = {
            MAX_PAGES: num(max, 'Maksimum sayfa', 0, 50), NEXT_SELECTOR: nextSel, PAGINATION_MODE: pageMode.value, CUSTOM_PAGINATION_TEMPLATE: customTpl.value.trim() || DEFAULTS.CUSTOM_PAGINATION_TEMPLATE, STOP_DUPLICATE_PAGES: duplicatePages.checked, PREVIEW_PAGE_QUEUE: previewPages.checked, SAVE_SCAN_PROGRESS: saveScanProgress.checked, IMAGE_SOURCE_MODE: sourceMode.value, IMAGE_SOURCE_HOSTS: sourceHosts.value.trim(), MIN_WIDTH: num(minw, 'Min. genişlik', 0, 100000),
            MIN_HEIGHT: num(minh, 'Min. yükseklik', 0, 100000), CHECK_REAL_SIZE: real.checked,
            TIMEOUT_MS: num(timeout, 'Zaman aşımı', 1000, 120000), USE_SELECTOR: useSel.checked,
            SELECTOR: sel || DEFAULTS.SELECTOR, SKIP_PATTERNS: skip.value.trim(), DECODE_URL: decode.checked, RETRY_REFERER: retryReferer.checked, USE_REPLACE: useRep.checked,
            REPLACEMENTS: rules, ZIP_FILENAME: filename.value.trim() || DEFAULTS.ZIP_FILENAME,
            ZIP_CONCURRENT: num(concurrent, 'Paralel işlem', 1, 10), EXCLUDE_UNKNOWN: unknown.checked,
            DYNAMIC_SCROLL: dynamic.checked, DYNAMIC_STEPS: num(steps, 'Dinamik adım', 0, Number.MAX_SAFE_INTEGER),
            PART_MAX_FILES: num(maxFiles, 'Parça dosya sınırı', 1, 10000), PART_MAX_MB: num(maxMB, 'Parça MB sınırı', 1, 2000),
            DEDUPE_CONTENT: dedupe.checked, GROUP_VISUAL_SIMILARITY: visualGroups.checked, STREAM_ZIP_TO_DISK: streamZip.checked, VERIFY_ZIP: verifyZip.checked, NAME_TEMPLATE: template.value.trim() || DEFAULTS.NAME_TEMPLATE,
            ZIP_FOLDERS: ['none','host','page'].includes(zipFolders.value) ? zipFolders.value : 'none', ZIP_MANIFEST: zipManifest.checked,
            MAX_IMAGES: num(maxImages, 'En fazla görsel', 0, 100000), MAX_TOTAL_MB: num(maxTotalMB, 'En fazla toplam boyut', 0, 100000),
            DEEP_CRAWL: deepCrawl.checked, ARTICLE_LINK_SELECTOR: articleLinkSel, ARTICLE_TITLE_SELECTOR: articleTitleSel || DEFAULTS.ARTICLE_TITLE_SELECTOR,
            ARTICLE_NEXT_SELECTOR: articleNextSel, ARTICLE_MAX_PAGES: deepLimit(articleMaxPages, 'İçerik sayfa sınırı', 0, 10000, c.ARTICLE_MAX_PAGES), MAX_ARTICLES: deepLimit(maxArticles, 'İçerik bağlantısı sınırı', 0, 100000, c.MAX_ARTICLES),
          };
          if (saveForSite) {
            let profiles = JSON.parse(GM_getValue('isp_profiles_v1', '{}') || '{}');
            profiles[location.origin] = config; GM_setValue('isp_profiles_v1', JSON.stringify(profiles));
          } else saveConfig(config);
          d.closeDialog();
        } catch (e) { error.textContent = '❌ ' + e.message; } finally { saveForSite = hasSiteProfile; }
      };
      if (globalThis.Alpine?.initTree) globalThis.Alpine.initTree(settingsNav);
      selectSettingsTab(initialTab);
    }
  };
})(globalThis);
