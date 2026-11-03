/* Results, gallery, reports, slideshow, and ZIP UI module. */
(function (global) {
  const modules = global.ImageScraperModules || (global.ImageScraperModules = Object.create(null));
  modules.createResultsUI = function createResultsUI(deps) {
    const { $el, dialog, section, ui, readJSON, deleteKey, DEFAULTS, SESSION_KEY, CACHE_KEY, CACHE_CAP, GM_getValue, GM_setValue,
      formatBytes, etaSeconds, formatEta, encodeData, decodeData, adaptivePool, copyText, displayUrl, buildDiagnosticSummary,
      safeBaseName, zipName, zipEntryName, createUniqueZipFile, saveBlob, generateZipToWritable, generateZipBlob, verifyZipBytes,
      downloadImageRetry, imageFormat, perceptualHash, hashDistance, smartFitMode, checkAbort, isAbort, location, document, window,
      URL, Blob, AbortController, TextEncoder, crypto } = deps;
    if (typeof smartFitMode !== 'function') throw new Error('Slayt gösterisi akıllı sığdırma işlevi bağlanamadı.');
    /**
     * Bağlantı adresini güvenli protokollerle sınırlar. Tarama sırasında toplanan
     * adresler sayfadan gelir; `javascript:` veya `data:` gibi bir adresin
     * tıklanabilir bağlantıya dönüşmesi kod çalıştırmaya yol açabilir.
     * Geçersiz adresler tıklanamaz bir yer tutucuya dönüşür.
     */
    const safeHref = value => {
      try {
        const parsed = new URL(String(value || ''), location.href);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        // Kimlik bilgisi içeren adresler kullanıcıya yanlış kaynak gösterir.
        if (parsed.username || parsed.password) return null;
        return parsed.href;
      } catch { return null; }
    };
    /** Güvenli değilse bağlantıyı düz metne çevirir; hiçbir zaman atlanmaz. */
    const linkOrText = (attributes, text) => {
      const href = safeHref(attributes.href);
      if (!href) return $el('span', { title: String(attributes.href || '') }, text);
      return $el('a', { ...attributes, href }, text);
    };
    return function showResults(result, c, restored = null) {
      const images = result.images.map(img => ({ ...img, displayWidth: img.displayWidth || 0, displayHeight: img.displayHeight || 0, selected: img.selected !== false, status: img.status || 'bekliyor' }));
      const duplicateRecords = Array.isArray(result.duplicates) ? result.duplicates.filter(x => x && typeof x.url === 'string' && Number.isSafeInteger(x.count) && x.count > 0) : [];
      const duplicateOccurrenceCount = duplicateRecords.reduce((sum, x) => sum + x.count, 0);
      const contentDuplicatePairs = Array.isArray(result.contentDuplicates) ? [...result.contentDuplicates] : Array.isArray(restored?.contentDuplicates) ? [...restored.contentDuplicates] : [];
      const pages = result.pages || [], warnings = result.warnings || [], blockedPages = result.blocked || [];
      const d = dialog('Tarama sonuçları', '');
      d.box.classList.add('fullscreen'); d.subtitle.classList.add('result-summary');
      const tabs = $el('div', { class: 'result-tabs', role: 'tablist', 'aria-label': 'Sonuç bölümleri' });
      const workspace = $el('div', { class: 'result-workspace' });
      const galleryPane = $el('div', { class: 'result-pane', role: 'tabpanel', id: 'isp-pane-gallery' });
      const linksPane = $el('div', { class: 'result-pane', role: 'tabpanel', id: 'isp-pane-links', hidden: true });
      const downloadPane = $el('div', { class: 'result-pane', role: 'tabpanel', id: 'isp-pane-download', hidden: true });
      const sessionPane = $el('div', { class: 'result-pane', role: 'tabpanel', id: 'isp-pane-session', hidden: true });
      const tabDefs = [[galleryPane, 'Galeri'], [linksPane, 'Bağlantılar'], [downloadPane, 'ZIP ve indirme'], [sessionPane, 'Oturum']];
      const tabButtons = [];
      // Kurulum tamamlanmadan activateTab çağrılırsa sekmeler hazır
      // olmayabilir; bu bayrak yalnızca güvenli çağrı noktasına izin verir.
      let tabsReady = false;
      const activateTab = index => {
        if (!tabsReady) return;
        tabDefs.forEach(([pane], i) => { pane.hidden = i !== index; tabButtons[i].setAttribute('aria-selected', String(i === index)); tabButtons[i].tabIndex = i === index ? 0 : -1; });
        // Filtre yalnızca galeri görünümünde anlamlı; diğer sekmelerde gizle.
        openFilterDrawer.hidden = tabDefs[index]?.[0] !== galleryPane;
        // Galeride kaydırma galerinin kendisinde; sekme çubuğu ve içerik
        // geri kalan alanı paylaşır. Diğer sekmeler normal akışla kayar.
        workspace.classList.toggle('is-gallery', tabDefs[index]?.[0] === galleryPane);
        workspace.scrollTop = 0;
        // NOT: render() burada çağrılmaz. activateTab(0) kurulum sırasında,
        // render'ın bağımlı olduğu denetimler (grid, query...) henüz
        // tanımlanmadan çalışır; galeri zaten sonda bir kez render edilir.
      };
      tabDefs.forEach(([pane, name], index) => {
        const btn = $el('button', { type: 'button', role: 'tab', 'aria-controls': pane.id, 'aria-selected': String(index === 0) }, name);
        if (pane === linksPane && (warnings.length || blockedPages.length)) {
          btn.classList.add('tab-has-notes'); btn.setAttribute('aria-label', `Bağlantılar: ${warnings.length + blockedPages.length} tarama notu`);
          btn.appendChild($el('span', { class:'tab-note-count' }, String(warnings.length + blockedPages.length)));
        }
        btn.tabIndex = index === 0 ? 0 : -1; btn.onclick = () => activateTab(index);
        btn.onkeydown = e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const i = (index + (e.key === 'ArrowRight' ? 1 : -1) + tabDefs.length) % tabDefs.length; activateTab(i); tabButtons[i].focus(); } };
        tabButtons.push(btn); tabs.appendChild(btn); workspace.appendChild(pane);
      });
      const metrics = $el('div', { class: 'metrics header-metrics', role: 'group', 'aria-label': 'Tarama özeti' });
      const selectedMetric = $el('div', { class: 'metric-value' }, '0');
      for (const [value, label] of [[String(images.length), 'Benzersiz görsel'], [String(pages.length), 'Taranan sayfa'], [String(duplicateOccurrenceCount), 'Tekrar URL nedeniyle atlandı']]) {
        const card = $el('div', { class: 'metric header-metric' });
        card.append($el('div', { class: 'metric-value' }, value), $el('div', { class: 'metric-label' }, label)); metrics.appendChild(card);
      }
      const selectedCard = $el('div', { class: 'metric header-metric' });
      selectedCard.append(selectedMetric, $el('div', { class: 'metric-label' }, 'Seçili görsel')); metrics.appendChild(selectedCard);
      d.header.classList.add('result-header'); d.header.appendChild(metrics); d.box.append(tabs, workspace);
      const linkSubtabs = $el('div', { class: 'link-subtabs', role: 'tablist', 'aria-label': 'Bağlantı görünümleri' });
      const selectedLinksTab = $el('button', { type: 'button', role: 'tab', 'aria-selected': 'true', 'aria-controls': 'isp-links-selected' }, 'Seçili görsel bağlantıları');
      const duplicateLinksTab = $el('button', { type: 'button', role: 'tab', 'aria-selected': 'false', 'aria-controls': 'isp-links-duplicates' }, `Tekrarlanan URL’ler (${duplicateOccurrenceCount})`);
      duplicateLinksTab.tabIndex = -1;
      const selectedLinksPane = $el('div', { class: 'link-subpane', role: 'tabpanel', id: 'isp-links-selected' });
      const duplicateLinksPane = $el('div', { class: 'link-subpane', role: 'tabpanel', id: 'isp-links-duplicates', hidden: true });
      const activateLinksTab = index => {
        const selected = index === 0; selectedLinksPane.hidden = !selected; duplicateLinksPane.hidden = selected;
        selectedLinksTab.setAttribute('aria-selected', String(selected)); duplicateLinksTab.setAttribute('aria-selected', String(!selected));
        selectedLinksTab.tabIndex = selected ? 0 : -1; duplicateLinksTab.tabIndex = selected ? -1 : 0;
      };
      selectedLinksTab.onclick = () => activateLinksTab(0); duplicateLinksTab.onclick = () => activateLinksTab(1);
      for (const [button, index] of [[selectedLinksTab,0],[duplicateLinksTab,1]]) button.onkeydown = event => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const next = index ? 0 : 1; activateLinksTab(next); (next ? duplicateLinksTab : selectedLinksTab).focus(); }
      };
      linkSubtabs.append(selectedLinksTab, duplicateLinksTab);
      const linkNotice = $el('details', { class:'link-notices', hidden:!warnings.length && !blockedPages.length });
      if (warnings.length || blockedPages.length) linkNotice.appendChild($el('summary', { class:'link-notice-summary' }, `Tarama notları${warnings.length ? ` · ${warnings.length}` : ''}${blockedPages.length ? ` · ${blockedPages.length} erişim bekliyor` : ''}`));
      if (warnings.length) {
        const warningList = $el('div', { class:'link-warning-list' });
        for (const warning of warnings) warningList.appendChild($el('p', {}, warning));
        linkNotice.appendChild(warningList);
      }
      if (blockedPages.length) {
        for (const blockedUrl of blockedPages) linkNotice.appendChild(linkOrText({ href:blockedUrl, target:'_blank', rel:'noopener noreferrer' }, '🔐 Sayfayı açıp doğrulamayı tamamla'));
      }
      linksPane.append(linkNotice, linkSubtabs, selectedLinksPane, duplicateLinksPane);
      const pageDetails = $el('details'); pageDetails.appendChild($el('summary', {}, 'Taranan sayfalar'));
      for (const pageUrl of pages) pageDetails.appendChild($el('p', { class: 'muted' }, pageUrl));
      selectedLinksPane.appendChild(pageDetails);
      const duplicatesHeading = $el('div', { class: 'output-heading' });
      duplicatesHeading.append($el('strong', {}, 'Aynı URL nedeniyle atlananlar'), $el('span', {}, `${duplicateRecords.length} farklı URL · ${duplicateOccurrenceCount} tekrar`));
      duplicateLinksPane.appendChild(duplicatesHeading);
      duplicateLinksPane.appendChild($el('p', { class: 'muted' }, 'Bu rapor aynı çözümlenmiş görsel URL’sinin tekrarlarını gösterir. Farklı URL’lere sahip ama aynı dosya içeriğini taşıyan görseller burada sayılmaz.'));
      const duplicateList = $el('div', { class: 'duplicate-url-list', 'aria-label': 'Tekrarlanan görsel bağlantıları' });
      if (!duplicateRecords.length) duplicateList.appendChild($el('p', { class: 'muted' }, 'Tarama sırasında yinelenen görsel URL’si bulunmadı.'));
      for (const record of duplicateRecords) {
        const row = $el('div', { class: 'duplicate-url-row' });
        const anchor = linkOrText({ href: record.url, target: '_blank', rel: 'noopener noreferrer' }, displayUrl(record.url, c));
        const firstPage = record.firstPage || images.find(item => item.url === record.url)?.page || '';
        const sourcePages = [...new Set([firstPage, ...(Array.isArray(record.pages) ? record.pages : [])].filter(Boolean))];
        const sourceText = sourcePages.length ? ` · Görüldüğü sayfalar: ${sourcePages.join(', ')}` : '';
        const kept = images.some(item => item.url === record.url);
        const keptText = kept ? 'bir benzersiz kopya sonuçlarda tutuldu' : 'benzersiz kopya sonuçlarda yok; ölçü veya filtre nedeniyle elenmiş olabilir';
        row.append(anchor, $el('span', { class: 'duplicate-url-count' }, `${record.count} tekrar atlandı; ${keptText}${sourceText}`));
        duplicateList.appendChild(row);
      }
      duplicateLinksPane.appendChild(duplicateList);
      const duplicateCopyActions = $el('div', { class: 'actions' });
      const copyDuplicateUrls = $el('button', { type: 'button', class: 'secondary', disabled: !duplicateRecords.length }, '📋 Tekrarlanan URL’leri kopyala');
      const duplicateCopyStatus = $el('p', { class: 'muted', role: 'status' });
      duplicateCopyActions.appendChild(copyDuplicateUrls); duplicateLinksPane.append(duplicateCopyActions, duplicateCopyStatus);
      copyDuplicateUrls.onclick = async () => { try { await copyText(duplicateRecords.map(record => record.url).join('\n')); duplicateCopyStatus.textContent = '✅ Tekrarlanan URL’ler kopyalandı.'; } catch (error) { duplicateCopyStatus.textContent = '❌ ' + error.message; } };
      const contentDuplicateHeading = $el('div', { class: 'output-heading' });
      const contentDuplicateCount = $el('span', {}, `${contentDuplicatePairs.length} SHA-256 eşleşmesi`);
      contentDuplicateHeading.append($el('strong', {}, 'Farklı URL, aynı dosya içeriği'), contentDuplicateCount);
      duplicateLinksPane.appendChild(contentDuplicateHeading);
      duplicateLinksPane.appendChild($el('p', { class: 'muted' }, 'Bu bölüm ancak ZIP ayarındaki SHA-256 tekilleştirme açıkken ve ZIP oluşturma denendikten sonra doldurulur.'));
      const contentDuplicateList = $el('div', { class: 'duplicate-url-list', 'aria-label': 'Aynı bayt içeriğine sahip farklı URL bağlantıları' });
      const renderContentDuplicatePairs = () => {
        contentDuplicateList.replaceChildren();
        contentDuplicateCount.textContent = `${contentDuplicatePairs.length} SHA-256 eşleşmesi`;
        if (!contentDuplicatePairs.length) { contentDuplicateList.appendChild($el('p', { class: 'muted' }, 'Farklı URL’lerde aynı içerik eşleşmesi henüz bulunmadı.')); return; }
        for (const pair of contentDuplicatePairs) {
          const row = $el('div', { class: 'duplicate-url-row' });
          row.append(linkOrText({ href: pair.skippedUrl, target: '_blank', rel: 'noopener noreferrer' }, displayUrl(pair.skippedUrl, c)), $el('span', { class: 'duplicate-url-count' }, 'ZIP’ten atlandı; aynı SHA-256 içeriği bu bağlantıda da var:'), linkOrText({ href: pair.keptUrl, target: '_blank', rel: 'noopener noreferrer' }, displayUrl(pair.keptUrl, c)));
          contentDuplicateList.appendChild(row);
        }
      };
      renderContentDuplicatePairs(); duplicateLinksPane.appendChild(contentDuplicateList);
      // Filtre düğmesi sekme çubuğunun sağ ucunda durur: galerinin üstünde ayrı
      // bir araç çubuğu, görsellerin "arada sıkışmış" görünmesine ve boş alan
      // bırakılmasına yol açıyordu.
      const openFilterDrawer = $el('button', { type:'button', class:'secondary filter-open-button', 'aria-haspopup':'dialog', 'aria-expanded':'false' }, '☷ Görselleri filtrele ve seç');
      tabs.appendChild(openFilterDrawer);
      const filterDrawerBackdrop = $el('div', { class:'filter-drawer-backdrop', hidden:true });
      const filterDrawerPanel = $el('div', { class:'filter-drawer-panel', role:'dialog', 'aria-modal':'true', 'aria-label':'Görselleri filtrele ve seç' });
      const filterDrawerHeader = $el('div', { class:'filter-drawer-header' });
      filterDrawerHeader.append($el('h3', {}, 'Görselleri filtrele ve seç'));
      const closeFilterDrawer = $el('button', { type:'button', class:'close filter-drawer-close', 'aria-label':'Filtre çekmecesini kapat' }, '×');
      filterDrawerHeader.appendChild(closeFilterDrawer);
      const tools = $el('div', { class:'filter-drawer-body' });
      filterDrawerPanel.append(filterDrawerHeader, tools); filterDrawerBackdrop.appendChild(filterDrawerPanel); galleryPane.appendChild(filterDrawerBackdrop);
      let drawerCloseTimer = null;
      const openDrawer = () => {
        clearTimeout(drawerCloseTimer); filterDrawerBackdrop.hidden = false; openFilterDrawer.setAttribute('aria-expanded','true');
        (window.requestAnimationFrame || (callback => setTimeout(callback, 16)))(() => { filterDrawerBackdrop.classList.add('is-open'); render(); });
        closeFilterDrawer.focus({ preventScroll:true });
      };
      const closeDrawer = () => {
        filterDrawerBackdrop.classList.remove('is-open'); clearTimeout(drawerCloseTimer);
        drawerCloseTimer = setTimeout(() => { if (!filterDrawerBackdrop.classList.contains('is-open')) { filterDrawerBackdrop.hidden = true; openFilterDrawer.setAttribute('aria-expanded','false'); openFilterDrawer.focus({ preventScroll:true }); } }, 200);
      };
      openFilterDrawer.onclick = openDrawer; closeFilterDrawer.onclick = closeDrawer;
      filterDrawerBackdrop.onclick = event => { if (event.target === filterDrawerBackdrop) closeDrawer(); };
      filterDrawerPanel.onkeydown = event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDrawer(); return; }
        if (event.key !== 'Tab') return;
        const focusable = [...filterDrawerPanel.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(node => node.getClientRects().length);
        if (!focusable.length) { event.preventDefault(); return; }
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (event.target === first || !filterDrawerPanel.contains(event.target))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (event.target === last || !filterDrawerPanel.contains(event.target))) { event.preventDefault(); first.focus(); }
        event.stopPropagation();
      };
      const row = $el('div', { class: 'toolbar' });
      const query = $el('input', { placeholder: 'URL veya alan adı ara', 'aria-label': 'URL veya alan adı ara' });
      const format = $el('select', { 'aria-label': 'Dosya türü' });
      for (const [value, name] of [['','Tüm türler'],['jpg','JPG'],['png','PNG'],['webp','WebP'],['gif','GIF'],['avif','AVIF'],['svg','SVG'],['unknown','Diğer / bilinmiyor']]) format.appendChild($el('option', { value }, name));
      const order = $el('select', { 'aria-label': 'Sıralama' });
      for (const [value, name] of [['page','Sayfa sırası'],['url','URL sırası'],['area','Görsel boyutu'],['bytes','Dosya boyutu']]) order.appendChild($el('option', { value }, name));
      row.append(query, format, order); tools.appendChild(row);
      const articleFilters = $el('div', { class:'toolbar filter-drawer-filters' });
      const articleUrlFilter = $el('select', { 'aria-label':'Ana içeriğe göre filtrele' });
      articleUrlFilter.appendChild($el('option', { value:'' }, 'Tüm içerik bağlantıları'));
      const articleChoices = new Map();
      for (const image of images) {
        const urls = [...new Set([image.articleUrl, ...(image.articleUrls || [])].filter(Boolean))];
        const topics = image.topics?.length ? image.topics : [image.topic || ''];
        urls.forEach((articleUrl, index) => { if (!articleChoices.has(articleUrl)) articleChoices.set(articleUrl, topics[index] || image.topic || ''); });
      }
      const sortedArticleChoices = [...articleChoices].sort((a,b) => a[0].localeCompare(b[0]));
      for (const [articleUrl] of sortedArticleChoices) {
        let address = articleUrl; try { const parsed = new URL(articleUrl); address = parsed.host + parsed.pathname; } catch {}
        articleUrlFilter.appendChild($el('option', { value:articleUrl, title:articleUrl }, address));
      }
      const topicFilter = $el('select', { 'aria-label':'Konu başlığına göre filtrele' });
      topicFilter.appendChild($el('option', { value:'' }, 'Tüm konu başlıkları'));
      const topicChoices = new Set([...articleChoices.values(), ...images.flatMap(image => [image.topic, ...(image.topics || [])])].filter(Boolean));
      for (const topic of [...topicChoices].sort((a,b) => a.localeCompare(b, 'tr'))) topicFilter.appendChild($el('option', { value:topic }, topic));
      articleFilters.append(articleUrlFilter, topicFilter); tools.appendChild(articleFilters);
      const updateArticleFilters = () => {
        const active = !!(articleUrlFilter.value || topicFilter.value);
        openFilterDrawer.classList.toggle('filter-active', active);
        openFilterDrawer.setAttribute('aria-label', active ? 'Görsel filtreleri; içerik filtresi etkin' : 'Görselleri filtrele ve seç');
      };
      articleUrlFilter.onchange = () => {
        const topic = articleChoices.get(articleUrlFilter.value) || '';
        topicFilter.value = [...topicChoices].includes(topic) ? topic : '';
        updateArticleFilters(); grid.scrollTop = 0; render();
      };
      topicFilter.onchange = () => {
        const topic = topicFilter.value;
        articleUrlFilter.value = topic ? (sortedArticleChoices.find(([, title]) => title === topic)?.[0] || '') : '';
        updateArticleFilters(); grid.scrollTop = 0; render();
      };
      const row2 = $el('div', { class: 'toolbar' });
      const minW = $el('input', { type: 'number', min: 0, placeholder: 'Min. genişlik', 'aria-label': 'Filtre minimum genişlik' });
      const minH = $el('input', { type: 'number', min: 0, placeholder: 'Min. yükseklik', 'aria-label': 'Filtre minimum yükseklik' });
      const ratio = $el('select', { 'aria-label': 'En boy oranı' });
      for (const [value, name] of [['','Tüm oranlar'],['landscape','Yatay'],['portrait','Dikey'],['square','Kareye yakın'],['unknown','Oran bilinmiyor']]) ratio.appendChild($el('option', { value }, name));
      const known = $el('select', { 'aria-label': 'Boyutu bilinmeyenler' });
      for (const [value, name] of [['include','Bilinmeyenleri göster'],['exclude','Bilinmeyenleri gizle'],['only','Yalnız bilinmeyenler']]) known.appendChild($el('option', { value }, name));
      row2.append(minW, minH, ratio, known);
      const advancedFilters = $el('div', { class:'filter-drawer-extra' }); advancedFilters.appendChild(row2); tools.appendChild(advancedFilters);
      const sizeRow = $el('div', { class: 'toolbar' });
      const minMB = $el('input', { type: 'number', min: 0, step: '0.1', placeholder: 'Min. dosya boyutu (MB)', 'aria-label': 'Minimum dosya boyutu MB' });
      const maxMB = $el('input', { type: 'number', min: 0, step: '0.1', placeholder: 'Maks. dosya boyutu (MB)', 'aria-label': 'Maksimum dosya boyutu MB' });
      sizeRow.append(minMB, maxMB); advancedFilters.appendChild(sizeRow);
      const row3 = $el('div', { class: 'toolbar' });
      const selectAll = $el('button', { type: 'button', class: 'secondary' }, 'Filtredekileri seç');
      const selectNone = $el('button', { type: 'button', class: 'secondary' }, 'Filtredekileri kaldır');
      const slideshowLaunch = $el('button', { type: 'button', class: 'secondary' }, '▶ Slayt gösterisi');
      const previews = $el('input', { type: 'checkbox', checked: true });
      const previewLabel = $el('label', { class: 'compact' }); previewLabel.append(previews, $el('span', {}, 'Önizlemeleri yükle'));
      row3.append(selectAll, selectNone, slideshowLaunch, previewLabel); tools.appendChild(row3);
      const explanation = $el('p', { class: 'muted' }, 'Filtreler yalnızca görünümü değiştirir; ZIP ve dışa aktarım filtre dışında kalanlar dâhil tüm seçili görselleri kullanır. Bilinmeyen dosya boyutları aralık filtresinde korunur. Önizleme, görsel sunucularına yeni istek gönderebilir.'); tools.appendChild(explanation);
      const grid = $el('div', { class: 'gallery', role: 'region', tabindex: 0, 'aria-label': 'Görsel galerisi' }); galleryPane.appendChild(grid);
      const gridNote = d.subtitle;
      const outputHeading = $el('div', { class: 'output-heading' });
      outputHeading.append($el('strong', {}, 'Seçili görsel bağlantıları'), $el('span', {}, 'Kopyala veya dışa aktar')); selectedLinksPane.appendChild(outputHeading);
      const text = $el('textarea', { class: 'output', readOnly: true, 'aria-label': 'Resim URL listesi' }); selectedLinksPane.appendChild(text);
      const actions = $el('div', { class: 'actions' });
      const copy = $el('button', { type: 'button' }, '📋 Kopyala');
      const copySize = $el('button', { type: 'button' }, '📋 Boyutlu');
      const txt = $el('button', { type: 'button' }, '💾 TXT');
      const csv = $el('button', { type: 'button' }, 'CSV');
      const json = $el('button', { type: 'button' }, 'JSON');
      const diagnostics = $el('button', { type: 'button' }, 'Tanılama (anonim)');
      const zip = $el('button', { class: 'primary', type: 'button', disabled: !images.length }, '🗜️ ZIP');
      const cancel = $el('button', { type: 'button', class: 'danger', hidden: true }, 'İptal');
      actions.append(copy, copySize, txt, csv, json, diagnostics); selectedLinksPane.appendChild(actions);
      downloadPane.appendChild($el('h3', {}, 'Seçili görselleri indir'));
      downloadPane.appendChild($el('p', { class: 'muted tab-hint' }, 'Galeride seçtiğin tüm görseller ZIP arşivine eklenir. Hatalı olanlar raporlanır; birden fazla parça oluşursa her birini ayrı indir.'));
      const zipPlanStatus = $el('p', { class: 'muted', role: 'status' }); downloadPane.appendChild(zipPlanStatus);
      const resourceStatus = $el('p', { class: 'muted resource-status', role: 'status' }); downloadPane.appendChild(resourceStatus);
      const zipActions = $el('div', { class: 'actions' }); zipActions.append(zip, cancel); downloadPane.appendChild(zipActions);
      const progress = $el('progress', { class: 'bar', max: 100, value: 0, hidden: true }); downloadPane.appendChild(progress);
      const status = $el('div', { class: 'status', role: 'status' }); downloadPane.appendChild(status);
      const manual = $el('div'); downloadPane.appendChild(manual);
      const details = $el('details', { hidden: true });
      details.appendChild($el('summary', {}, 'Başarısız görsellerin ayrıntıları'));
      const verifyLinks = $el('div'); details.appendChild(verifyLinks);
      const errorList = $el('pre', { class: 'error-list' });
      details.appendChild(errorList); downloadPane.appendChild(details);
      const sessionBox = section(sessionPane, 'Oturumu kaydet');
      sessionBox.appendChild($el('p', { class: 'muted' }, 'Açık onayla URL, seçim ve durumlar Tampermonkey deposuna kaydedilir. URL’ler özel veya imzalı bilgiler içerebilir. Veriler Kayıtlar menüsünden silinebilir.'));
      const binary = $el('input', { type: 'checkbox' });
      const binaryLabel = $el('label'); binaryLabel.append($el('span', {}, 'Görsel verilerini de sakla (açık izin, kodlanmış veride yaklaşık 20 MB sınır)'), binary); sessionBox.appendChild(binaryLabel);
      const save = $el('button', { type: 'button', class: 'secondary' }, '💾 Oturumu kaydet / güncelle'); sessionBox.appendChild(save);
      const saveStatus = $el('p', { class: 'muted', role: 'status' }); sessionBox.appendChild(saveStatus);
      let sessionId = restored?.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      let remember = !!restored, rememberBinary = false, snapshotExists = !!restored, cacheSnapshotExists = false, saveTimer = null, zipController = null;
      const downloaded = new Map(), objectUrls = [];
      let retainedImageBytes = 0;
      if (restored) {
        const cache = readJSON(CACHE_KEY, null);
        if (cache?.id === sessionId && Array.isArray(cache.items)) {
          for (const item of cache.items) try {
            if (typeof item.url === 'string' && typeof item.data === 'string' && typeof item.ext === 'string') { const decoded = decodeData(item.data); downloaded.set(item.url, { data: decoded, ext: item.ext }); retainedImageBytes += decoded.byteLength; }
          } catch (e) { console.warn('[Image Scraper] Önbellek okunamadı', e); }
          binary.checked = rememberBinary = true; cacheSnapshotExists = true;
          saveStatus.textContent = 'Kayıtlı görseller yüklendi. Diğer başarılı görseller gerekirse yeniden indirilir.';
        } else saveStatus.textContent = 'Oturum açıldı. Kaydedilmemiş görsel verileri gerekirse yeniden indirilir.';
      }
      const heapSnapshot = () => {
        const memory = window.performance?.memory;
        const used = Number(memory?.usedJSHeapSize), limit = Number(memory?.jsHeapSizeLimit);
        return Number.isFinite(used) && used > 0 && Number.isFinite(limit) && limit > 0 ? { used, limit } : null;
      };
      const adaptiveConcurrency = () => {
        const configured = Math.max(1, Math.floor(Number(c.ZIP_CONCURRENT) || 1));
        const heap = heapSnapshot();
        if (heap) { const ratio = heap.used / heap.limit; if (ratio >= .84) return 1; if (ratio >= .70) return Math.min(configured, 2); }
        if (retainedImageBytes >= 512 * 1048576) return 1;
        if (retainedImageBytes >= 256 * 1048576) return Math.min(configured, 2);
        return configured;
      };
      const etaLabel = (done, total, startedAt) => {
        const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;
        const seconds = elapsed >= 1 ? etaSeconds(done, total, elapsed) : null;
        return seconds === null ? '' : `~${formatEta(seconds)} kaldı`;
      };
      const updateResourceStatus = (active = 0, limit = adaptiveConcurrency(), done = 0, total = 0, startedAt = 0) => {
        const heap = heapSnapshot(), eta = etaLabel(done, total, startedAt);
        resourceStatus.textContent = `Bellek tahmini: uygulamanın tuttuğu görsel verisi ${formatBytes(retainedImageBytes)} · paralel indirme ${active}/${limit}${heap ? ` · JS heap ${formatBytes(heap.used)} / ${formatBytes(heap.limit)}` : ' · tarayıcı gerçek heap ölçümünü sunmuyor'}${eta ? ` · ${eta}` : ''} · bellek baskısında paralellik otomatik azaltılır. Heap değeri tarayıcı tarafından sağlanıyorsa yaklaşık ölçümdür.`;
      };
      updateResourceStatus();
      binary.onchange = () => {
        if (binary.checked && !confirm('Bu oturumun indirilmiş görsel verileri Tampermonkey deposunda saklanabilir. Uygulama sınırı yaklaşık 20 MB; eklenti kotası daha düşük olabilir. Onaylıyor musun?')) binary.checked = false;
        rememberBinary = binary.checked;
        if (rememberBinary && binary.checked) cacheSnapshotExists = !!GM_getValue(CACHE_KEY, null);
        if (!rememberBinary) {
          const old = readJSON(CACHE_KEY, null);
          if (old?.id === sessionId) {
            if (confirm('Bu oturuma ait daha önce kaydedilmiş görseller de silinsin mi?')) { deleteKey(CACHE_KEY); cacheSnapshotExists = false; }
            else { binary.checked = true; rememberBinary = true; }
          }
        }
      };
      function persist(force = false) {
        if (!remember) return;
        try {
          // Başka bir sekmede silinen/değiştirilen oturum eski panel tarafından yeniden yaratılmasın.
          if (!force && snapshotExists && readJSON(SESSION_KEY, null)?.id !== sessionId) {
            remember = false; rememberBinary = false; binary.checked = false;
            saveStatus.textContent = 'Oturum başka bir pencerede silindi veya değiştirildi; otomatik kayıt durduruldu.';
            return;
          }
          if (!force && rememberBinary && cacheSnapshotExists && GM_getValue(CACHE_KEY, null) === null) {
            rememberBinary = false; binary.checked = false; cacheSnapshotExists = false;
            saveStatus.textContent = 'Görsel kaydı başka bir pencerede silindi; otomatik görsel kaydı durduruldu.';
          }
          const snapshot = { version: 1, id: sessionId, origin: location.origin, savedAt: Date.now(), pages, warnings, blocked: result.blocked || [], duplicates:duplicateRecords, contentDuplicates:contentDuplicatePairs,
            images: images.map(i => ({ url: i.url, page: i.page || '', width: i.width || 0, height: i.height || 0, displayWidth: i.displayWidth || 0, displayHeight: i.displayHeight || 0, selected: i.selected, status: i.status, error: i.error || '', bytes: i.bytes || 0, ext: i.ext || '' })) };
          GM_setValue(SESSION_KEY, JSON.stringify(snapshot)); snapshotExists = true;
          if (rememberBinary) {
            const entries = [...downloaded].map(([url, item]) => ({ url, ext: item.ext, data: item.data }));
            const estimate = entries.reduce((sum, x) => sum + Math.ceil(x.data.byteLength / 3) * 4 + x.url.length * 3 + 200, 256);
            if (estimate > CACHE_CAP) throw new Error('Görsel önbelleği 20 MB uygulama sınırını aşıyor; oturum bilgileri kaydedildi, önceki görsel kaydı kalmış olabilir.');
            const payload = JSON.stringify({ id: sessionId, items: entries.map(x => ({ url: x.url, ext: x.ext, data: encodeData(x.data) })) });
            if (payload.length * 2 > CACHE_CAP) throw new Error('Kodlanmış görseller 20 MB sınırını aşıyor; oturum bilgileri kaydedildi, önceki görsel kaydı kalmış olabilir.');
            GM_setValue(CACHE_KEY, payload); cacheSnapshotExists = true;
          }
          saveStatus.textContent = `✅ Oturum kaydedildi${rememberBinary ? ` · ${downloaded.size} görsel verisi` : ' · görsel verisi saklanmıyor'}.`;
        } catch (e) { saveStatus.textContent = '⚠️ Kayıt tamamlanamadı: ' + e.message; }
      }
      function scheduleSave() { if (remember) { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 1200); } }
      save.onclick = () => {
        const old = readJSON(SESSION_KEY, null);
        if (!remember && old && old.id !== sessionId && !confirm('Önceki kayıtlı oturum ve ona ait görsel verileri bu oturumla değiştirilsin mi?')) return;
        if (!remember && old && old.id !== sessionId) deleteKey(CACHE_KEY);
        remember = true; persist(true);
      };
      function kind(img) {
        // new URL() bozuk bir adreste hata fırlatır; galeri çizimi buna takılmamalı.
        let ext = String(img.ext || '').toLowerCase();
        if (!ext) {
          try { ext = (new URL(img.url).pathname.split('.').pop() || '').toLowerCase(); } catch { ext = ''; }
        }
        return ext === 'jpeg' ? 'jpg' : ['jpg','png','webp','gif','avif','svg'].includes(ext) ? ext : 'unknown';
      }
      function filtered() {
        const q = query.value.trim().toLowerCase(), articleQuery = articleUrlFilter.value, topicQuery = topicFilter.value, mw = Number(minW.value) || 0, mh = Number(minH.value) || 0;
        const list = images.filter(img => {
          const missing = !img.width || !img.height;
          if (q && !img.url.toLowerCase().includes(q)) return false;
          if (articleQuery && ![img.articleUrl, ...(img.articleUrls || [])].filter(Boolean).includes(articleQuery)) return false;
          if (topicQuery && ![img.topic, ...(img.topics || [])].filter(Boolean).includes(topicQuery)) return false;
          if (format.value && kind(img) !== format.value) return false;
          if ((known.value === 'exclude' && missing) || (known.value === 'only' && !missing)) return false;
          if ((mw && img.width && img.width < mw) || (mh && img.height && img.height < mh)) return false;
          const loBytes = (Number(minMB.value) || 0) * 1048576, hiBytes = (Number(maxMB.value) || 0) * 1048576;
          if (img.bytes && ((loBytes && img.bytes < loBytes) || (hiBytes && img.bytes > hiBytes))) return false;
          if (ratio.value === 'unknown' && !missing) return false;
          if (ratio.value && ratio.value !== 'unknown') {
            if (missing) return false;
            const r = img.width / img.height;
            if ((ratio.value === 'square' && (r < .9 || r > 1.1)) || (ratio.value === 'landscape' && r <= 1.1) || (ratio.value === 'portrait' && r >= .9)) return false;
          }
          return true;
        });
        if (order.value === 'url') list.sort((a,b) => a.url.localeCompare(b.url));
        if (order.value === 'area') list.sort((a,b) => b.width*b.height-a.width*a.height);
        if (order.value === 'bytes') list.sort((a,b) => (b.bytes||0)-(a.bytes||0));
        return list;
      }
      const selection = () => {
        const selected = images.filter(i => i.selected);
        if (order.value === 'url') selected.sort((a,b) => a.url.localeCompare(b.url));
        if (order.value === 'area') selected.sort((a,b) => b.width*b.height-a.width*a.height);
        if (order.value === 'bytes') selected.sort((a,b) => (b.bytes||0)-(a.bytes||0));
        return selected;
      };
      const VIRTUAL_CARD_HEIGHT = 320, VIRTUAL_OVERSCAN_ROWS = 2;
      let galleryRenderPending = false, cachedFilteredList = null, cachedSelectionList = null;
      function render(refreshData = true) {
        const savedScrollTop = Number(grid.scrollTop) || 0;
        if (refreshData || !cachedFilteredList) cachedFilteredList = filtered();
        if (refreshData || !cachedSelectionList) cachedSelectionList = selection();
        const list = cachedFilteredList, chosen = cachedSelectionList; selectedMetric.textContent = String(chosen.length);
        slideshowLaunch.disabled = !list.length;
        const knownBytes = chosen.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);
        const unknownSizes = chosen.filter(item => !(Number(item.bytes) > 0)).length;
        const fileParts = Math.ceil(chosen.length / Math.max(1, Number(c.PART_MAX_FILES) || 1));
        const byteParts = knownBytes ? Math.ceil(knownBytes / (Math.max(1, Number(c.PART_MAX_MB) || 1) * 1024 * 1024)) : 1;
        const streamAvailable = c.STREAM_ZIP_TO_DISK && typeof window.showDirectoryPicker === 'function';
        zipPlanStatus.textContent = `ZIP ön kontrolü: ${chosen.length} seçili · bilinen boyut ${formatBytes(knownBytes)} · boyutu bilinmeyen ${unknownSizes} · mevcut bilgilere göre en az ${Math.max(fileParts, byteParts)} parça. Sınırlar: ${c.PART_MAX_FILES} dosya / ${c.PART_MAX_MB} MB-parça. Kesin boyut indirme sonrası belli olur; ${streamAvailable ? 'ZIP akışla diske yazılır, görsel baytları bellekte kalır.' : 'ZIP arşivi oluşturma tarayıcı belleği kullanır.'}`;
        zip.disabled = !!zipController || !chosen.length;
        text.value = chosen.map(i => displayUrl(i.url, c)).join('\n');
        const viewportWidth = Number(window.innerWidth) || 1280;
        const mobileLayout = viewportWidth <= 600, columnGap = mobileLayout ? 9 : 15, minCardWidth = mobileLayout ? 160 : 220;
        const gridWidth = Number(grid.clientWidth) || Math.max(minCardWidth, viewportWidth - 56);
        const columns = mobileLayout ? 2 : Math.max(1, Math.floor((gridWidth + columnGap) / (minCardWidth + columnGap)));
        const rowPitch = VIRTUAL_CARD_HEIGHT + columnGap, totalRows = Math.ceil(list.length / columns);
        const firstRow = Math.min(totalRows, Math.floor(savedScrollTop / rowPitch));
        const visibleRows = Math.max(1, Math.ceil(((Number(grid.clientHeight) || 480) + columnGap) / rowPitch));
        const startRow = Math.max(0, firstRow - VIRTUAL_OVERSCAN_ROWS);
        const endRow = Math.min(totalRows, firstRow + visibleRows + VIRTUAL_OVERSCAN_ROWS);
        const startIndex = Math.min(list.length, startRow * columns), endIndex = Math.min(list.length, endRow * columns);
        const addVirtualSpacer = rows => {
          if (rows <= 0) return;
          const spacer = $el('div', { class:'virtual-spacer', 'aria-hidden':'true' });
          spacer.style.gridRow = `span ${rows}`; spacer.style.height = `${rows * VIRTUAL_CARD_HEIGHT + Math.max(0, rows - 1) * columnGap}px`;
          grid.appendChild(spacer);
        };
        grid.replaceChildren(); addVirtualSpacer(startRow);
        for (const img of list.slice(startIndex, endIndex)) {
          const card = $el('div', { class: 'image-card' });
          const check = $el('input', { type: 'checkbox', checked: img.selected, 'aria-label': `Görseli seç: ${safeBaseName(img.url)}` });
          check.onchange = () => { img.selected = check.checked; cachedSelectionList = selection(); selectedMetric.textContent = String(cachedSelectionList.length); zip.disabled = !!zipController || !cachedSelectionList.length; text.value = cachedSelectionList.map(i => displayUrl(i.url, c)).join('\n'); scheduleSave(); };
          card.appendChild(check);
          const thumbWrap = $el('div', { class: 'thumb-wrap slideshow-thumb-trigger', role: 'button', tabIndex: 0, 'aria-label': `Slayt gösterisinde aç: ${safeBaseName(img.url)}` });
          thumbWrap.onclick = event => { event.preventDefault(); event.stopPropagation(); openSlideshow(list, img, false); };
          thumbWrap.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); openSlideshow(list, img, false); } };
          if (previews.checked) {
            const thumb = $el('img', { loading: 'lazy', alt: safeBaseName(img.url) });
            thumb.onerror = () => { thumb.remove(); thumbWrap.textContent = 'Önizleme yüklenemedi'; };
            thumb.src = img.url; thumbWrap.appendChild(thumb);
          } else thumbWrap.textContent = 'Önizleme kapalı';
          card.appendChild(thumbWrap);
          const meta = $el('div', { class: 'meta' });
          meta.append($el('strong', { title: img.url }, safeBaseName(img.url)), $el('div', {}, `${img.width || '?'} × ${img.height || '?'} gerçek${img.displayWidth || img.displayHeight ? ` · HTML ${img.displayWidth || '?'} × ${img.displayHeight || '?'}` : ''} · ${kind(img).toUpperCase()}`), $el('div', {}, `${img.bytes ? formatBytes(img.bytes) + ' · ' : ''}${img.status || 'bekliyor'}`));
          if (img.topic) meta.appendChild($el('div', { class:'muted' }, `Konu: ${img.topic}`));
          if (img.articleUrl) meta.appendChild(linkOrText({ href:img.articleUrl, target:'_blank', rel:'noopener noreferrer', title:img.articleUrl }, 'Ana içerik sayfası'));
          card.appendChild(meta); grid.appendChild(card);
        }
        addVirtualSpacer(Math.max(0, totalRows - endRow));
        grid.scrollTop = savedScrollTop;
        gridNote.hidden = false;
        gridNote.textContent = `${list.length} eşleşme · ${endIndex - startIndex} kart etkin DOM penceresinde; tüm sonuçlar sanallaştırılmış galeride kaydırılabilir.`;
      }
      let galleryClosed = false;
      const scheduleGalleryRender = () => {
        if (galleryRenderPending || galleryClosed) return;
        galleryRenderPending = true;
        const requestFrame = window.requestAnimationFrame || (callback => setTimeout(callback, 16));
        requestFrame(() => { galleryRenderPending = false; if (!galleryClosed) render(false); });
      };
      grid.addEventListener('scroll', scheduleGalleryRender, { passive:true });
      window.addEventListener('resize', scheduleGalleryRender, { passive:true });
      function openSlideshow(sourceItems, startItem, onlySelectedStart = false) {
        const items = [...(sourceItems || [])]; if (!items.length) return;
        const previousFocus = ui.activeElement || document.activeElement;
        const overlay = $el('div', { class: 'slideshow-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Görsel slayt gösterisi', tabindex: -1 });
        const image = $el('img', { class: 'slideshow-image', alt: '', draggable: false });
        const transitionImage = $el('img', { class: 'slideshow-image slideshow-transition-layer', alt: '', draggable: false, hidden: true });
        const top = $el('div', { class: 'slideshow-controls slideshow-top' });
        const bottom = $el('div', { class: 'slideshow-controls slideshow-bottom' });
        const title = $el('div', { class: 'slideshow-title', 'aria-live': 'polite' });
        const counter = $el('div', { class: 'slideshow-count', 'aria-live': 'polite' });
        const fullscreenButton = $el('button', { type: 'button', 'aria-label': 'Tam ekrana geç', title: 'Tam ekran' }, '⛶');
        const controlsButton = $el('button', { type: 'button', 'aria-label': 'Kontrolleri gizle', title: 'Kontrolleri gizle' }, '◉');
        const previousButton = $el('button', { type: 'button', 'aria-label': 'Önceki görsel', title: 'Önceki görsel' }, '⏮');
        const playButton = $el('button', { type: 'button', 'aria-label': 'Slayt gösterisini oynat', title: 'Oynat' }, '▶');
        const nextButton = $el('button', { type: 'button', 'aria-label': 'Sonraki görsel', title: 'Sonraki görsel' }, '⏭');
        const interval = $el('input', { type: 'number', min: 1, max: 120, step: 1, value: 5, 'aria-label': 'Geçiş süresi saniye', title: 'Geçiş süresi (saniye)' });
        const secondsLabel = $el('span', { class: 'slideshow-seconds' }, 'sn');
        const loopInput = $el('input', { type: 'checkbox', checked: true, 'aria-label': 'Slaytı döngüde oynat' });
        const shuffleInput = $el('input', { type: 'checkbox', 'aria-label': 'Karışık sırayla göster' });
        const onlySelectedInput = $el('input', { type: 'checkbox', checked: onlySelectedStart, 'aria-label': 'Yalnız seçili görselleri göster' });
        const transitionSelect = $el('select', { class: 'slideshow-transition-select', 'aria-label': 'Geçiş efekti' });
        for (const [value, label] of [['crossfade','Yumuşak çapraz geçiş'],['push','Yatay kaydırma'],['zoom','Yumuşak yakınlaşma'],['none','Efekt yok']]) transitionSelect.appendChild($el('option', { value }, label));
        const checkLabel = (input, textValue) => { const label = $el('label'); label.append(input, $el('span', {}, textValue)); return label; };
        const slideshowSettings = $el('details', { class: 'slideshow-settings' });
        slideshowSettings.appendChild($el('summary', { 'aria-label': 'Slayt gösterisi seçenekleri' }, '⚙ Seçenekler'));
        const settingsBody = $el('div', { class: 'slideshow-settings-body' });
        settingsBody.append(checkLabel(loopInput, 'Döngü'), checkLabel(shuffleInput, 'Karışık sıra'), checkLabel(onlySelectedInput, 'Yalnız seçili görseller'));
        const transitionLabel = $el('label', { class: 'slideshow-transition-label' }); transitionLabel.append($el('span', {}, 'Geçiş efekti'), transitionSelect); settingsBody.appendChild(transitionLabel);
        slideshowSettings.appendChild(settingsBody);
        const selectCurrent = $el('button', { type: 'button', 'aria-label': 'Görseli seç', title: 'Görseli seç' }, '□');
        const zoomOut = $el('button', { type: 'button', 'aria-label': 'Uzaklaştır', title: 'Uzaklaştır' }, '−');
        const zoomReadout = $el('span', { class: 'slideshow-count', 'aria-label': 'Yakınlaştırma düzeyi' }, '100%');
        const zoomIn = $el('button', { type: 'button', 'aria-label': 'Yakınlaştır', title: 'Yakınlaştır (Ctrl + kaydırma)' }, '+');
        const zoomReset = $el('button', { type: 'button', 'aria-label': 'Akıllı sığdır', title: 'Akıllı sığdır (0)' }, '⤢');
        const openOriginal = $el('button', { type: 'button', 'aria-label': 'Orijinali yeni sekmede aç', title: 'Orijinali aç' }, '↗');
        const closeButton = $el('button', { type: 'button', 'aria-label': 'Slayt gösterisini kapat', title: 'Kapat' }, '×');
        const notice = $el('div', { class: 'slideshow-notice', role: 'status', hidden: true });
        const slideshowMeta = $el('div', { class: 'slideshow-meta' }); slideshowMeta.append(title, counter);
        const topActions = $el('div', { class: 'slideshow-top-actions' }); topActions.append(controlsButton, fullscreenButton, closeButton);
        top.append(slideshowMeta, topActions);
        bottom.append(previousButton, playButton, nextButton, interval, secondsLabel, zoomOut, zoomReadout, zoomIn, zoomReset, selectCurrent, openOriginal, slideshowSettings);
        overlay.append(transitionImage, image, top, bottom, notice);
        const priorInert = !!d.box.inert; d.box.inert = true; d.box.setAttribute('aria-hidden', 'true'); ui.appendChild(overlay);
        let visibleItems = [], index = 0, playing = false, playTimer = null, hideTimer = null, controlsLocked = false;
        let zoom = 1, panX = 0, panY = 0, panStart = null, imageGeneration = 0, closed = false, touchStart = null, lastWheelNavigation = 0, transitionDirection = 1, transitionAnimations = [];
        const getItems = () => onlySelectedInput.checked ? items.filter(item => item.selected) : items;
        const current = () => visibleItems[index] || null;
        const updateControlsButton = () => {
          const hidden = overlay.classList.contains('controls-hidden');
          controlsButton.setAttribute('aria-label', hidden ? 'Kontrolleri göster' : 'Kontrolleri gizle');
          controlsButton.title = hidden ? 'Kontrolleri göster' : 'Kontrolleri gizle';
        };
        const showControls = () => {
          if (controlsLocked) return;
          overlay.classList.remove('controls-hidden'); clearTimeout(hideTimer); updateControlsButton();
          if (playing) hideTimer = setTimeout(() => { overlay.classList.add('controls-hidden'); updateControlsButton(); }, 2600);
        };
        const enterClasses = ['slideshow-in-crossfade','slideshow-in-from-right','slideshow-in-from-left','slideshow-in-zoom'];
        const exitClasses = ['slideshow-out-to-left','slideshow-out-to-right','slideshow-out-zoom'];
        const clearSlideTransition = () => {
          for (const animation of transitionAnimations) { try { animation.cancel(); } catch {} }
          transitionAnimations = [];
          image.classList.remove(...enterClasses); transitionImage.classList.remove(...exitClasses);
          image.style.opacity = ''; image.style.translate = ''; image.style.scale = '';
          transitionImage.style.opacity = ''; transitionImage.style.translate = ''; transitionImage.style.scale = '';
          transitionImage.style.transform = ''; transitionImage.hidden = true;
        };
        const animateSlide = (direction, generation) => {
          image.classList.remove(...enterClasses); transitionImage.classList.remove(...exitClasses);
          const effect = transitionSelect.value;
          if (effect === 'none' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { clearSlideTransition(); return; }
          const animate = (node, keyframes, duration = 680) => {
            if (typeof node.animate !== 'function') return false;
            try {
              transitionAnimations.push(node.animate(keyframes, { duration, easing: 'cubic-bezier(.22,.68,.2,1)', fill: 'both' }));
              return true;
            } catch { return false; }
          };
          image.style.opacity = '';
          let supported = false;
          if (effect === 'crossfade') {
            supported = animate(image, [{ opacity: 0, filter: 'blur(5px)' }, { opacity: 1, filter: 'blur(0)' }], 720);
          } else if (effect === 'push') {
            const enter = direction >= 0 ? '100% 0' : '-100% 0';
            const exit = direction >= 0 ? '-100% 0' : '100% 0';
            const first = animate(image, [{ translate: enter }, { translate: '0 0' }]);
            const second = animate(transitionImage, [{ translate: '0 0' }, { translate: exit }]);
            supported = first && second;
          } else {
            const first = animate(image, [{ opacity: 0, scale: '.92' }, { opacity: 1, scale: '1' }], 760);
            const second = animate(transitionImage, [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '1.035' }], 760);
            supported = first && second;
          }
          if (!supported) {
            for (const animation of transitionAnimations) { try { animation.cancel(); } catch {} }
            transitionAnimations = [];
            void image.offsetWidth;
            if (effect === 'crossfade') image.classList.add('slideshow-in-crossfade');
            else if (effect === 'push') {
              image.classList.add(direction >= 0 ? 'slideshow-in-from-right' : 'slideshow-in-from-left');
              transitionImage.classList.add(direction >= 0 ? 'slideshow-out-to-left' : 'slideshow-out-to-right');
            } else { image.classList.add('slideshow-in-zoom'); transitionImage.classList.add('slideshow-out-zoom'); }
            return;
          }
          Promise.all(transitionAnimations.map(animation => animation.finished.catch(() => null))).then(() => {
            if (generation === imageGeneration) clearSlideTransition();
          });
        };
        image.addEventListener('animationend', event => { if (event.target === image) clearSlideTransition(); });
        const resetZoom = () => { zoom = 1; panX = 0; panY = 0; image.style.transform = ''; image.style.cursor = 'default'; zoomReadout.textContent = '100%'; };
        const applyZoom = () => {
          zoom = Math.max(1, Math.min(4, Math.round(zoom * 4) / 4));
          const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
          const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
          const maxX = Math.max(0, viewportWidth * (zoom - 1) / 2), maxY = Math.max(0, viewportHeight * (zoom - 1) / 2);
          panX = Math.max(-maxX, Math.min(maxX, panX)); panY = Math.max(-maxY, Math.min(maxY, panY));
          image.style.transform = zoom === 1 ? '' : `translate(${panX}px,${panY}px) scale(${zoom})`;
          image.style.cursor = zoom > 1 ? (panStart ? 'grabbing' : 'grab') : 'default';
          zoomReadout.textContent = `${Math.round(zoom * 100)}%`;
        };
        const fitSmart = () => {
          if (!image.naturalWidth || !image.naturalHeight) return;
          // Akıllı sığdırma: dikey boşluk bırakacak durumda ekranı doldurur, yatay kenarları kırpabilir.
          image.style.objectFit = smartFitMode(image.naturalWidth, image.naturalHeight, window.innerWidth || 1, window.innerHeight || 1);
          applyZoom();
        };
        const refreshList = keepCurrent => {
          const old = keepCurrent ? current() : null; visibleItems = getItems();
          const oldIndex = old ? visibleItems.indexOf(old) : -1;
          if (oldIndex >= 0) index = oldIndex;
          else index = visibleItems.length ? Math.min(Math.max(index, 0), visibleItems.length - 1) : -1;
          showSlide();
        };
        const updatePlayButton = () => {
          playButton.textContent = playing ? '⏸' : '▶';
          const label = playing ? 'Slayt gösterisini duraklat' : 'Slayt gösterisini oynat';
          playButton.setAttribute('aria-label', label); playButton.title = label;
        };
        const fullscreenTarget = () => ui.fullscreenElement || document.fullscreenElement;
        const isSlideshowFullscreen = () => {
          const target = fullscreenTarget();
          return ui.fullscreenElement === overlay || target === overlay || !!(target && overlay.contains(target)) ||
            (document.fullscreenElement === ui.host && ui.fullscreenElement === overlay);
        };
        const updateFullscreenButton = () => {
          const active = isSlideshowFullscreen();
          fullscreenButton.textContent = active ? '⤢' : '⛶';
          fullscreenButton.setAttribute('aria-label', active ? 'Tam ekrandan çık' : 'Tam ekrana geç');
          fullscreenButton.title = active ? 'Tam ekrandan çık' : 'Tam ekrana geç';
        };
        const stopPlayback = () => {
          playing = false; clearTimeout(playTimer); clearTimeout(hideTimer);
          if (!controlsLocked) overlay.classList.remove('controls-hidden');
          updatePlayButton(); updateControlsButton();
        };
        const updateSelectionControl = item => {
          selectCurrent.disabled = !item;
          if (!item) return;
          selectCurrent.textContent = item.selected ? '☑' : '□';
          selectCurrent.setAttribute('aria-label', item.selected ? 'Görselin seçimini kaldır' : 'Görseli seç');
          selectCurrent.title = item.selected ? 'Seçimi kaldır' : 'Görseli seç';
        };
        const updateSelectionSummary = () => {
          cachedSelectionList = selection();
          selectedMetric.textContent = String(cachedSelectionList.length);
          zip.disabled = !!zipController || !cachedSelectionList.length;
          text.value = cachedSelectionList.map(item => displayUrl(item.url, c)).join('\n');
        };
        function showSlide() {
          clearSlideTransition();
          visibleItems = getItems();
          if (visibleItems.length < 2 && playing) stopPlayback();
          if (!visibleItems.length || index < 0) {
            image.hidden = true; notice.hidden = false; notice.textContent = onlySelectedInput.checked ? 'Gösterilecek seçili görsel yok.' : 'Filtreyle eşleşen görsel yok.';
            title.textContent = 'Görsel yok'; counter.textContent = '0 / 0'; selectCurrent.disabled = true;
            previousButton.disabled = nextButton.disabled = playButton.disabled = openOriginal.disabled = true; updatePlayButton(); return;
          }
          image.hidden = false; notice.hidden = true;
          const item = current(); imageGeneration++; const generation = imageGeneration;
          const oldSrc = image.naturalWidth ? (image.currentSrc || image.src) : '';
          const hasOutgoingImage = !!oldSrc && oldSrc !== item.url && transitionSelect.value !== 'none';
          if (hasOutgoingImage) {
            transitionImage.src = oldSrc; transitionImage.style.objectFit = image.style.objectFit || 'contain';
            transitionImage.style.transform = image.style.transform || ''; transitionImage.hidden = false; image.style.opacity = '0';
          } else { transitionImage.hidden = true; image.style.opacity = ''; }
          image.onload = () => {
            if (generation !== imageGeneration) return;
            fitSmart(); if (hasOutgoingImage) animateSlide(transitionDirection, generation); else clearSlideTransition(); notice.hidden = true;
          };
          image.onerror = () => { if (generation === imageGeneration) { transitionImage.hidden = true; image.style.opacity = ''; notice.hidden = false; notice.textContent = 'Görsel yüklenemedi. Sonraki/önceki görsele geçebilir veya orijinali açabilirsin.'; } };
          image.alt = safeBaseName(item.url); image.style.objectFit = 'contain'; image.src = item.url;
          title.textContent = `${safeBaseName(item.url)}${item.width && item.height ? ` · ${item.width} × ${item.height}` : ''}`;
          counter.textContent = `${index + 1} / ${visibleItems.length}`;
          updateSelectionControl(item);
          previousButton.disabled = !loopInput.checked && !shuffleInput.checked && index === 0;
          nextButton.disabled = !loopInput.checked && !shuffleInput.checked && index === visibleItems.length - 1;
          playButton.disabled = visibleItems.length < 2; openOriginal.disabled = false;
          resetZoom(); updatePlayButton();
          if (image.complete && image.naturalWidth) fitSmart();
        }
        const schedulePlay = () => {
          clearTimeout(playTimer);
          if (!playing || visibleItems.length < 2) return;
          playTimer = setTimeout(() => { navigate(1, true); if (playing) schedulePlay(); }, Number(interval.value) * 1000);
        };
        const navigate = (direction, automatic = false) => {
          visibleItems = getItems(); if (visibleItems.length < 2) return;
          if (shuffleInput.checked && direction > 0) {
            if (!loopInput.checked && index >= visibleItems.length - 1) { if (automatic) stopPlayback(); return; }
            const candidates = visibleItems.map((_,i)=>i).filter(i=>i!==index); index = candidates[Math.floor(Math.random()*candidates.length)];
          } else {
            let next = index + direction;
            if (next < 0 || next >= visibleItems.length) {
              if (loopInput.checked) next = (next + visibleItems.length) % visibleItems.length;
              else { if (automatic) stopPlayback(); return; }
            }
            index = next;
          }
          transitionDirection = direction;
          showSlide(); if (!automatic) showControls(); if (playing && !automatic) schedulePlay();
        };
        const togglePlay = () => {
          if (visibleItems.length < 2) return;
          if (playing) stopPlayback(); else { playing = true; updatePlayButton(); showControls(); schedulePlay(); }
        };
        const close = async () => {
          if (closed) return; closed = true; playing = false; clearTimeout(playTimer); clearTimeout(hideTimer);
          document.removeEventListener('fullscreenchange', updateFullscreenButton); window.removeEventListener('resize', fitSmart);
          if (isSlideshowFullscreen()) try { await document.exitFullscreen(); } catch {}
          overlay.remove(); d.box.inert = priorInert; d.box.setAttribute('aria-hidden', 'false'); render(); scheduleSave();
          try { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); else slideshowLaunch.focus({ preventScroll: true }); } catch {}
        };
        const toggleFullscreen = async () => {
          try {
            if (isSlideshowFullscreen()) await document.exitFullscreen();
            else if (typeof overlay.requestFullscreen === 'function') await overlay.requestFullscreen();
            else { notice.hidden = false; notice.textContent = 'Bu tarayıcı gerçek tam ekran API’sini sunmuyor; görüntü yine ekranı kaplıyor.'; }
          } catch (error) { notice.hidden = false; notice.textContent = `Tam ekran açılamadı: ${error.message}`; }
          updateFullscreenButton();
        };
        visibleItems = getItems(); const firstIndex = visibleItems.indexOf(startItem); index = firstIndex >= 0 ? firstIndex : 0;
        closeButton.onclick = () => { void close(); }; fullscreenButton.onclick = () => { void toggleFullscreen(); };
        controlsButton.onclick = () => {
          if (overlay.classList.contains('controls-hidden')) { if (!controlsLocked) showControls(); }
          else { controlsLocked = true; clearTimeout(hideTimer); overlay.classList.add('controls-hidden'); updateControlsButton(); }
        };
        previousButton.onclick = () => navigate(-1); nextButton.onclick = () => navigate(1); playButton.onclick = togglePlay;
        const normalizeInterval = () => {
          let seconds = Number(interval.value); if (!Number.isFinite(seconds)) seconds = 5;
          seconds = Math.max(1, Math.min(120, Math.round(seconds))); interval.value = String(seconds);
          if (playing) schedulePlay(); showControls();
        };
        interval.onchange = normalizeInterval; interval.onblur = normalizeInterval;
        interval.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); normalizeInterval(); interval.blur(); } };
        loopInput.onchange = () => { showSlide(); showControls(); }; shuffleInput.onchange = () => { showSlide(); showControls(); };
        onlySelectedInput.onchange = () => { refreshList(true); showControls(); };
        selectCurrent.onclick = event => {
          event.preventDefault(); event.stopPropagation();
          const item = current(); if (!item) return;
          item.selected = !item.selected;
          updateSelectionControl(item); updateSelectionSummary();
          render(false); scheduleSave();
          if (onlySelectedInput.checked) refreshList(true);
          showControls();
        };
        zoomIn.onclick = () => { zoom += .25; applyZoom(); showControls(); };
        zoomOut.onclick = () => { zoom -= .25; applyZoom(); showControls(); };
        zoomReset.onclick = () => { resetZoom(); fitSmart(); showControls(); };
        openOriginal.onclick = () => { const item = current(); if (item) window.open(item.url, '_blank', 'noopener,noreferrer'); };
        image.onclick = showControls;
        image.onpointerdown = event => { if (zoom <= 1) return; panStart = { x:event.clientX, y:event.clientY, px:panX, py:panY }; image.setPointerCapture?.(event.pointerId); applyZoom(); };
        image.onpointermove = event => { if (!panStart) return; panX = panStart.px + event.clientX - panStart.x; panY = panStart.py + event.clientY - panStart.y; applyZoom(); };
        image.onpointerup = () => { panStart = null; applyZoom(); };
        overlay.addEventListener('pointermove', showControls, { passive:true });
        overlay.addEventListener('focusin', showControls);
        overlay.addEventListener('touchstart', event => { if (event.target === image && event.touches.length === 1) touchStart = {x:event.touches[0].clientX,y:event.touches[0].clientY}; }, {passive:true});
        overlay.addEventListener('touchend', event => {
          if (!touchStart || event.changedTouches.length !== 1) return;
          const dx=event.changedTouches[0].clientX-touchStart.x, dy=event.changedTouches[0].clientY-touchStart.y; touchStart=null;
          if (Math.abs(dx)>55 && Math.abs(dx)>Math.abs(dy)) navigate(dx<0?1:-1);
        }, {passive:true});
        overlay.addEventListener('wheel', event => {
          if (event.target.closest?.('.slideshow-controls')) return;
          event.preventDefault();
          if (event.ctrlKey) { zoom += event.deltaY < 0 ? .25 : -.25; applyZoom(); showControls(); return; }
          const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
          if (!delta) return;
          const now = Date.now(); if (now - lastWheelNavigation < 420) return;
          lastWheelNavigation = now; navigate(delta > 0 ? 1 : -1);
        }, {passive:false});
        overlay.addEventListener('keydown', event => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            if (overlay.classList.contains('controls-hidden')) { controlsLocked = false; showControls(); return; }
            void close(); return;
          }
          if (event.key === 'Tab') {
            const focusable=[...overlay.querySelectorAll('button:not(:disabled),select,input,summary')].filter(node=>node.getClientRects().length);
            if (!focusable.length) { event.preventDefault(); overlay.focus(); return; }
            if (event.shiftKey && (event.target===focusable[0] || !overlay.contains(event.target))) { event.preventDefault(); focusable.at(-1).focus(); }
            else if (!event.shiftKey && (event.target===focusable.at(-1) || !overlay.contains(event.target))) { event.preventDefault(); focusable[0].focus(); }
            return;
          }
          if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName || '')) return;
          if (event.key === 'ArrowRight') { event.preventDefault(); navigate(1); }
          else if (event.key === 'ArrowLeft') { event.preventDefault(); navigate(-1); }
          else if (event.key === 'Home') { event.preventDefault(); index=0; showSlide(); }
          else if (event.key === 'End') { event.preventDefault(); index=Math.max(0,visibleItems.length-1); showSlide(); }
          else if (event.key === ' ' && !/BUTTON/.test(event.target?.tagName || '')) { event.preventDefault(); togglePlay(); }
          else if (event.key.toLowerCase() === 'f') { event.preventDefault(); void toggleFullscreen(); }
          else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom+=.25; applyZoom(); }
          else if (event.key === '-') { event.preventDefault(); zoom-=.25; applyZoom(); }
          else if (event.key === '0') { event.preventDefault(); resetZoom(); fitSmart(); }
          else if (event.key.toLowerCase() === 'h') { event.preventDefault(); controlsButton.click(); }
          showControls();
        });
        document.addEventListener('fullscreenchange', updateFullscreenButton); window.addEventListener('resize', fitSmart, {passive:true});
        closeButton.focus({preventScroll:true}); refreshList(true); showControls();
      }
      slideshowLaunch.onclick = () => { const list=filtered(), selected=selection().filter(item=>list.includes(item)); openSlideshow(list, selected[0] || list[0], selected.length>0); };
      for (const control of [query, format, order, minW, minH, minMB, maxMB, ratio, known]) control.addEventListener('input', () => { grid.scrollTop = 0; render(); });
      previews.addEventListener('input', render);
      selectAll.onclick = () => { filtered().forEach(i => { i.selected = true; }); render(); scheduleSave(); };
      selectNone.onclick = () => { filtered().forEach(i => { i.selected = false; }); render(); scheduleSave(); };
      // Galeri varsayılan sekme. Bu noktadan önce activateTab çağrılamaz:
      // gövdesi openFilterDrawer/galleryPane gibi sonradan tanımlanan
      // const'lara dokunur ve erken çağrı TDZ ReferenceError üretir.
      tabsReady = true; activateTab(0);
      render();
      const reportCopy = async value => { try { await copyText(value); status.textContent = '✅ Kopyalandı.'; } catch (e) { status.textContent = '❌ ' + e.message; } };
      copy.onclick = () => reportCopy(text.value);
      copySize.onclick = () => reportCopy(selection().map(i => `${displayUrl(i.url, c)}  (gerçek: ${i.width || '?'} × ${i.height || '?'}${i.displayWidth || i.displayHeight ? `; HTML: ${i.displayWidth || '?'} × ${i.displayHeight || '?'}` : ''})`).join('\n'));
      txt.onclick = () => saveBlob(new Blob([text.value], { type: 'text/plain;charset=utf-8' }), `images_${Date.now()}.txt`);
      const records = () => selection().map((img, i) => ({ sira: i + 1, url: img.url, kaynak_sayfa: img.page || '', gercek_genislik: img.width || null, gercek_yukseklik: img.height || null, html_genislik: img.displayWidth || null, html_yukseklik: img.displayHeight || null, boyut_bayt: img.bytes || null, tur: img.ext || kind(img), durum: img.status, hata: img.error || '' }));
      json.onclick = () => saveBlob(new Blob([JSON.stringify(records(), null, 2)], { type: 'application/json;charset=utf-8' }), 'image-scraper-rapor.json');
      diagnostics.onclick = () => {
        const summary = buildDiagnosticSummary(result, c, images);
        saveBlob(new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json;charset=utf-8' }), 'image-scraper-tanilama.json');
      };
      csv.onclick = () => {
        const rows = records(), keys = ['sira','url','kaynak_sayfa','gercek_genislik','gercek_yukseklik','html_genislik','html_yukseklik','boyut_bayt','tur','durum','hata'];
        const quote = value => { let t = String(value ?? ''); if (/^[=+@\-\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
        saveBlob(new Blob(['\ufeff' + [keys.map(quote).join(','), ...rows.map(r => keys.map(k => quote(r[k])).join(','))].join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'image-scraper-rapor.csv');
      };
      cancel.onclick = () => zipController?.abort();
      d.setOnClose(() => { galleryClosed = true; grid.removeEventListener('scroll', scheduleGalleryRender); window.removeEventListener('resize', scheduleGalleryRender); zipController?.abort(); clearTimeout(saveTimer); if (remember) persist(); objectUrls.forEach(URL.revokeObjectURL); });
      // ---------------------------------------------------------------------
      // ZIP aşamaları: kullanıcı "🗜️ ZIP 1/1 · 0%" gibi tek satırlık bir
      // mesajla baş başa kalıyordu ve işlemin nerede olduğunu anlayamıyordu.
      // Artık her aşama ayrı gösterilir; ayrıca uzun süre ilerleme gelmezse
      // "takıldı" durumu ve iptal/tekrar dene yolu sunulur.
      // ---------------------------------------------------------------------
      const zipStages = [
        ['download', '⬇️ İndirme'],
        ['analysis', '🧩 Benzerlik analizi'],
        ['dedupe', '🔍 Tekilleştirme'],
        ['archive', '🗜️ Arşiv oluşturma'],
        ['verify', '🔎 Doğrulama'],
        ['ready', '✅ Hazır'],
      ];
      const stageBar = $el('div', { class: 'zip-stages', role: 'group', 'aria-label': 'ZIP aşamaları' });
      for (const [key, label] of zipStages) {
        stageBar.appendChild($el('span', { class: 'zip-stage', 'data-stage': key }, label));
      }
      const stallBox = $el('div', { class: 'zip-stall', role: 'alert' });
      const stallText = $el('span', {});
      const retryFailedButton = $el('button', { type: 'button', class: 'secondary' }, '↻ Yalnızca başarısızları yeniden dene');
      const retryZipButton = $el('button', { type: 'button', class: 'secondary' }, '↻ ZIP’i yeniden dene');
      stallBox.append(stallText, retryFailedButton, retryZipButton);
      progress.after(stallBox); progress.after(stageBar);

      let activeStage = null, lastProgressAt = 0, stallTimer = null, failedItems = [], zipVerification = '';
      const STALL_MS = 20000;
      const setStage = key => {
        activeStage = key;
        lastProgressAt = Date.now();
        for (const node of stageBar.querySelectorAll('.zip-stage')) {
          const isDone = zipStages.findIndex(([k]) => k === key) > zipStages.findIndex(([k]) => k === node.dataset.stage);
          node.classList.toggle('is-active', node.dataset.stage === key);
          node.classList.toggle('is-done', isDone);
        }
        stageBar.hidden = !key;
      };
      const touchProgress = () => { lastProgressAt = Date.now(); stallBox.hidden = true; };
      const stopStallWatch = () => { clearInterval(stallTimer); stallTimer = null; stallBox.hidden = true; };
      const startStallWatch = () => {
        lastProgressAt = Date.now();
        clearInterval(stallTimer);
        stallTimer = setInterval(() => {
          if (!activeStage || activeStage === 'ready' || zipController === null) return;
          const idle = Date.now() - lastProgressAt;
          if (idle < STALL_MS) return;
          const label = zipStages.find(([k]) => k === activeStage)?.[1] || activeStage;
          stallText.textContent = `${label} adımı ${Math.round(idle / 1000)} sn’dir ilerlemiyor. ` +
            'İptal edip tekrar deneyebilirsin; büyük arşivlerde tarayıcı belleği dolduğunda bu olabilir ' +
            '(parça başına MB sınırını düşürmeyi dene).';
          stallBox.hidden = false;
          // İptal her zaman, yeniden deneme yalnızca işlem bittiğinde anlamlı.
          retryZipButton.hidden = false;
          retryFailedButton.hidden = failedItems.length === 0;
        }, 1000);
      };

      // "Yalnızca başarısızları yeniden dene": başarılı görseller önbellekten
      // (downloaded Map) kullanılır, yalnızca hatalılar yeniden indirilir.
      // Tüm arşivi yeniden indirmek büyük oturumlarda dakikalar sürüyordu.
      retryFailedButton.onclick = () => {
        if (!failedItems.length || zipController) return;
        for (const img of failedItems) img.selected = true;
        for (const img of images) if (!failedItems.includes(img)) img.selected = false;
        failedItems = [];
        retryFailedButton.hidden = true;
        zip.onclick();
      };
      retryZipButton.onclick = () => { if (!zipController) { retryZipButton.hidden = true; zip.onclick(); } };

      zip.onclick = async () => {
        if (zipController) return;
        const selected = selection(); if (!selected.length) return;
        zipController = new AbortController(); const signal = zipController.signal;
        zip.disabled = true; cancel.hidden = false; progress.hidden = false; progress.value = 0;
        failedItems = []; zipVerification = ''; retryFailedButton.hidden = true; retryZipButton.hidden = true;
        setStage('download'); startStallWatch();
        let same = 0, gm = 0, cached = 0, failed = 0, bytesTotal = 0;
        const errors = [], verificationUrls = new Map();
        details.hidden = true; errorList.textContent = ''; verifyLinks.replaceChildren();
        objectUrls.splice(0).forEach(URL.revokeObjectURL); manual.replaceChildren();
        try {
          let streamingDirectory = null;
          if (c.STREAM_ZIP_TO_DISK) {
            if (typeof window.showDirectoryPicker === 'function') {
              status.textContent = '📁 ZIP akışı için hedef klasörü seç…';
              streamingDirectory = await window.showDirectoryPicker({ mode: 'readwrite' });
            } else status.textContent = 'Bu tarayıcı klasöre akış yazmayı desteklemiyor; standart ZIP indirmesi kullanılacak.';
          }
          const results = new Array(selected.length);
          const downloadStartedAt = Date.now();
          await adaptivePool(selected, c.ZIP_CONCURRENT, async (img, i) => {
            try {
              let item = downloaded.get(img.url);
              if (item) cached++;
              else {
                const result = await downloadImageRetry(img.url, c, signal);
                checkAbort(signal); const ext = await imageFormat(result.blob);
                if (!ext) throw new Error('Yanıt tanınan bir resim formatı değil');
                if ((!img.width || !img.height) && typeof createImageBitmap === 'function') {
                  try { const bitmap = await createImageBitmap(result.blob); img.width = bitmap.width; img.height = bitmap.height; bitmap.close(); } catch {}
                }
                const data = await result.blob.arrayBuffer(); checkAbort(signal);
                item = { data, ext }; downloaded.set(img.url, item); retainedImageBytes += data.byteLength;
                if (result.method === 'same') same++; else gm++;
              }
              img.status = 'başarılı'; img.error = ''; img.bytes = item.data.byteLength; img.ext = item.ext;
              results[i] = item; bytesTotal += item.data.byteLength;
            } catch (e) {
              if (isAbort(e)) throw e;
              failed++; img.status = 'hata'; img.error = e.message; errors.push(`${img.url} — ${e.message}`); failedItems.push(img);
              if (e.challenge) verificationUrls.set(new URL(img.url).origin, img.url);
              console.warn('[Image Scraper]', img.url, e);
            }
            scheduleSave();
          }, (done, total, state) => { touchProgress(); progress.value = Math.round(done / total * 75); const eta = etaLabel(done, total, downloadStartedAt); status.textContent = `⬇️ ${done}/${total} · yeni: ${same + gm} · önbellek: ${cached} · hata: ${failed}${eta ? ` · ${eta}` : ''}`; updateResourceStatus(state.active, state.limit, done, total, downloadStartedAt); }, signal, adaptiveConcurrency);
          checkAbort(signal); render();
          if (c.GROUP_VISUAL_SIMILARITY) {
            setStage('analysis'); touchProgress(); status.textContent = '🧩 Benzer görseller karşılaştırılıyor…';
            const indexedHashes = [];
            const analysisLimit = Math.min(results.length, 1000);
            for (let i = 0; i < analysisLimit; i++) {
              checkAbort(signal);
              if (i % 50 === 0) { status.textContent = `🧩 Benzer görseller karşılaştırılıyor: ${i}/${analysisLimit}`; await new Promise(resolve => setTimeout(resolve, 0)); }
              if (!results[i]) continue;
              const hash = await perceptualHash(results[i].data);
              if (hash) indexedHashes.push({ index: i + 1, hash });
            }
            const groups = [];
            for (const item of indexedHashes) {
              let group = groups.find(candidate => hashDistance(candidate.hash, item.hash) <= 6);
              if (!group) groups.push(group = { hash: item.hash, indices: [] });
              group.indices.push(item.index);
            }
            const similar = groups.filter(group => group.indices.length > 1);
            const report = $el('details'); report.appendChild($el('summary', {}, `Algısal benzerlik grupları (${similar.length})`));
            if (similar.length) for (const [i, group] of similar.entries()) report.appendChild($el('p', { class: 'muted' }, `Grup ${i + 1}: seçili görseller ${group.indices.join(', ')}`));
            else report.appendChild($el('p', { class: 'muted' }, indexedHashes.length ? 'Eşik içinde benzer grup bulunmadı.' : 'Tarayıcı bu görseller için algısal hash hesaplayamadı.'));
            if (results.length > analysisLimit) report.appendChild($el('p', { class: 'muted' }, 'Performans için yalnızca ilk 1000 başarılı öğe karşılaştırıldı.'));
            report.appendChild($el('p', { class: 'muted' }, 'Bu gruplama öneri amaçlıdır; benzer görseller otomatik silinmedi ve ZIP’ten çıkarılmadı.'));
            manual.appendChild(report);
          }
          if (errors.length) {
            details.hidden = false; errorList.textContent = errors.join('\n');
            if (verificationUrls.size) {
              verifyLinks.appendChild($el('p', { class: 'muted' }, 'Doğrulamayı tamamlayıp ZIP’e tekrar basın; başarılı görseller yeniden indirilmez.'));
              for (const [origin, url] of verificationUrls) {
                const a = linkOrText({ class: 'verification-link', href: url, target: '_blank', rel: 'noopener noreferrer' }, `🔐 Doğrula / görseli aç: ${origin}`);
                verifyLinks.appendChild(a);
              }
            }
          }
          if (!same && !gm && !cached) throw new Error('Hiçbir resim indirilemedi. Hata ayrıntılarını kontrol edin.');
          const digits = Math.max(3, String(selected.length).length), files = [], hashes = new Map(), names = new Set();
          for (let i = 0; i < results.length; i++) {
            const item = results[i]; if (!item) continue;
            if (c.DEDUPE_CONTENT) {
              if (!globalThis.crypto?.subtle) throw new Error('İçerik karşılaştırma için güvenli bağlantı (HTTPS) gerekiyor.');
              const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', item.data))].map(x => x.toString(16).padStart(2, '0')).join('');
              if (hashes.has(hash)) {
                selected[i].status = 'aynı içerik — ZIP’ten atlandı';
                const firstIndex = hashes.get(hash), pair = { keptUrl:selected[firstIndex].url, skippedUrl:selected[i].url };
                if (!contentDuplicatePairs.some(entry => entry.keptUrl === pair.keptUrl && entry.skippedUrl === pair.skippedUrl)) contentDuplicatePairs.push(pair);
                renderContentDuplicatePairs(); scheduleSave(); continue;
              }
              hashes.set(hash, i);
            }
            const img = selected[i];
            const values = { sira: String(i + 1).padStart(digits, '0'), sayfa: String(Math.max(1, pages.indexOf(img.page) + 1)), orijinal_ad: safeBaseName(img.url), boyut: img.width && img.height ? `${img.width}x${img.height}` : 'bilinmiyor' };
            const base = (c.NAME_TEMPLATE || DEFAULTS.NAME_TEMPLATE).replace(/\{(sira|sayfa|orijinal_ad|boyut)\}/g, (_, k) => values[k]);
            const name = zipEntryName(base, item.ext, names); files.push({ name, data: item.data });
          }
          if (errors.length) files.push({ name: names.has('_indirme_hatalari.txt') ? '_indirme_hatalari_rapor.txt' : '_indirme_hatalari.txt', data: new TextEncoder().encode(errors.join('\n')) });
          // ZIP32 uyumu ve kullanıcı limiti: dosyalar ancak tam dosya sınırından bölünebilir.
          const parts = []; let part = [], size = 0;
          for (const file of files) {
            const n = file.data.byteLength;
            if (n >= 0xffffffff - 1048576) throw new Error('Tek bir dosya ZIP32 sınırını aşıyor.');
            if (part.length && (part.length >= c.PART_MAX_FILES || size + n > c.PART_MAX_MB * 1048576)) { parts.push(part); part = []; size = 0; }
            part.push(file); size += n;
          }
          if (part.length) parts.push(part);
          setStage('dedupe'); touchProgress();
          const zipStartedAt = Date.now(), zipTotalBytes = files.reduce((sum, file) => sum + file.data.byteLength, 0);
          setStage('archive'); touchProgress();
          let zipDoneBytes = 0;
          for (let p = 0; p < parts.length; p++) {
            const currentPartBytes = parts[p].reduce((sum, file) => sum + file.data.byteLength, 0);
            const reportZipProgress = pct => {
              touchProgress();
              progress.value = 75 + Math.round((p + pct / 100) / parts.length * 25);
              const doneBytes = zipDoneBytes + currentPartBytes * pct / 100;
              const eta = etaLabel(doneBytes, zipTotalBytes, zipStartedAt);
              status.textContent = `🗜️ ZIP ${p + 1}/${parts.length} · ${Math.floor(pct)}% · ${(bytesTotal / 1048576).toFixed(1)} MB${eta ? ` · ${eta}` : ''}`;
            };
            status.textContent = `🗜️ ZIP ${p + 1}/${parts.length} · 0% · ${(bytesTotal / 1048576).toFixed(1)} MB`;
            const proposedName = parts.length > 1 ? zipName(c.ZIP_FILENAME).replace(/\.zip$/i, `-part-${String(p + 1).padStart(2, '0')}.zip`) : zipName(c.ZIP_FILENAME);
            if (streamingDirectory) {
              const { handle, name } = await createUniqueZipFile(streamingDirectory, proposedName);
              const writable = await handle.createWritable(); let archiveBytes;
              try { archiveBytes = await generateZipToWritable(parts[p], writable, signal, reportZipProgress); await writable.close(); }
              catch (error) { try { await writable.abort(error); } catch {} throw error; }
              manual.appendChild($el('p', { class: 'muted' }, `✅ Klasöre yazıldı: ${name} · ${formatBytes(archiveBytes)}`));
            } else {
              const blob = await generateZipBlob(parts[p], signal, reportZipProgress);
              checkAbort(signal);
              // Bütünlük kontrolü (isteğe bağlı): bozuk arşivi "başarılı" diye
              // sunmak yerine açık hata ver. Bellek maliyeti nedeniyle kapalı
              // varsayılandadır; açıksa baytlar bir kez okunur.
              if (c.VERIFY_ZIP) {
                setStage('verify'); touchProgress(); status.textContent = '🔎 Arşiv bütünlüğü doğrulanıyor…';
                const bytes = new Uint8Array(await blob.arrayBuffer());
                const verdict = verifyZipBytes(bytes, parts[p].length);
                if (!verdict.ok) throw new Error('ZIP doğrulaması başarısız: ' + verdict.problems.join(' '));
                zipVerification = `${verdict.entries} dosya · ${(verdict.byteLength / 1048576).toFixed(1)} MB doğrulandı`;
              }
              const url = URL.createObjectURL(blob); objectUrls.push(url);
              const link = $el('a', { class: 'download-link', href: url, download: proposedName }, `⬇ ${proposedName} (${formatBytes(blob.size)})`);
              manual.appendChild(link); manual.appendChild($el('span', {}, ' '));
              if (parts.length === 1) link.click();
            }
            zipDoneBytes += currentPartBytes;
          }
          progress.value = 100; render(); scheduleSave();
          setStage('ready'); stopStallWatch(); retryZipButton.hidden = true; retryFailedButton.hidden = failedItems.length === 0;
          status.textContent = `✅ ${parts.length} ZIP ${streamingDirectory ? 'seçilen klasöre akışla yazıldı' : 'hazır'} · ${same + gm + cached} indirildi · ${failed} hata${zipVerification ? ` · ${zipVerification}` : ''}. ${streamingDirectory ? 'ZIP arşivinin ek kopyası bellekte oluşturulmadı; görsel verileri bellekte tutulur.' : parts.length > 1 ? 'Her parçayı aşağıdan ayrı indirin.' : 'İndirme başlamazsa bağlantıya tıklayın.'}`;
        } catch (e) {
          stopStallWatch();
          status.textContent = isAbort(e) ? '⏹️ ZIP işlemi iptal edildi.' : '❌ ' + e.message;
          if (!isAbort(e)) { console.error('[Image Scraper]', e); retryZipButton.hidden = false; }
          else retryZipButton.hidden = false;
        } finally { zipController = null; render(); cancel.hidden = true; }
      };
    }
  };
})(globalThis);
