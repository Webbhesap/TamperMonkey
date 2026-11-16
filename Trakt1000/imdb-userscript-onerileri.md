# IMDb userscript önerileri (senin iş akışına göre)

**Tarama tarihi: 16 Kasım 2026.** Kaynak: Greasy Fork'un `imdb.com` listeleri
(en çok kurulan + en son güncellenen) ve hedefli aramalar (`imdb list`, `imdb watchlist`,
`imdb trakt`, `imdb duplicate`, `imdb watched`).

**Seçim ölçütleri:** (1) senin iş akışına yarıyor mu — IMDb'yi **liste arşivi** olarak
kullanıyorsun, yeni dizi/film ekliyorsun, "izlendi" işareti koyuyorsun; (2) bakımlı mı —
IMDb arayüzü değiştikçe scriptler kırılır, o yüzden son güncelleme tarihi önemli;
(3) tuzak var mı — "izlendi" işareti yalnızca tarayıcında tutan, ya da 2018'den beri
güncellenmemiş scriptler.

Bu dosya öneri listesidir; hiçbir script bu depoda barındırılmıyor, hepsi Greasy Fork'tan
kuruluyor. Depodaki tek betik kendi yazdığımız `imdb-watched-marker/`.

---

## 1. Önce bunlar: asıl işini gören üç script

### IMDB List Importer (No-Duplicates) — [#560762](https://greasyfork.org/en/scripts/560762-imdb-list-importer-no-duplicates)

| | |
|---|---|
| Sürüm / boyut | v2 · 16,4 KB |
| Son güncelleme | 30 Aralık 2025 |
| Kurulum | 45 · Lisans GPL-3.0 |
| Nerede çalışır | Listenin **Edit** sayfası (URL `/edit` ile bitmeli) |

**Neden senin için birinci sırada:** "yeni ekleyeceğim dizi ve filmleri IMDb'ye
ekleyeceğim" dedin — bu işin en can sıkıcı tarafı yineleme. Bu betik eklemeden önce
**listeyi sunucudan sorgulayıp** zaten var olan öğeleri atlıyor (*smart remote
deduplication*), ayrıca girdideki yinelemeleri de yerel olarak süzüyor.

- Girdi: alt alta `tt1234567` metni **veya** CSV (kolonları kendi buluyor: `Const` + `Description`)
- Sıra kontrolü: başa / sona / belirli bir konuma ekleme
- Açıklama (Description) kolonunu da taşıyor → antoloji dizileri için "S1 Dahmer · S2
  Menendez…" notunu CSV'den toplu basabilirsin (rehber §5'teki tuzak)
- IMDb'nin GraphQL API'sini kullanıyor; Neinei0k'un orijinal betiğinin (#23584) geliştirilmiş hâli

**Orijinal #23584'ten farkı:** orijinalde yineleme kontrolü yok, aynı öğeyi listeye ikinci
kez ekleyebiliyor. Senin gibi 12.000 öğeye yaklaşan listelerde bu fark önemli.

### IMDb Scout Mod — [#407284](https://greasyfork.org/en/scripts/407284-imdb-scout-mod)

| | |
|---|---|
| Sürüm / boyut | v28.1.2 · **1,21 MB** |
| Son güncelleme | **14 Kasım 2026** (2 gün önce) |
| Kurulum | 16.318 · 63 puan · Lisans MIT · [GitHub](https://github.com/Purfview/IMDb-Scout-Mod) |
| Tarayıcılar | Firefox, Chrome, Opera, Safari, Edge + Firefox Android / Orion iOS |

Seni ilgilendiren özellikleri:

- **Trakt watchlist'e IMDb'den ekleme/çıkarma — film, dizi ve BÖLÜM düzeyinde.** IMDb ile
  Trakt arasında kalan tek köprü bu; iki tarafı birden kullanmaya devam edeceksen en
  değerli script.
- **Plex / Jellyfin / Emby göstergeleri**: başlığın medya sunucunda olup olmadığını IMDb
  sayfasında gösterir.
- **Liste / Watchlist / Advanced Title Search sayfalarında çoklu otomatik arama** — yani
  18 listeni gezerken her satırda harici kaynaklar görünür.
- Harici puanlar: Metacritic, Rotten Tomatoes, Letterboxd, Douban, Allocine, MAL, AniList.
- Radarr/Sonarr'a ekleme, reklam kaldırma, Reference View için koyu/sıkışık tema.

**Uyarılar:**
1. Betik aslında **torrent/usenet odaklı** ve 1,21 MB — yüzlerce site linki ekliyor.
   Ayarlarından kullanmadığın tüm site gruplarını kapat, yoksa IMDb sayfaları kalabalıklaşır
   ve yavaşlar.
2. Trakt özelliği **Trakt oturumu/bağlantısı** ister. Kurulumdan sonra
   `app.trakt.tv/settings` → **Connected apps**'a bak: ücretsiz Trakt hesabında
   **tek bağlı uygulama hakkı** var (22 Temmuz 2026'dan beri). Scout Mod o slotu
   doldurursa başka bir araç (örn. IMDB-Trakt-Syncer) bağlanamaz. *Bu betiğin slotu
   doldurup doldurmadığını burada doğrulayamadım — kurunca kendin kontrol et.*

### IMDb Highlighter — [#581029](https://greasyfork.org/en/scripts/581029-imdb-highlighter)

| | |
|---|---|
| Sürüm | v1.7 · Son güncelleme 4 Ağustos 2026 · 13 kurulum · MIT |

IMDb sayfalarında satırları **renkle** işaretler: yeşil = izlediğin (Watched),
mavi = Watchlist'inde, kırmızı = "bıraktım" listende. Arama sonuçlarını, listeleri ve
Chart'ları gezerken "bunu daha önce eklemiş miyim?" sorusunu ortadan kaldırır.

**Nasıl çalışıyor (kaynak kodunu okudum):** `api.graphql.imdb.com`'a senin oturumunla
istek atıp Watchlist ve liste içeriğini **düz query** ile çekiyor (sağlam yol);
izleme geçmişini ise **persisted query hash'i** ile çekiyor. O hash IMDb sürümüyle
**değişebiliyor** → yeşil (Watched) renklendirme bir gün çalışmayı bırakırsa sebebi bu,
mavi/kırmızı çalışmaya devam eder. "Bıraktım" listesi için kendi liste kimliğini
(`DROPPED_LIST_ID`) koda yazman gerekiyor.

---

## 2. Tamamlayıcı: görsellik ve karşılaştırma

| Script | Ne işe yarar | Güncellik / kurulum |
|---|---|---|
| [IMDb-Lists-Highlighter #535812](https://greasyfork.org/en/scripts/535812-imdb-lists-highlighter) | **Kendi listelerindeki** başlıkları/kişileri renklendirir. 18 listen varken "bu hangi listemdeydi?" sorusuna cevap | Mayıs 2025 · 10 |
| [IMDb Rating Colors #563779](https://greasyfork.org/en/scripts/563779-imdb-rating-colors) | Bölüm **ısı haritası** + histogram renklendirme + **Sezon Average** bölümü + görüntü kaydetme. Bölüm düzeyinde takip yapıyorsan en görsel araç | **16 Kasım 2026** (6 saat önce) · 57 |
| [IMDb with additional ratings #508407](https://greasyfork.org/en/scripts/508407-imdb-with-additional-ratings) | TMDB, Douban, Metacritic, RT, MAL puanlarını IMDb'ye ekler; süre bilgisine tıklayınca metadata'yı panoya kopyalar | 27 Ekim 2026 · 91 |
| [Movie/TV Shows Links Aggregator #572736](https://greasyfork.org/en/scripts/572736-movie-tv-shows-links-aggregator) | Sayfada **TMDb/IMDb kimliklerini** gösterir → Trakt/TMDB/IMDb eşleştirmesi yaparken `tt` ve `tmdb` id'lerini elle aramak zorunda kalmazsın | 12 Ekim 2026 · 228 |
| [IMDb Full Summary #23433](https://greasyfork.org/en/scripts/23433-imdb-full-summary) | Konu özetini otomatik tam gösterir ("devamını oku" tıklaması yok) | 4 Temmuz 2026 · 448 |

## 3. Toplu veri işleri (zaten rehberde geçenler)

| Script | Ne işe yarar | Not |
|---|---|---|
| [IMDB Ratings Importer #463836](https://greasyfork.org/en/scripts/463836-imdb-ratings-importer) | `const` + `your rating` CSV'sinden **film/dizi/bölüm** puanı basar. Puan = otomatik Watched, o yüzden 12.000 tavanına takılmadan "izlendi" işareti elde etmenin hazır yolu | Mayıs 2024 · 512 · `Date Rated` kolonunu **okumaz** → tarih korunmaz |
| [IMDB List Importer #23584](https://greasyfork.org/en/scripts/23584-imdb-list-importer) | Listenin Edit sayfasına CSV/metin içe aktarma (orijinal) | Aralık 2024 · 2.773 · **yineleme kontrolü yok** → yerine #560762'yi kullan |
| [IMDb Enhancer #583777](https://greasyfork.org/en/scripts/583777-imdb-enhancer-lists-multi-source-ratings-qol) | Arama/Chart/liste sayfalarında tek tıkla **listeye ekle-çıkar** (üyelik tespiti ile yineleme yapmaz), sonuçları sırala/filtrele/**CSV dışa aktar**, RT+MC+Letterboxd puanları | Ekim 2026 · 28 · ⚠️ aşağıdaki tuzağa bak |
| [IMDb List Watchlist Adder #591230](https://greasyfork.org/en/scripts/591230-imdb-list-watchlist-adder) | Bir listedeki **tüm öğeleri Watchlist'e** ekler | Ağustos 2026 · 5 · Watchlist tavanı 12.000 |
| **`imdb-watched-marker/`** (bu depoda) | Trakt geçmişini **puansız, check-in'siz** toplu Watched yapar | 0.1.0 · 22 test · tarih yazamaz |

## 4. Küçük rahatlıklar

| Script | Ne | Güncellik |
|---|---|---|
| [IMDb — Ad/Pro Cleaner #545323](https://greasyfork.org/en/scripts/545323-imdb-ad-pro-cleaner) | Reklam alanlarını, "sponsored" etiketlerini ve IMDbPro satış kutularını **yalnız CSS ile** gizler; sayfa içeriğini silmez | 15 Kasım 2026 · 54 |
| [IMDb WideScreen Compact #443927](https://greasyfork.org/en/scripts/443927-imdb-widescreen-compact-gm-tweaks-v-65) | Geniş ekranda başlık sayfasını yeniden düzenler, kaydırmadan daha çok bilgi | 24 Ağustos 2026 · 240 |
| [IMDb Age & Movie Year Calculator #596009](https://greasyfork.org/en/scripts/596009-imdb-age-movie-year-calculator) | Liste satırlarında yılın yanına "kaç yıl önce" yazar, oyuncu yaşı gösterir | Eylül 2026 · 8 |

---

## 5. Tuzaklar ve kurulmaması gerekenler

**⚠️ IMDb Enhancer'ın "mark as watched" düğmesi IMDb'ye YAZMAZ.** Kaynak kodunda işaret
`GM_setValue` ile **tarayıcının kendi deposunda** tutuluyor; düğmenin açıklaması da bunu
söylüyor: *"saved locally on this device"*. Başka tarayıcıda/cihazda görünmez, IMDb
hesabına işlenmez. Betiğin **listeye ekle/çıkar** kısmı gerçek (GraphQL), watched kısmı
değil. Toplu izlendi işareti için `imdb-watched-marker/`'ı kullan.

**Eski ve büyük olasılıkla bozuk scriptler** (IMDb'nin 2022+ arayüzünde çalışmaz):

| Script | Son güncelleme |
|---|---|
| IMDb - List Helper #11617 | Şubat 2018 |
| IMDb 'My Movies' enhancer #8843 | Mayıs 2015 |
| Remove from watchlist when rated #32966 | Eylül 2017 |
| Power IMDB (Trakt + YouTube trailers) #402912 | Mayıs 2021 |
| IMDB Watchlist on Netflix? #12220 | Eylül 2015 |

**Korsan akış scriptleri:** "IMDb Player" (#573255), "IMDB Video Player — vidsrc" (#485149),
"IMDB Movie or TV Show" (#508237), "IMDb Watch → Src • Fast" (#565477) gibi betikler IMDb
sayfasına üçüncü taraf oynatıcı gömer. Hem telif hem **güvenlik** riski (bilmediğin bir
alan adına istek, reklam/ağ enjeksiyonu) taşıyor; önerilmez.

**Script çakışması:** IMDb Scout Mod, IMDb Enhancer, "IMDb with additional ratings",
RatingHub ve cuzi'nin puan scriptleri **aynı alanlara** (başlık sayfasının üst şeridi,
arama satırları) DOM enjekte eder. Hepsi birden kurulursa sayfa yavaşlar, puanlar çift
görünür, scriptler birbirinin düğmesini bozar. **Bir tema için bir script** seç:
harici puan için Scout Mod **ya da** #508407 **ya da** cuzi'nin tekil scriptleri.

**Genel güvenlik notu:** bu betiklerin hepsi senin tarayıcı oturumunla çalışır; hiçbiri
sende parola istememeli. İsteyen olursa kurma. Greasy Fork dışında (forum/ Discord
bağlantısı ile) dağıtılan "aynı" betiklere güvenme; kodu okuyabileceğin yerden kur.

---

## 6. Senin için minimum set

Yeni içerik ekleyip arşivi IMDb'de tutmak istiyorsan üç script yeterli:

1. **IMDB List Importer (No-Duplicates) #560762** — listeye ekleme + yineleme derdi yok.
2. **IMDb Scout Mod #407284** — Trakt köprüsü (watchlist'e IMDb'den ekle/çıkar, bölüm
   dahil) + Plex/Jellyfin göstergeleri. Torrent linklerini ayarlardan kapat.
3. **IMDb Highlighter #581029** *veya* **IMDb-Lists-Highlighter #535812** — "bunu eklemiş
   miydim?" sorusunu renkle çözer.

Toplu iş gerektiğinde (14.400 geçmiş, puan taşıma, 18 listenin aktarımı) bu depodaki
`imdb-watched-marker/` + rehberdeki #23584/#463836 üçlüsü devreye girer.

Kurulum hepsinde aynı: Tampermonkey/Violentmonkey → Greasy Fork sayfasındaki
**Install this script** → izinleri onayla. Bir script çalışmayı bırakırsa önce
Greasy Fork'taki **History** sekmesinden yeni sürüm var mı bak; IMDb arayüzü
değiştiğinde bakımlı scriptler günler içinde güncellenir (Scout Mod'da olduğu gibi).
