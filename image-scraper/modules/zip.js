/* ZIP/archive and filename module. Loaded before app.js by Tampermonkey. */
(function (global) {
  const modules = global.ImageScraperModules || (global.ImageScraperModules = Object.create(null));
  modules.createZipModule = function createZipModule(deps) {
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
    function zipEntryName(value, extension, usedNames) {
      let base = String(value ?? '').replace(/[\\/<>:"|?*\x00-\x1f\x7f]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 150) || 'image';
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = '_' + base;
      let name = `${base}.${extension}`, suffix = 2;
      while (usedNames.has(name.toLowerCase())) name = `${base}_${suffix++}.${extension}`;
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
    return { safeBaseName, zipName, zipEntryName, createUniqueZipFile, saveBlob, buildZip, consumeZipStream, generateZipBlob, generateZipToWritable };
  };
})(globalThis);
