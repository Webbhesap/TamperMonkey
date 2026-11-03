# Image Scraper — tamamlanan özellikler ve düzeltmeler

Bu dosya **yapılmış işlerin kaydıdır**. Yapılacaklar için
[`ozellik-onerileri.md`](ozellik-onerileri.md) dosyasına bakın.

Bir öneri uygulandığında `ozellik-onerileri.md`'den çıkarılıp buraya tarihiyle
eklenir. Amaç: hangi işin bittiğini tek bakışta görmek.

---

## 2026-11-03 — Arayüz yenilemesi ve ZIP görünürlüğü

### Tasarım ve kullanım kolaylığı
- **Tasarım belirteçleri (`--isp-*`):** Ölçek, renk, yarıçap ve dokunma
  hedefi tek yerden yönetiliyor (`styles.css` `:host`).
- **Ayarlar sekmesi şeridi:** 7 sekme tek satırda 926px yer kaplıyor, 820px
  altında 2–3 satıra kırılıyordu. Artık sabit yükseklikte, yatay
  kaydırılabilir, `scroll-snap` destekli şerit; her genişlikte **1 satır**
  (480px'de 3 → 1).
- **Sabit yükseklikte ayarlar diyaloğu:** Arama/sekme geçişinde içerik
  uzayınca diyalog büyüyor (`clientHeight 642 → 702`), aşağı kayıp başlık
  ekrandan çıkıyordu. Artık yükseklik sabit (`min(88dvh, 900px)`); yalnızca
  gövde kayar, başlık ve sekme şeridi yerinde kalır.
- **Ayar arama:** 30+ ayarı sekme sekme gezmek yerine yazarak bulma.
  - İlgili sekmeye atlar, eşleşen satırı vurgular, eşleşmeyenleri
    soluklaştırır (gizlemez — ayarın bağlamı korunur).
  - Türkçe karakter katlama: `sablon` → `şablon` bulunur.
  - `Escape` ve `×` ile temizlenir; sonuç sayısı `aria-live` ile bildirilir.
- **Dokunma hedefleri:** Onay kutusu 19 → 22px, form kontrolleri 38px,
  yardım balonu 16 → 20px. Yardım balonu artık `:active` ile dokunmatikte de
  açılıyor (önceden yalnızca `:hover`/`:focus-visible`) ve ekran kenarından
  taşmıyor.
- **Sonuç ekranı, dar ekran:** 800px'de başlık altı satıra sarıp metrik
  kartlarının altına giriyor, "Seçili görsel" etiketi kesiliyordu.
  1000px altında başlık kendi satırını alır, metrikler altında akar,
  kapatma düğmesi köşeye sabitlenir.
- **Küçük ekran düzenleri:** 640px ve 520px kırılımları; galeri 150px
  kolonlara iner, kart yüksekliği 280px, etiket/kontrol hizalaması düzeltilir.
- **Erişilebilirlik tercihleri:** `prefers-reduced-motion` (animasyonlar
  kapanır) ve `prefers-contrast: more` (kenarlık ve metin kontrastı artar).
- **Denenip geri alınan:** Sabit (sticky) ayarlar altbilgisi. 480px'de
  ekranın ~%22'sini kaplayıp alttaki ayarları örtüyordu; normal akışa
  döndürüldü (gerekçe kodda yorum olarak duruyor).

### ZIP görünürlüğü (öneri listesinden tamamlandı)
- **ZIP aşama göstergesi:** Tek satırlık "🗜️ ZIP 1/1 · 0% · 15.5 MB" mesajı
  işlemin nerede olduğunu göstermiyordu. Artık beş rozet:
  `İndirme → Benzerlik analizi → Tekilleştirme → Arşiv oluşturma → Hazır`.
  Geçmiş aşamalar ✓, etkin aşama ● (nabız animasyonu).
- **Takılma tespiti:** 20 sn ilerleme gelmezse hangi adımda takıldığı, geçen
  süre ve olası neden (bellek baskısı, parça sınırı önerisi) yazılır;
  "İptal" ve "ZIP'i yeniden dene" sunulur. İlerleme gelince sayaç sıfırlanır.
- **Yalnızca başarısızları yeniden dene:** Hatalı görseller biriktirilir;
  yeniden denemede yalnızca onlar indirilir, başarılılar önbellekten gelir.
  Tüm arşivi yeniden indirmek büyük oturumlarda dakikalar sürüyordu.

- **ZIP bütünlük kontrolü (isteğe bağlı):** Arşiv üretildikten sonra dosya
  sayısı ve ZIP merkezi dizini (EOCD) doğrulanır; bozuksa "başarılı" mesajı
  verilmez, açık hata çıkar. Bellek maliyeti nedeniyle varsayılan **kapalı**
  (`VERIFY_ZIP`). Doğrulayıcı gerçek/kesik/çöp arşivi ayırt ediyor:
  kesik → "EOCD bulunamadı", yanlış sayı → "dosya sayısı uyuşmuyor".

### Doğrulama
Gerçek Chromium'da ölçüldü; sonuçlar regresyon testlerine bağlandı.
- Statik 36/36 · Loader 56/56 · Tarayıcı 137/137 · ESLint temiz.
- Takılma senaryosu (görsel `fetch` hiç çözülmez): 23 sn'de
  "⬇️ İndirme adımı 23 sn'dir ilerlemiyor…" + yeniden dene düğmesi.
- Sekme satırı sayısı: 1280/1024/820/480px → hepsi **1 satır**.

---

## 2026-11-03 — `@connect` regresyonu ve galeri düzeni

- **`@connect` daraltma regresyonu (ürünü bozan hata):** `@connect` yalnızca
  `raw.githubusercontent.com`'a daraltılmıştı; herhangi bir alan adından gelen
  görseller "This domain is not a part of the @connect list" ile reddediliyor,
  ZIP adımında tüm görseller "GM ağ hatası" veriyordu. `@connect *` geri
  eklendi, gerekçesi belgelendi ve **testle kilitlendi**.
- **Anlaşılır ağ hatası:** `onerror` artık host adını ve olası `@connect`
  nedenini yazıyor (URL'nin tamamı değil; imzalı parametreler günlüğe düşmesin).
- **Galeri altındaki boş şerit:** `calc(100dvh - 430px)` paneli 70px taşırıyor,
  altında kullanılmayan boşluk bırakıyordu. Galeri kalan alanı dolduruyor.
- **Filtre düğmesi konumu:** "☷ Görselleri filtrele ve seç" galerinin üstündeki
  ayrı araç çubuğundan çıkıp sekme çubuğunun sağına taşındı; `.gallery-tools-bar`
  kaldırıldı.
- **Sekmelerin ilk durumu:** `activateTab` yalnızca tıklamaya bağlıydı, ilk
  durum hiç uygulanmıyordu. Erken çağrı ise TDZ `ReferenceError` ile tüm sonuç
  panelini öldürüyordu; çağrı bağımlılıklar hazır olduktan sonra yapılıyor.

---

## 2026-11-03 — Loader'ın GitHub'a taşınması, hata düzeltmeleri, test altyapısı

- **Loader GitHub raw URL'lerine taşındı:** 9 `@require` + `appHtml`/`appCss`
  `@resource`, `?_=` önbellek kırıcı. Eski loader `file:///C:/Users/...`
  yollarına bağlıydı ve başka makinede çalışmıyordu.
- **Geliştirme loader'ı:** Her açılışta dosyaları tazeler (`@require`
  önbelleği yok). Kararlı loader'ın yanında ikinci bir kullanıcı betiği.
- **`@require` önbelleği belgelendi:** Tampermonkey `@require` dosyalarını
  `@version` başına önbelleğe alır; sürüm artmazsa değişiklik yüklenmez.
- **Düzeltilen hatalar:**
  - HTML/CSS her açılışta tazelenir, ağ hatasında `@resource` yedeğine düşer.
  - Yerelleştirilmiş Cloudflare doğrulama sayfaları tanınır (yalnızca İngilizce
    başlığa bakmak boş sonuç üretiyordu).
  - `Retry-After` başlığı `NaN` üretebiliyordu.
  - `javascript:` şemalı `href` enjeksiyonu engellendi.
  - `kind()` beklenmeyen girdide çöküyordu (guard eklendi).
  - Sabit kodlanmış `scriptVersion` gerçek sürümü gösteriyor.
  - 8 eksik CSS sınıfı tanımlandı.
  - Ürünün sayfaya sızdırdığı `body{}` kuralı kaldırıldı.
  - Ayarlar sekmesi açılışında yarış koşulu.
  - Boş "Gizlilik" bölümü dolduruldu.
  - Derin tarama ve `downloadImage` içinde `new URL` çökmesi.
- **Test altyapısı:** `tests/` (statik + loader + gerçek Chromium tarayıcı
  testleri), `npm test`, `npm run lint`, ESLint yapılandırması. Test sitesi
  5.200 görselli ve büyük sayfalı senaryoları içerir.
- **Performans ölçümü:** 5.200 görselde tarama 79–99 ms; sanallaştırma DOM'u
  60 kartın altında tutuyor. O(n²) iyileştirme denemesi ölçüldü ve **fayda
  sağlamadığı için geri alındı** (basit kod korundu).

### Hâlâ doğrulanmamış
- **Firefox:** Kod yalnızca standart API'ler kullanıyor ve
  `createImageBitmap`/`showDirectoryPicker` yokluğunda geri düşüyor, ancak
  canlı Firefox doğrulaması yapılmadı (ortamda yalnızca Chromium var).
- **Ekran okuyucu:** Otomatik erişilebilirlik ağacı testi yok.
