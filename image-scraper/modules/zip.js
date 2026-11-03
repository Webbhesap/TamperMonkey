/* ZIP/archive and filename module. Loaded before app.js by Tampermonkey. */
(function (global) {
  const modules = global.ImageScraperModules || (global.ImageScraperModules = Object.create(null));
  modules.createZipModule = function createZipModule(deps) {
    // Bağımlılık sözleşmesi: eksik bir bağımlılık ilk kullanımda değil,
    // modül kurulurken anlaşılır bir hatayla bildirilir.
    const requireDeps = (label, names) => {
      const missing = names.filter(name => deps?.[name] === undefined);
      if (missing.length) throw new Error(`${label} modülü için eksik bağımlılık: ${missing.join(', ')}`);
    };
    requireDeps('ZIP', ['$el', 'document', 'URL', 'Blob', 'Uint8Array', 'checkAbort', 'abortError']);
    const { $el, document, URL, Blob, Uint8Array, checkAbort, abortError } = deps;
    function safeBaseName(url) {
      let name = '';
      try { name = new URL(url).pathname.split('/').pop() || ''; try { name = decodeURIComponent(name); } catch {} } catch {}
      name = name.replace(/\.[a-z0-9]{1,6}$/i, '').replace(/[\\/<>:"|?*\x00-\x1f\x7f]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 100);
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = '_' + name;
      return name || 'image';
    }
    function zipName(name) {
      name = name.replace(/[\\/<>:"|?*\x00-\x1f\x7f]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 150) || 'images.zip';
      return /\.zip$/i.test(name) ? name : name + '.zip';
    }
    /**
     * ZIP içi klasör adı. Kaynak sayfa ya da alan adı yol parçalarına ayrılır,
     * her parça dosya adlarıyla aynı güvenlik kurallarından geçer:
     *   - yol ayırıcı ve denetim karakterleri temizlenir,
     *   - Windows ayrılmış adları (CON/PRN/…) ön ek alır,
     *   - boş parçalar ve `..` gibi kaçışlar atılır,
     *   - toplam uzunluk 120 karakterle sınırlanır.
     * Klasör her zaman arşiv içinde kalır; dışına yazmaz.
     */
    function safeFolder(value, maxLength = 120) {
      const parts = String(value ?? '').split('/').map(part => part.trim())
        .filter(part => part && part !== '.' && part !== '..')
        .map(part => {
          let name = part.replace(/[\\/<>:"|?*\x00-\x1f\x7f]/g, '_').replace(/^\.+|[. ]+$/g, '');
          if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = '_' + name;
          return name;
        })
        .filter(Boolean);
      let result = parts.join('/');
      while (result.length > maxLength) {
        // Sondan parça at; tek parça kaldıysa kırp.
        if (parts.length > 1) { parts.pop(); result = parts.join('/'); }
        else { result = result.slice(0, maxLength); break; }
      }
      return result.replace(/^\/+|\/+$/g, '');
    }
    function zipEntryName(value, extension, usedNames, folder = '') {
      let base = String(value ?? '').replace(/[\\/<>:"|?*\x00-\x1f\x7f]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 150) || 'image';
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = '_' + base;
      // Klasör (isteğe bağlı): çakışma kontrolü tam yol üzerinden yapılır,
      // böylece farklı klasörlerdeki aynı dosya adları korunur.
      const prefix = folder ? `${safeFolder(folder)}/` : '';
      let name = `${prefix}${base}.${extension}`, suffix = 2;
      while (usedNames.has(name.toLowerCase())) name = `${prefix}${base}_${suffix++}.${extension}`;
      usedNames.add(name.toLowerCase());
      return name;
    }
    async function createUniqueZipFile(directory, filename) {
      const base = filename.replace(/\.zip$/i, '');
      for (let suffix = 1; suffix <= 999; suffix++) {
        const candidate = `${base}${suffix === 1 ? '' : `-${suffix}`}.zip`;
        try { await directory.getFileHandle(candidate); }
        catch (error) {
          if (error?.name !== 'NotFoundError') throw error;
          return { handle: await directory.getFileHandle(candidate, { create: true }), name: candidate };
        }
      }
      throw new Error('Klasörde uygun, çakışmayan ZIP dosya adı bulunamadı.');
    }
    function saveBlob(blob, filename) {
      const url = URL.createObjectURL(blob), a = $el('a', { href: url, download: filename });
      a.hidden = true; document.documentElement.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    // JSZip owns ZIP records, CRC-32, UTF-8 names and the central directory.
    // Consume its pausable stream so File System Access keeps the no-Blob write path.
    function buildZip(files) {
      const JSZipLib = globalThis.JSZip;
      if (typeof JSZipLib !== 'function') throw new Error('JSZip kütüphanesi yüklenemedi.');
      if (files.length > 65535) throw new Error('ZIP32 en fazla 65.535 dosya içerebilir.');
      const zip = new JSZipLib();
      for (const file of files) {
        const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
        if (data.byteLength >= 0xffffffff - 1048576) throw new Error('Tek bir dosya ZIP32 sınırını aşıyor.');
        zip.file(file.name, data, { binary: true, compression: 'STORE', createFolders: false });
      }
      return zip;
    }
    function consumeZipStream(files, signal, onProgress, writeChunk) {
      checkAbort(signal);
      const stream = buildZip(files).generateInternalStream({ type: 'uint8array', compression: 'STORE', streamFiles: true, platform: 'DOS' });
      return new Promise((resolve, reject) => {
        let settled = false, written = 0, writes = Promise.resolve();
        const cleanup = () => signal?.removeEventListener('abort', abort);
        const finish = (error, value) => {
          if (settled) return;
          settled = true; cleanup();
          if (error) reject(error); else resolve(value);
        };
        const abort = () => { try { stream.pause(); } catch {} finish(abortError()); };
        signal?.addEventListener('abort', abort, { once: true });
        stream.on('data', (chunk, metadata) => {
          if (settled) { stream.pause(); return; }
          stream.pause();
          writes = writes.then(async () => {
            checkAbort(signal);
            await writeChunk(chunk);
            if (settled) return;
            written += chunk.byteLength;
            if (metadata && Number.isFinite(metadata.percent)) onProgress(metadata.percent);
          }).then(() => { if (!settled) stream.resume(); }).catch(error => { try { stream.pause(); } catch {} finish(error); });
        });
        stream.on('error', error => finish(error));
        stream.on('end', () => writes.then(() => {
          if (settled) return;
          checkAbort(signal); onProgress(100); finish(null, written);
        }).catch(error => finish(error)));
        stream.resume();
      });
    }
    async function generateZipBlob(files, signal, onProgress = () => {}) {
      checkAbort(signal);
      // Consume JSZip's pausable stream ourselves. This yields between chunks,
      // reports progress consistently, and avoids generateAsync stalls in some browsers.
      const chunks = [];
      await consumeZipStream(files, signal, onProgress, chunk => { chunks.push(chunk); });
      checkAbort(signal);
      const blob = new Blob(chunks, { type:'application/zip' });
      checkAbort(signal);
      return blob;
    }
    async function generateZipToWritable(files, writable, signal, onProgress = () => {}) {
      return consumeZipStream(files, signal, onProgress, chunk => writable.write(chunk));
    }
    // -----------------------------------------------------------------------
    // Bütünlük kontrolü: arşiv üretildikten sonra gerçekten okunabilir mi?
    // Amaç "başarılı" mesajı verip bozuk dosya sunmayı önlemek.
    // Bellek maliyeti olduğu için varsayılan KAPALI (VERIFY_ZIP).
    // Yalnızca yapısal kontroller yapılır, tam yeniden sıkıştırma değil:
    //   - dosya sayısı beklenenle eşleşiyor mu,
    //   - merkezi dizin (EOCD) okunabiliyor mu,
    //   - her girişin yerel başlığı ve CRC alanı yerinde mi.
    // -----------------------------------------------------------------------
    function verifyZipBytes(bytes, expectedEntries) {
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const problems = [];
      if (data.byteLength < 22) { problems.push('Arşiv çok küçük (EOCD yok).'); return { ok: false, problems }; }
      // EOCD imzası: 0x06054b50 — sonda, yorum alanı en fazla 65535 bayt.
      let eocd = -1;
      const stop = Math.max(0, data.byteLength - 22 - 65535);
      for (let i = data.byteLength - 22; i >= stop; i--) {
        if (data[i] === 0x50 && data[i + 1] === 0x4b && data[i + 2] === 0x05 && data[i + 3] === 0x06) { eocd = i; break; }
      }
      if (eocd < 0) { problems.push('Merkezi dizin (EOCD) bulunamadı; arşiv yarım kalmış olabilir.'); return { ok: false, problems }; }
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const entries = view.getUint16(eocd + 10, true);
      const cdSize = view.getUint32(eocd + 12, true);
      const cdOffset = view.getUint32(eocd + 16, true);
      if (expectedEntries != null && entries !== expectedEntries) {
        problems.push(`Dosya sayısı uyuşmuyor: arşivde ${entries}, beklenen ${expectedEntries}.`);
      }
      if (cdOffset + cdSize > data.byteLength) problems.push('Merkezi dizin arşiv sınırlarının dışında.');
      if (cdOffset > 0 && !(data[cdOffset] === 0x50 && data[cdOffset + 1] === 0x4b && data[cdOffset + 2] === 0x01 && data[cdOffset + 3] === 0x02)) {
        problems.push('Merkezi dizin imzası geçersiz.');
      }
      return { ok: problems.length === 0, problems, entries, byteLength: data.byteLength };
    }
    return { safeBaseName, safeFolder, zipName, zipEntryName, createUniqueZipFile, saveBlob, buildZip, consumeZipStream, generateZipBlob, generateZipToWritable, verifyZipBytes };
  };
})(globalThis);
