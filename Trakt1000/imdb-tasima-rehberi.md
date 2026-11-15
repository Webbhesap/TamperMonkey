# Trakt listelerini IMDb'ye taşıma rehberi

> **Amaç:** Trakt'ın ücretsiz hesap limiti (tüm kişisel listelerde toplam **1.000 öğe**,
> **5 statik + 3 dinamik liste**) nedeniyle listeye yeni öğe eklenemediğinde, 18 listenin
> tamamını IMDb'ye taşımak.
>
> **Önemli:** IMDb'de resmî **içe aktarma (import) özelliği yok**. IMDb yalnızca dışa
> aktarır (CSV). Taşıma ancak üçüncü parti bir userscript ile yapılabilir. Yani bu iş
> "Trakt → dosya → IMDb" şeklinde üç adımlı bir köprüdür.

---

## 0. Önce yedek al (bunu atlamadan hiçbir şey silme)

1. `https://app.trakt.tv/settings/data` → **Export now**
2. `trakt-export-<kullanıcıadı>.zip` iner. Ücretsiz, VIP gerekmez. ZIP **tarayıcında**
   oluşturulur, sunucuda kuyruk beklemez.

ZIP'in içinde listeler için şu dosyalar vardır:

| Dosya | İçerik |
|---|---|
| `lists-lists.json` | Tüm listelerin künyesi (ad, `trakt` id, `slug`, gizlilik, sıralama) |
| `lists-list-<trakt_id>-<slug>.json` | Her liste için ayrı dosya: o listenin öğeleri |
| `lists-watchlist.json`, `lists-favorites.json` | İzleme listesi ve favoriler |

Öğe dosyaları Trakt API'sinin ham JSON'ıdır ve her öğede kimlikler şöyledir:

```json
{
  "listed_at": "2023-11-04T18:22:10.000Z",
  "type": "movie",
  "movie": {
    "title": "Batman Begins",
    "year": 2005,
    "ids": { "trakt": 1, "slug": "batman-begins-2005", "imdb": "tt0372784", "tmdb": 272 }
  }
}
```

**İhtiyacın olan tek alan: `ids.imdb`** (yani `tt…`). IMDb listeleri bu kimlikle beslenir.

> Not: Yeni sitede (`app.trakt.tv`) liste başına CSV indirme düğmesi **yok**. Eski sitede
> bu özellik VIP'e özeldi. Ücretsiz hesapta tek yol yukarıdaki ZIP'tir.

---

## 1. `tt` kimliklerini JSON'dan çıkar (kod yazmadan)

Her liste için ayrı dosya olduğundan, listeleri tek tek işle. Üç yöntemden birini seç:

### Yöntem A — Metin editörü (en hızlısı)
Notepad++ veya VS Code ile:

1. ZIP'ten ilgili `lists-list-*.json` dosyasını çıkar ve aç.
2. Bul kutusunda **düzenli ifade (regex)** modunu aç, şunu ara: `tt\d{7,8}`
3. Notepad++: **Find All in Current Document** → alt panelde tüm eşleşmeler listelenir →
   hepsini seç, kopyala.
4. Elinde satır satır `tt0372784` gibi kimlikler olur. Sıra, JSON'daki sıradır —
   yani listenin sırası korunur.

> IMDb List Importer (aşağıda) düz metni de kabul eder: metindeki `tt`/`nm` dışındaki
> her şeyi yok sayar. Yani CSV'ye çevirmen şart değil, bu listeyi doğrudan yapıştırabilirsin.

### Yöntem B — JSON → CSV dönüştürücü (Description da taşınsın istiyorsan)
1. `csvjson.com/json_to_csv` veya `konbert.com/convert/json/to/csv` gibi bir araç aç.
2. JSON'u yapıştır, düz (flat) CSV olarak indir.
3. Sadece `imdb` kolonunu tut, başlığını **`Const`** olarak değiştir. İstersen
   `Description` kolonu ekle (IMDb'de öğe notu olur).
4. Minimal geçerli dosya:

```csv
Const,Description
tt0372784,"Batman Begins"
tt0903747,"Breaking Bad"
```

### Yöntem C — Hazır servis
`mylistsaddon.com` (My Lists) Trakt liste bağlantılarını toplu yapıştırıp IMDb'ye uygun
CSV/JSON olarak dışa aktarabiliyor. 18 listeyi tek tek elle uğraşmak istemezsen bunu dene.

### Yöntem D — `watched-history-*.json`'dan yalnız bölümleri süzme

Geçmiş dosyasında her kayıt **hem dizi gövdesini hem bölümü** taşır (`type: "episode"`
kaydında `episode.ids.imdb` ve `show.ids.imdb` yan yana durur). Yöntem A'daki düz `tt`
araması ikisini de getirir; yalnız bölümleri istiyorsan tür alanına bakman gerekir.

```bash
# jq (Linux / macOS / WSL) — sayfalanmış dosyaların hepsini birden
jq -r '.[] | select(.type=="episode") | .episode.ids.imdb // empty' watched-history-*.json \
  | sort -u > episodes.txt
```

```powershell
# PowerShell (Windows) — aynı iş, kurulum gerektirmez
$out = foreach ($f in Get-ChildItem watched-history-*.json) {
  (Get-Content $f.FullName -Raw | ConvertFrom-Json) |
    Where-Object { $_.type -eq 'episode' -and $_.episode.ids.imdb } |
    ForEach-Object { $_.episode.ids.imdb }
}
$out | Sort-Object -Unique | Set-Content episodes.txt
"$($out.Count) ham kayıt, $(($out | Sort-Object -Unique).Count) benzersiz bölüm"
```

İki not:

- Bazı bölümlerde `imdb` alanı **`null`** gelir; yukarıdaki `// empty` ve
  `-and $_.episode.ids.imdb` koşulları bunları düşürür. IMDb kimliği olmayan bölüm
  hiçbir yolla IMDb'ye yazılamaz (bkz. §5).
- Tekrar izlemeler geçmişte birden çok olay olarak durur → `sort -u` /
  `Sort-Object -Unique` tekilleştirir. Ham kayıt ile benzersiz bölüm sayısının
  farklı olması normaldir.

Betikle çalışacaksan bunu elle yapmana gerek yok: `imdb-watched-marker/` panelindeki
**"Yalnız bölümler"** hazır filtresi gövdeleri ve filmleri kuyruktan düşürür, sonra
**"Kuyruk CSV"** ile aynı listeyi `const,type,label` başlıklı dosya olarak verir
(bkz. `imdb-watched-marker/README.md` §2b).

---

## 2. IMDb'de hedef listeyi oluştur

1. `imdb.com` → sağ üstte adın → **Your Lists** → **Create a new list**
2. Liste türü: **Titles** (kişiler için ayrı liste gerekir, bkz. §5)
3. Ad/açıklama gir, oluştur.
4. Liste sayfasında üç nokta (⋮) → **Edit** → sağ üstteki anahtarı **Private** yap
   (gizli kalmasını istiyorsan). IMDb'de gizli liste **destekleniyor**.
5. **Açıklama ve öğe notlarına IMDb dışı bağlantı koyma** (ör. `trakt.tv/...`). IMDb
   politika ihlali sayıp listeyi zorla gizliye düşürüyor, hatta kaldırabiliyor.

---

## 3. İçe aktarma aracını kur ve çalıştır

IMDb'nin kendi import'u olmadığı için bu adımı bir userscript yapar:

- **IMDB List Importer** — Greasy Fork #23584 (Neinei0k), sürüm 10.3, son güncelleme
  Aralık 2024, yeni IMDb arayüzüne uyarlanmış.
  `https://greasyfork.org/en/scripts/23584-imdb-list-importer`
- Tampermonkey veya Violentmonkey ile kur (bu deponun zaten kullandığı eklentiler).

Çalıştırma:

1. IMDb'de listenin **Edit** sayfasını aç → sayfanın üstünde import formu belirir.
2. CSV dosyasını seç **veya** `tt` kimliklerini metin alanına yapıştır.
3. Seçenekler:
   - yinelenenleri yok say (sadece eklenecek öğeler arasındaki tekrarları temizler;
     listede zaten olan öğe yine de eklenir),
   - sırayı koru / ters çevir,
   - ekleme konumu: listenin sonu (varsayılan) / başı / belirli bir sıra numarası.
4. **Import List** → script öğeleri **tek tek** ekler; bir öğe onaylanmadan sonrakine
   geçmez (IMDb'nin toplu ekleme ucu yok).

**Takılırsa:** sayfa hata verir, ayrıntı tarayıcı konsolundadır. Son eklenen öğeyi bul,
dosyada/metinde onu ve öncesindeki satırları sil, kalanı tekrar içe aktar.

**Puanlar (ratings) bu script ile taşınmaz.** Gerekirse ayrı script:
**IMDb Ratings Importer** — Greasy Fork #463836.

---

## 4. Doğrula

- IMDb listesindeki öğe sayısını Trakt'taki listeyle karşılaştır.
- Büyük listelerde IMDb geçici olarak yavaşlatabilir veya captcha isteyebilir;
  listeyi 500–1000'erlik parçalara bölerek içe aktar.
- 18 listenin toplamı ~1.000 öğe ise, öğe başına 1–2 saniyeden toplam süre
  kabaca 20–40 dakikadır (sekme açık kalmalı).

---

## 5. Taşınamayacak / eksik kalacak öğeler

| Durum | Sonuç |
|---|---|
| `ids.imdb` alanı boş olan öğeler | Taşınamaz. Trakt'ta bazı diziler/bölümler (özellikle anime ve yerel içerikler) IMDb kimliği taşımaz. Bunları elle aratıp eklemen gerekir. |
| `type: season` (sezon) | IMDb'de "sezon" diye bir liste öğesi yok. Ya dizinin kendisine indirgenir ya da düşer. |
| `type: episode` (bölüm) | **Taşınabilir**: bölümün `tt` kimliği varsa IMDb listesine eklenebilir (IMDb, liste düzenleme sayfasından `tt` ile bölüm eklemeyi resmî olarak destekliyor). Ama Trakt'ta her bölümün IMDb kimliği dolu olmayabilir. |
| `type: person` | Ayrı iş: IMDb'de **People** türünde ayrı liste oluşturup `nm…` kimlikleriyle içe aktarman gerekir. |
| Liste öğesi notları | `Description` kolonuyla taşınır (Yöntem B). Yöntem A'da (düz metin) taşınmaz. |
| `listed_at` (eklenme tarihi) | IMDb'ye taşınmaz; IMDb kendi ekleme tarihini yazar. |

### Bilinen tuzak: antoloji dizileri (IMDb tek başlık, Trakt ayrı dizi)

Trakt/TMDB antoloji dizilerinin **her sezonunu ayrı bir dizi** olarak kaydeder; IMDb ise
bunları **tek bir başlıkta** sezonlar altında toplar. Sonuç: ya `ids.imdb` boş gelir ve
öğe sessizce atlanır, ya da birkaç Trakt dizisi IMDb'de **tek öğeye** iner.

Somut örnek — Ryan Murphy'nin *Monster* antolojisi. IMDb'de **tek başlık**
(**Monster**, TV Series 2022– , `tt13207736`, 4 sezon / 35 bölüm); Trakt/TMDB'de
**dört ayrı dizi**:

| IMDb sezonu | Trakt / TMDB'deki ayrı dizi | Yıl | Bölüm | Yayın tarihi |
|---|---|---|---|---|
| S1 | `Dahmer – Monster: The Jeffrey Dahmer Story` | 2022 | 10 | 21 Eyl 2022 |
| S2 | `Monsters: The Lyle and Erik Menendez Story` | 2024 | 9 | 19 Eyl 2024 |
| S3 | `Monster: The Ed Gein Story` (TMDB 286801) | 2025 | 8 | 3 Eki 2025 |
| S4 | `Monster: The Lizzie Borden Story` | 2026 | 8 | 17 Eyl 2026 |

Bunun anlamı: dışa aktarımda dört öğe de aynı `tt13207736`'ya denk gelebilir → IMDb
listesinde ya tek "Monster" öğesi olur ya da (importer "listede zaten var" denetimi
yapmadığı için) aynı öğe dört kez eklenir. Doğru hareket: `tt13207736`'yı **bir kez**
ekleyip `Description` alanına sezonları yazmak
(ör. "S1 Dahmer · S2 Menendez · S3 Ed Gein · S4 Lizzie Borden").

Bölüm kimlikleri (sezon bazında ayrı takip istenirse):

| Sezon | Bölüm `tt` kimlikleri |
|---|---|
| S1 Dahmer | `tt13299456` (E1), `tt14359090` (E2), `tt14359092` (E3), `tt14359062` (E6), … |
| S2 Menendez | `tt27655087`, `tt32401267`, `tt32401268`, `tt32401269`, `tt32401270`, `tt32401271`, `tt32401272`, `tt32401273`, `tt33203966` |
| S3 Ed Gein | `tt31858291`, `tt37827389`, `tt38050252`, `tt38050258`, `tt38050253`, `tt37899362`, `tt38110403`, `tt38110408` |
| S4 Lizzie Borden | `tt37538664`, `tt43747966`, `tt43743919`, `tt41635111`, `tt43747967`, `tt41635114`, `tt43747968`, `tt43747969` |

Aynı desenden **etkilenmeyen** (hem IMDb hem Trakt tarafında ayrı duran) örnekler —
bunlarda birleşme aramayın: `Bleach: Thousand-Year Blood War` (IMDb `tt14986406`,
orijinal `Bleach`'ten ayrı), 2023/24 *Doctor Who* dönemi (IMDb `tt0436992` yalnızca
2005–2022, S1–S13), *American Crime Story* (IMDb `tt2788432` tek başlık, Trakt da
tek dizi → uyumlu).

IMDb'nin kendi "Also known as" listesi bunu doğrular: *"Dahmer - Monster: The Jeffrey
Dahmer Story (first season title)"* — yani bu ad ayrı bir başlık değil, sadece bir AKA.
IMDb'de "Dahmer – Monster: The Jeffrey Dahmer Story" veya "Monster: The Ed Gein Story"
adında **bağımsız dizi sayfası aramak boşuna**; doğru hareket `tt13207736` eklemektir.

İki ek ayrıntı:

- **Karakter tuzağı:** Trakt/Vikipedi başlıkta **en-dash** (`–`) kullanır, IMDb AKA'sı
  düz tire (`-`). İki nokta ile birleşince IMDb otomatik tamamlaması sıkça boş döner.
  Bu yüzden listeye **isimle değil `tt` kimliğiyle** ekle.
- **Sezon düzeyinde öğe yok:** IMDb listelerine ya başlık ya bölüm eklenir, sezon
  eklenmez. Sezonları ayırt etmek için öğenin `Description` alanını kullan veya
  yukarıdaki bölüm kimlikleriyle bölümleri tek tek ekle.

### Kaybolan öğeleri topluca bulma

1. İlgili `lists-list-*.json` dosyasını aç, **`"imdb":null`** ara → IMDb kimliği olmayan
   öğeler bunlardır; import sırasında atlananların tamamı bu kümedir.
2. Ters yönü de denetle: farklı Trakt dizileri aynı `tt`'ye denk geliyorsa IMDb
   listende tek öğeye inerler (antoloji deseni).
3. Importer script'i "bu öğe listede zaten var" kontrolü **yapmaz** (yalnızca eklenen
   parti içindeki tekrarları temizler). Aynı `tt`'yi iki kez gönderirsen IMDb listesinde
   çift satır oluşur.

---

## 5b. IMDb'de "izlendi" işaretleme (Watched)

IMDb'nin resmî **"Mark as watched"** özelliği var (Watched FAQ, güncelleme 28 Ocak 2026).
Düğme şu yerlerde çıkıyor: tüm başlık sayfaları, **Watchlist**, **senin oluşturduğun
listeler** ve Chart sayfaları (Top 250 vb.). Masaüstü + mobil tarayıcı + iOS/Android.
İşaretlenenler Profil → **Your watch history** sayfasında toplanır ve **yalnızca sana
görünür**.

| Yetenek | Durum |
|---|---|
| Film / dizi izlendi | Var |
| **Bölüm (episode) izlendi** | **Var** — IMDb ürün yöneticisi: "you can either mark a series as watched or mark an episode as watched only" |
| Sezon toplu işaretleme | **Yok** (istek backlog'da) |
| İzlenme tarihini geriye dönük yazma | **Yok** — tarih, düğmeye basılan andır |
| Tekrar izleme sayısı | Watched bir kez işaretlenir; tekrar/tarih kaydı için **Check-ins** |
| Dizi ilerleme yüzdesi | **Yok** — eski "How much have you seen?" sayfaları kaldırıldı |
| Toplu içe aktarma | **Yok** |

Önemli ayrıntı: **puanladığın, yorumladığın veya check-in yaptığın her öğe otomatik
olarak "izlendi" sayılır**. Ayrıca IMDb'de *reference view* açıksa Watched/Check-in
düzmeleri çalışmaz → `imdb.com/preferences/general` üzerinden kapatılmalı.

### Hangi konteyner kaç öğe alır (sık karıştırılan nokta)

12.000 sınırı "izlenme geçmişi"ne değil, **Watchlist / Lists / Check-ins** üçlüsüne ait
(IMDb Lists FAQ, 9 Temmuz 2026). Watched özelliğinin kendi SSS sayfası (28 Ocak 2026)
`Your watch history` için sayısal bir sınır **belirtmiyor**.

| Mekanizma | Ne yapar | Sınır |
|---|---|---|
| **Mark as watched** | Başlığa izlendi işareti; tek seferlik, tekrar sayısı tutmaz | Resmî sınır belgelenmemiş |
| **Check-in** | Tarihli kayıt; aynı başlığa birden çok kez yapılabilir | **12.000** (Check-ins) |
| **Rating / Review** | Puan/yorum — IMDb bunları otomatik "izlendi" sayar | Lists FAQ'daki üçlüye dahil değil |
| **Listeler** | Taşıdığın özel listeler | Liste başına **12.000**, en fazla **999** liste |

Pratik sonuç: **IMDB-Trakt-Syncer geçmişi IMDb'ye check-in olarak yazar** (kodunda
`imdb_watch_history_limit_reached` bayrağı var) → o yolla taşınan izleme geçmişi
**12.000'de tıkanır**. Elle Watched ile işaretlemek bu tavana takılmaz ama tarih ve
toplu içe aktarma yoktur. Bölümleri puanlayarak izlendi saydırmak (Ratings Importer)
check-ins konteynerini doldurmaz.

Kıyas: Trakt'ta `history` kovası ücretsiz hesapta **100.000** → izleme geçmişi için
Trakt çok daha geniş. Not: "sınır belgelenmemiş" ≠ "sınır yok"; IMDb eski Seen
sayfalarını kaldırdığı gibi burada da tavan getirebilir, asıl kopya Trakt ZIP'inde dursun.

### Toplu taşımanın iki yolu

1. **Puanları toplu içe aktar (önerilen):** **IMDb Ratings Importer** userscript'i
   (Greasy Fork #463836) film + dizi + **bölüm** puanlarını `const` + `your rating`
   kolonlu CSV'den alır. Trakt ZIP'indeki `ratings-episodes.json` dosyasında `ids.imdb`
   ve puan hazır bulunur; §1'deki `tt` çıkarma yöntemiyle CSV'ye çevrilir. Puanlarda
   12.000 öğe sınırı yoktur. Bedeli: her öğeye 1–10 puan gerekir ve izlenme tarihi
   içe aktarma tarihi olur.
2. **IMDB-Trakt-Syncer (Python + Chromedriver):** izleme geçmişini IMDb'ye **check-in**
   olarak yazar, bölüm düzeyini destekler, yazmadan önce tarihe göre sıralar. Sınırları:
   orijinal `watched_at` IMDb tarafında **kaybolur** (tarih koruma yalnızca IMDb → Trakt
   yönünde), check-ins 12.000 öğeyle sınırlı, ve `trakt.tv/oauth/applications`'da kendi
   API uygulamanı kurman gerekir → ücretsiz hesaptaki **tek bağlı uygulama** hakkını
   tüketir.

### Öneri

İzleme geçmişini IMDb'ye taşıma. Trakt'ta daralan kova **listeler** (1.000 öğe);
izleme geçmişi çok daha geniş (`/v3/users/me/usage` içindeki `history` kovası ücretsiz
hesapta 100.000). Mantıklı bölünme: **geçmiş + scrobble Trakt'ta, IMDb yalnızca liste
arşivi**. "İzledim mi?" bilgisi IMDb'de de görünsün isteniyorsa en ucuz yol 1. seçenektir.

---

## 5c. 12.000'i aşan izleme geçmişi (ör. 14.400 öğe): check-in'siz yollar

IMDb Lists FAQ'daki (9 Temmuz 2026) cümle birebir şöyle: *"Watchlists, Lists, and
Check-ins can have a maximum of 12,000 items."* Yani **14.400 öğelik geçmiş check-in
yoluyla taşınamaz** — 2.400 öğe dışarıda kalır. Check-ins FAQ'nın ek kısıtları: hesap
başına **tek** check-in listesi, liste **sıralanamaz**, varsayılan **herkese açık**
(gizlenebilir), bölüm ve dizi birlikte işaretlenebilir, ama tarih geriye yazılamaz.

### "Watched'a toplu yazan hazır araç" var mı? Hayır

- **IMDb'nin kendi toplu aracı yok.** Eylül 2025'te açılan *"Watch list to Watched bulk
  conversion"* isteği hâlâ yanıtsız (durum: No Status, IMDb ekibi cevabı yok).
- Greasy Fork'taki "mark as watched" scriptleri yanıltıcı:
  - **IMDb Enhancer** (#583777) izlendi işaretini yalnızca **tarayıcının kendi
    deposunda** tutar (`GM_setValue`, düğme açıklaması: "saved locally on this device")
    → IMDb hesabına **hiçbir şey yazmaz**.
  - **IMDb Highlighter** (#581029) izleme geçmişini yalnızca **okur** (satırları
    renklendirir), yazmaz.
- **TraktRater** IMDb'yi sadece **kaynak** olarak kullanır (IMDb CSV → Trakt); IMDb'ye
  veri yazmaz.

### Check-in'siz tek hazır toplu yol: puanlar

IMDb **puanlanan her başlığı otomatik "izlendi" sayar** (Watched FAQ). **IMDb Ratings
Importer** (#463836) tam olarak bunu yapar: kaynak kodunda tek çağrı
`rateTitle(input: {rating, titleId})` GraphQL mutation'ı; film + dizi + **bölüm**
destekli; puanlarda 12.000 tavanı **yok**.

Bedelleri:

1. Her öğeye 1–10 arası bir **yıldız puanı zorunlu** (script yalnızca `const` ve
   `your rating` kolonlarını okur).
2. **Tarih korunmaz** — script `Date Rated` kolonunu hiç kullanmıyor, izlenme tarihi
   içe aktarma günü olur.
3. İzlenmeyi geri almak için **önce puanı silmek** gerekir (Watched FAQ: "you will have
   to remove those activities before unmarking").
4. Puanlar varsayılan herkese açık; **Account settings → Privacy settings**'ten
   gizlenebilir. 14.400 puan profil istatistiklerini/ortalamasını değiştirir.

### Watched'a doğrudan yazmak (depodaki betik)

Hazır ürün yok ama **yazılabilir** ve bu depoda yazıldı: `imdb-watched-marker/`
(bkz. `imdb-watched-marker/README.md`). IMDb'nin düğmesinin çağırdığı mutation'ı
kullanır:

```graphql
mutation AddWatchedTitle($titleId: ID!) { addWatchedTitle(titleId: $titleId) { success } }
```

Aynı mutation'ı kullanan, yayında ve MIT lisanslı bir başka betik daha var
(`Juwan-Hwang/douban2imdb`, Greasy Fork #596763) — yani yol fiilen çalışıyor. Betik
`https://www.imdb.com/*` üzerinde, `@grant none` ile koşar; puan vermez, check-in
yapmaz, kuru koşu + tek öğe denemesi + hız sınırı + duraklat/devam + doğrulama içerir
ve mutation imzası değişirse **yakalama modu** ile düğmeye bir kez basarak gerçek
isteği öğrenip onunla devam eder.

Okuma tarafı ayrıca kanıtlı: IMDb Highlighter, `api.graphql.imdb.com` üzerinden
`WatchHistoryPage` persisted query'sini (`advancedTitleSearch` + `myWatchedConstraint
{filterType: INCLUDE}` + `sort: MY_WATCHED_DATE`) çalıştırıp izlenen `tt`'leri
çekebiliyor. Demek ki izlenme **tarih alanı var**, ama onu **sen yazamıyorsun** — tarih
düğmeye basılan andır.

Kırılganlık uyarıları (2026 durumu):

- `api.graphql.imdb.com` yalnızca `https://www.imdb.com` origin'inden ve **oturumlu**
  (`credentials: include`) istekleri kabul ediyor → iş bir imdb.com sekmesinde
  (userscript/eklenti) yürümek zorunda.
- Persisted query **sha256 hash'leri IMDb sürümleri arasında değişiyor**; düz query
  gövdesi göndermek de her zaman kabul edilmiyor.
- **AWS WAF** tarayıcı dışı istekleri blokluyor; 23 Temmuz 2026'dan beri headless
  tarayıcı tek başına challenge'ı geçemiyor. Bu tür araçlar 2026'da ~1–2 ayda bir kırıldı.
- IMDb Kullanım Koşulları ve `robots.txt`, kendi verin için bile otomatik erişime yazılı
  izin şartı koyuyor.

### 14.400 öğe için seçenek matrisi

| Yol | Tarih korunur | Tavan | Hazır araç | Not |
|---|---|---|---|---|
| Check-in (IMDB-Trakt-Syncer) | Hayır | **12.000 → yetmez** | Var | Tek liste, sıralanamaz, tek bağlı uygulama hakkını yakar |
| Puan içe aktarma (#463836) | Hayır | Belirlenmemiş | **Var** | Her öğeye yıldız gerekir; puanlar gizlenebilir |
| Elle Watched düğmesi | Hayır | Belirlenmemiş | Gerekmez | 14.400 tıklama |
| Watched'a doğrudan betik | Hayır | Belirlenmemiş | **Var: `imdb-watched-marker/`** | `addWatchedTitle`; puan/check-in gerekmez; imza değişirse yakalama modu |
| **Trakt'ta bırakma** | **Evet** | **100.000** | Gerekmez | Darboğaz listelerdi, `history` değil |
| Simkl / Plex'e Trakt ZIP | **Evet** | Pratikte geniş | Resmî içe aktarma | IMDb ile senkron yok |

**Sonuç:** Tarihli 14.400 öğe için doğru kap IMDb değil; IMDb'de tarihli toplu geçmişin
hem tavanı (12.000) hem de geriye dönük yazma yasağı var. Geçmişi Trakt'ta (veya tarih
koruyarak Simkl/Plex'te) tut, IMDb'de Watched'ı yalnızca "izledim mi?" rozeti olarak
kullan. O rozeti toplu almanın iki yolu var: **puan içe aktarma** (hazır, ama her öğeye
yıldız gerekir) ya da bu depodaki **`imdb-watched-marker/`** betiği (puansız,
check-in'siz, 12.000 tavanına takılmaz — ama tarihi yine yazamaz).

---

## 6. Trakt ↔ IMDb karşılaştırması (ne kazanır, ne kaybedersin)

| | Trakt (ücretsiz, 2026) | IMDb |
|---|---|---|
| Liste sayısı | 5 statik + 3 dinamik | **999** |
| Liste başına öğe | 250 (ve tüm listelerde toplam 1.000) | **12.000** |
| Gizli liste | Var | Var |
| Bölüm (episode) düzeyinde öğe | Var | Var (`tt` ile) |
| Sezon düzeyinde öğe | Var | **Yok** |
| İzlenme işareti | Var (sezon/dizi ilerlemesi ile) | Var ama sınırlı: bölüm ve dizi düzeyinde **Watched**; sezon toplu işaretleme, ilerleme yüzdesi ve geçmişe dönük tarih **yok** (bkz. §5b) |
| Akıllı/filtreli liste | Var (dinamik liste) | **Yok** |
| Plex / Kodi / Jellyfin / Syncler entegrasyonu | Var | **Çok sınırlı** |
| Öğe notları | Var | Var |
| Özel sıralama | Var | Var |
| **İçe aktarma** | IMDb / Letterboxd / Trakt CSV+JSON | **Yok** (sadece userscript ile) |
| Dışa aktarma | Tam ZIP (JSON), ücretsiz | CSV, ücretsiz |

**Dürüst değerlendirme:** IMDb iyi bir **arşiv** hedefidir (999 liste × 12.000 öğe,
gizli liste, ücretsiz CSV dışa aktarım → geri dönüş mümkün), ama kötü bir **takip**
hedefidir. İzlenme takibi, ilerleme, akıllı filtreler ve medya sunucusu entegrasyonları
IMDb'de yok. Günlük kullanımı IMDb'ye taşıyorsan bu özellikleri kaybedersin.

### IMDb'den daha az sürtünmeli alternatifler

| Servis | Trakt verisini nasıl alır | Ücretsiz sınır | Not |
|---|---|---|---|
| **Plex** | Trakt'ın ZIP dışa aktarımını **doğrudan** okur (listeler JSON olarak içinde) | — | Liste başına 1.000 öğe, dosya en fazla 2 MB. Plex kullanıyorsan en kolay yol. |
| **Simkl** | Trakt ZIP'ini doğrudan kabul eder (`simkl.com/apps/import/trakt/`) | Özel listeler PRO ister | Geçmiş, izleme listesi, puanlar sorunsuz; özel listeler için PRO gerekir. |
| **MDBList** | Trakt'a bağlanıp listeleri aynalar | 4 liste × 10.000 öğe | Trakt'a bağlanmak, ücretsiz hesaptaki **tek bağlı uygulama** hakkını kullanır. |
| **Letterboxd** | IMDb CSV'sini içe aktarır | — | Sadece filmler, diziler yok. |
| **Cinopsys** | Trakt'tan içe aktarır | Yerel-öncelikli, limitsiz | Yeni ve küçük bir servis; veriyi cihazında tutar. |

---

## 7. Trakt içinde kalmanın yolu (taşınmadan çözmek)

Engellenmiş durumdayken en verimli sıra:

1. **Yedeği al** (§0). Silme/birleştirme işlemlerinden önce mutlaka.
2. **Dinamik (akıllı) listelere çevir.** Ücretsiz hesapta 3 dinamik liste **ayrı bir
   limit kovasında** ve filtre tabanlı oldukları için öğeleri `total_list_items`
   (1.000) sayacına girmiyor. Tür/yıl/puan/izlenme durumu ile anlatılabilen listeleri
   (`app.trakt.tv/lists/smart/convert/<liste>`) buraya taşı → statik kova boşalır.
3. **Statik listelerde bütçeyi geri kazan.** Genelde üç kalem şişkinlik yapar:
   - zaten izlenmiş öğeler (izleme geçmişinde duruyor, listede durmasına gerek yok),
   - birden fazla listede tekrar eden aynı öğeler,
   - yıllar önce eklenip bir daha dokunulmamış öğeler.
4. **Hâlâ yetmiyorsa** IMDb/MDBList'e arşivle (§1–§5) ve Trakt'ta yalnızca aktif
   kullandığın listeleri bırak.

Gerçek kullanımını `GET https://api.trakt.tv/v3/users/me/usage` ucundan görebilirsin;
sitenin "Tüm Özel Listeler Toplam İçerik 1.000 öğe" paneli bu veriyi gösterir:
`history`, `ratings`, `watchlist_items`, `total_list_items`, `static_lists`,
`dynamic_lists`, `digital_library`, `total_notes`, `connected_apps` — her biri için
`current` / `free` / `vip`.

---

## Kaynaklar

- IMDb Lists FAQ (güncelleme: 9 Temmuz 2026) — 999 liste, liste başına 12.000 öğe,
  gizli liste, bölüm ekleme, dışa aktarma: <https://help.imdb.com/article/imdb/track-movies-tv/lists-faq/GNQMN47VZSE7KW38>
- IMDb topluluğu/resmî yanıt — "içe aktarma özelliği yok":
  <https://community-imdb.sprinklr.com/conversations/imdbcom/ratings-import-history-and-data-from-other-sites/5f4a7a4d8815453dbaa100b5>
- IMDB List Importer userscript: <https://greasyfork.org/en/scripts/23584-imdb-list-importer>
- IMDb Ratings Importer userscript: <https://greasyfork.org/en/scripts/463836-imdb-ratings-importer>
- IMDb "Mark as watched" FAQ (güncelleme 28 Ocak 2026) — Watched özelliği, your watch
  history, puan/yorum/check-in'in otomatik izlendi sayılması:
  <https://help.imdb.com/article/imdb/new-features-updates/mark-as-watched-faq/GR2SD7Y4LZVNHUVH>
- IMDb Check-ins FAQ — hesap başına tek check-in listesi, dizi ve **bölüm** düzeyinde
  check-in, sıralanamaz, varsayılan herkese açık:
  <https://help.imdb.com/article/imdb/track-movies-tv/check-ins-faq/GG59ELYW45FMC7J3>
- IMDb puan gizliliği — Account settings → Privacy settings:
  <https://help.imdb.com/article/imdb/track-movies-tv/how-do-i-change-the-privacy-setting-for-my-ratings/G59Z2UQUXC3WS6YL>
- IMDb topluluk isteği (Eylül 2025, yanıtsız) — Watchlist → Watched toplu dönüştürme:
  <https://community-imdb.sprinklr.com/conversations/imdbcom/lists-watch-list-to-watched-bulk-conversion/68c5440abac19b417f96d350>
- IMDb Enhancer (#583777, izlendi işareti **yalnızca yerel**) ve IMDb Highlighter
  (#581029, izleme geçmişini GraphQL'den **okur** — `WatchHistoryPage` persisted query):
  <https://greasyfork.org/en/scripts/583777-imdb-enhancer-lists-multi-source-ratings-qol/code>,
  <https://greasyfork.org/en/scripts/581029-imdb-highlighter/code>
- IMDb'ye yazan araçların 2026 kırılganlık raporu (AWS WAF, headless engeli 23 Temmuz
  2026, GraphQL yalnızca `www.imdb.com` origin + oturum, ~1–2 ayda bir kırılma):
  `github.com/alp82/goodwatch-monorepo/blob/main/docs/research/imdb-ratings-import-deep-dive.md`
- `addWatchedTitle` mutation'ını fiilen kullanan yayında, MIT lisanslı betik (kanıt):
  `github.com/Juwan-Hwang/douban2imdb` → `douban2imdb.user.js` (Greasy Fork #596763)
- Bu depodaki betik: `Trakt1000/imdb-watched-marker/` (README + 19 test)
- IMDb ürün yöneticisi yanıtı — "bölüm işaretlenebilir, sezon işaretlenemez", sezon toplu
  işaretleme ve yüzde göstergesi backlog'da:
  <https://community-imdb.sprinklr.com/conversations/imdbcom/imdb-introduces-watched-formerly-known-as-seen/67ea80e2dedd5e250dbb2bdb>
- Trakt dışa aktarma ekranının kaynak kodu (hangi uçların ZIP'e girdiği):
  `trakt/trakt-web` → `projects/client/src/lib/sections/settings/export/runRawExport.ts`
- Trakt limit hatalarının işlenişi (`HTTP 420`, `X-Account-Limit`,
  `total_list_item_limit_reached`): `trakt/trakt-web` PR #3796
- Plex'in Trakt ZIP içe aktarımı: <https://support.plex.tv/articles/importing-list-data/>
- Simkl'in Trakt ZIP içe aktarımı: <https://simkl.com/apps/import/trakt/>
- My Lists (Trakt listesi → IMDb CSV): <https://mylistsaddon.com/>
