# IMDb ↔ Trakt Köprüsü (canlı)

Trakt'ı **bağlı uygulama olarak kaydetmeden**, tarayıcındaki kendi Trakt oturumunu
kullanarak veriyi canlı okur ve IMDb'ye yazar. `imdb-watched-marker`'ın genel
sürümüdür: hedef tek değil, **dört** tanedir.

| | |
|---|---|
| Dosya | `imdb-trakt-bridge.user.js` (tek dosya, bağımlılık yok, ~1.865 satır) |
| Sürüm | 0.1.0 |
| Çalıştığı yerler | `https://app.trakt.tv/*` **ve** `https://www.imdb.com/*` |
| Gereken izinler | `GM_setValue/GM_getValue/GM_deleteValue`, `GM_xmlhttpRequest`, `unsafeWindow` |
| Test | `npm test` → **36/36 geçiyor** · `npm run check` → sözdizimi tamam |
| Lisans | MIT |

> **Doğrulama durumu:** uç noktalar ve mutation gövdeleri kaynak koddan okunarak
> yazıldı (aşağıda tek tek kaynakları var). Bu sandbox'ta IMDb/Trakt oturumu olmadığı
> için betik **işlevsel olarak burada denenemedi**; statik denetim + birim testler
> yapıldı. İlk çalıştırmada **kuru çalıştırma açık** başla, sonra "tek deneme" ile
> hedef başına bir öğe yaz, en son toplu çalıştır.

---

## 1. Neden iki sayfa?

Trakt token'ı `app.trakt.tv`'nin `localStorage`'ında durur; `imdb.com`'dan okunamaz
(aynı origin değil). Bu yüzden betik iki yerde çalışır ve veriyi **Tampermonkey'nin
kendi deposu** (`GM_setValue`) ile taşır — bu depo origin'ler arasında ortaktır:

```
app.trakt.tv  ──(1) token'ı oku ──(2) API'den çek──▶  GM deposu  ──(3)──▶  www.imdb.com  ──(4) yaz──▶  IMDb
```

`GM_setValue` yoksa (bazı tarayıcı/eklenti kombinasyonları) betik çalışmaya devam eder
ama depo **paylaşılmaz**: Trakt sayfasında **JSON indir**, IMDb sayfasında **JSON yükle**
de. Panel bunu durum satırında söyler.

## 2. Kurulum

1. Tampermonkey (veya Violentmonkey) kurulu olsun.
2. Bu dosyayı aç/sürükle ya da Tampermonkey → *Yeni betik oluştur* → içeriği yapıştır → kaydet.
3. `app.trakt.tv`'yi aç (oturum açık olmalı) → sağ alttaki **⇄** düğmesi → panel.
4. İzin sorulursa `GM_xmlhttpRequest` ve depolama izinlerini ver.

## 3. Kullanım — Trakt tarafı (`app.trakt.tv`)

**1 · Bağlantı**
- **Token'ı oku**: `localStorage`'daki `oidc.user:https://auth.trakt.tv:<client_id>`
  anahtarını bulur, `access_token`'ı alır. Token hiçbir yere gönderilmez, yalnız
  `api.trakt.tv` isteklerinde `Authorization: Bearer` olarak kullanılır.
- **Kapasiteyi göster**: `GET /users/me/usage` → `total_list_items`, `connected_apps`,
  `history` … kovaları için `current / free / kalan / vip` tablosu. 1.000'lik liste
  kotanın ne kadarının dolduğunu burada görürsün.
- Süre dolmuşsa panel uyarır: sayfayı yenile ya da Trakt'tan çık/gir yap.
- Anahtar bulunamazsa token'ı elle yapıştırma alanı var (yalnız o sekme için geçerli).

**2 · Kaynaklar** — hangisini çekeceğini seç, her biri depoya satır olarak eklenir:

| Düğme | Trakt ucu | Depodaki hedef |
|---|---|---|
| Listeleri getir → seç → çek | `/users/me/lists` + `/users/me/lists/{slug}/items?extended=full` | `list` (kaynak = liste adı) |
| Watchlist → depoya | `/users/me/watchlist` (tümü) | `watchlist` |
| İzlenenler (movies/shows) | `/sync/watched/{type}` | `watched` |
| Puanlar (movies/shows/episodes/all) | `/sync/ratings/{type}` | `rating` |
| Hepsini çek | yukarıdakiler sırayla | — |

Her çekimde atlananlar günlüğe yazılır: `imdb-yok` (Trakt'ta IMDb kimliği boş),
`kisi-nm` (kişi kaydı, IMDb listesine yazılamaz), `taninmayan-kayit`.

**3 · Depo** — satır sayısı, hedef/tür dağılımı, JSON/CSV indir-yükle, temizle.

## 4. Kullanım — IMDb tarafı (`www.imdb.com`)

### 4.0 "0 · Depo (Trakt'tan gelen)" bölümü ne işe yarar?

**Depo, iki sayfa arasındaki aktarma istasyonudur.** Trakt sekmesinde çektiğin satırlar
burada birikir; IMDb tarafında yapılan her şey bu satırları okur. Yani Depo bölümü
**yazma yeri değil, kontrol yeridir**: kaç satır geldi, hangi hedeflere/türlere dağıldı,
doğru veri mi geldi?

Depo bölümündeki düğmeler:

| Düğme | Ne yapar |
|---|---|
| **Yenile** | Depoyu **GM deposundan yeniden okur** (Trakt sekmesinde yeni çekim yaptıysan burada görünür) ve satır sayısını/dağılımı tazeler |
| **JSON indir** | Depoyu `{version, meta, rows}` olarak dosyaya yazar → GM deposu paylaşılmıyorsa eliyle taşıma, ya da yedek |
| **CSV indir** | `const,type,target,label,rating,date,source,listId` başlıklı CSV → Excel/Sheets'te gözden geçirme |
| **JSON/CSV yükle** | Dosyadan satır ekler: köprünün kendi JSON/CSV'si, Trakt ZIP'inin `*.json` dosyaları, IMDb CSV'leri, NDJSON, düz `tt…` metni |
| **Depoyu temizle** | Satırları, meta'yı, sırayı ve ilerlemeyi siler (yeni bir çekime temiz başlamak için) |

Altındaki iki satır bilgi: **özet** (`1240 satır · hedef → list: 412 · watched: 828 · tür → movie: 300 · show: 112 · episode: 828`) ve **meta** (çekim zamanı, Trakt kullanıcısı, çekim başına sayılar).

**Veri buraya nasıl gelir?** İki yol:

1. **GM deposu varsa (normal yol):** Trakt sekmesinde çek → IMDb sekmesine geç. Panel
   her açılışta, sekme her odaklandığında ve **Yenile**'de depoyu tazelediği için
   satırlar kendiliğinden görünür. Sayfayı yenilemen gerekmez.
2. **GM deposu yoksa:** Trakt sekmesinde **JSON indir** → IMDb sekmesinde **JSON/CSV
   yükle** → dosyayı seç. Özet satırında `(GM deposu yok: sayfalar arası taşıma JSON ile)`
   uyarısını görüyorsan bu yolu kullan.

**Sıra satırı (2. bölüm):** Depo tazelenince `Sıra: N öğe (list: 412 · watched: 828)`
satırı da güncellenir; hedef/tür kutularını değiştirdiğinde anında değişir. Yazılamayacak
satırlar gerekçesiyle listelenir: *puansız* (puan hedefi seçili ama satırda puan yok) veya
*liste kimliği (ls…) yok* (liste hedefi seçili ama `ls…` girilmemiş ve mod "mevcut liste").

### 4.1 Bölümler

**0/1 · Durum**: IMDb oturumu açık mı (`imdb.com` ana sayfasındaki hesap düğmesi
sınanır), GM deposu var mı, depoda kaç satır var.

**2 · Hedefler**: `liste`, `watchlist`, `izlendi (Watched)`, `puan` kutuları + tür
filtreleri (film, dizi gövdesi, bölüm; sezon ve kişi varsayılan **kapalı** çünkü IMDb
bunları kabul etmez). **Sırayı önizle** düğmesi yazılacak öğe sayısını, tür/hedef
dağılımını ve iki uyarıyı gösterir:

- *gövde + bölüm çakışması*: IMDb'de gövdeyi işaretlemek bölümlerini işaretlemez
  (tersi de geçerli) — ikisi birden sıradaysa içerik iki kez yazılmış olur.
- *12.000 kap*: bir hedefe 12.000'den fazla öğe gidiyorsa fazlası reddedilir.

**3 · Liste hedefi** (yalnız `liste` hedefi için):

| Mod | Ne yapar |
|---|---|
| mevcut liste | Bir `ls…` kimliği kullanır. Liste sayfasındayken **Bu sayfadaki ls kimliğini al** düğmesi adresi okur |
| tek yeni liste | Verdiğin adla bir kez `createList` çalıştırır, dönen `listId`'yi saklar, tüm öğeleri oraya basar |
| Trakt listesi başına yeni liste | Her kaynak liste adı için ayrı bir IMDb listesi oluşturur (18 listeyi taşırken pratik) |

Yeni listeler `allowDuplicates: false`, `listType: TITLES`, varsayılan `PRIVATE` ile
oluşur. **Yeni liste oluştur** düğmesi bunu elle, çalıştırmadan önce yapmanı sağlar.

**4 · Çalıştır**: kuru çalıştırma (varsayılan **açık**), gecikme (varsayılan 650 ms) +
rastgele ek (250 ms), **tek deneme** (`tt…` + hedef), Başlat / Duraklat / Devam /
Durdur. 429 ve 5xx için 5-15-30 sn kademeli bekleme (en çok 3 deneme), art arda 5
hatada otomatik durma, oturum hatasında (401/403) hemen durma. Sıra depoya yazılır,
yarım kalırsa **Başlat** ile kaldığı yerden sürer.

**5 · Dışa aktar**: kuyruk CSV (`const,type,target,label,rating,date,source,listId,status,message`),
başarısızlar CSV, günlük metni.

**6 · Yakalama modu**: IMDb bir mutation adını değiştirirse, dinlemeyi aç → aynı işlemi
IMDb arayüzünde bir kez elle yap → betik çağrıyı (`operationName`, `query`, `variables`)
kaydeder; JSON olarak indirebilirsin. Bu, betikteki gövdeleri güncellemenin yoludur.

### 4.2 İlk çalıştırma kontrol listesi

1. `app.trakt.tv` → panel → **Token'ı oku** (yeşil ✓ olmalı) → **Kapasiteyi göster**.
2. **Listeleri getir** → taşınacak listeleri işaretle → **Seçilen listeleri çek → depoya**.
   Gerekirse watchlist/izlenen/puan düğmeleri.
3. `www.imdb.com` → panel → **0 · Depo**'da satır sayısını gör (gelmediyse **Yenile**;
   yine yoksa Trakt sekmesinde **JSON indir** → burada **JSON/CSV yükle**).
4. **1 · Durum**: `✓ IMDb oturumu açık` mı? Kırmızıysa önce giriş yap.
5. **2 · Hedefler**: hangi hedeflere yazacaksan işaretle; türlerde **sezon** ve **kişi**
   kapalı kalsın (IMDb kabul etmez). **Sırayı önizle** → uyarıları oku.
6. **3 · Liste hedefi**: mevcut `ls…` gir (bir liste sayfasındayken **Bu sayfadaki ls
   kimliğini al**) ya da "tek yeni liste" / "Trakt listesi başına yeni liste" seç.
7. **4 · Çalıştır**: kuru çalıştırma **açıkken** Başlat → günlüğü oku (hiçbir şey yazmaz).
   Sonra **tek deneme**: bir `tt…` + hedef seç, kuru çalıştırmayı kapat, **Dene**.
   Başarılıysa kuru çalıştırmayı kapalı bırakıp **Başlat**.
8. İş bitince **5 · Dışa aktar** → *Kuyruk CSV* (her satırın `status`/`message` alanı) ve
   gerekiyorsa *Başarısızlar CSV*. Başarısızları düzeltip aynı CSV'yi **JSON/CSV yükle**
   ile geri yükleyip yeniden çalıştırabilirsin.

## 5. Yazma uçları ve doğrulama kaynakları

| Hedef | IMDb ucu | Kaynak (doğrulandı) |
|---|---|---|
| liste oluştur | `POST api.graphql.imdb.com` · `createList(input:{name,listDescription,allowDuplicates,listType,visibility}) { listId }` | `TobiasPankner/Letterboxd-to-IMDb` · `create_imdb_list` |
| listeye öğe | `addItemToList(input:{listId,item:{itemElementId:"tt…"}}) { listId }` | aynı depo · `add_to_imdb_list` |
| puan | `rateTitle(input:{rating,titleId}) { rating{value} }` | aynı depo · `rate_on_imdb` (+ Greasy Fork #463836) |
| izlendi | `addWatchedTitle(titleId) { success }` | `Juwan-Hwang/douban2imdb` (MIT) |
| watchlist | **REST:** `PUT https://www.imdb.com/watchlist/tt…` | `Letterboxd-to-IMDb` · `add_to_imdb_watchlist` |

GraphQL başlıkları: `content-type: application/json`, `accept: application/graphql+json`,
`x-imdb-client-name: imdb-web-next`, `x-imdb-consent-info: eyJhZ2VTaWduYWwiOiJBRFVMVCIsImlzR2RwciI6ZmFsc2V9`,
istek `imdb.com` sayfasından ve oturum çerezleriyle (`credentials: 'include'`).

**Doğrulanmamış / dikkat:**
- Watchlist'ten **çıkarma**: kodda `imdb.watchlist(id, true)` → `DELETE` olarak var ama
  arayüzde düğmesi yok; `DELETE` ucu hiçbir kaynakta doğrulanmadı. Gerekirse önce tek
  denemeyle sınanmalı.
- Trakt'ta `/sync/watched/episodes` **bölüm düzeyinde** izlenenleri döndürür mü, burada
  doğrulanamadı. Panelde "denenmemiş" olarak işaretli. 0 satır gelirse şaşırmayın:
  bölüm geçmişi için güvenilir kaynak Trakt ZIP'i (`watched-history-*.json`) ve bu
  dosyalar **JSON/CSV yükle** ile doğrudan kabul edilir (hedef `watched` sayılır).
- Trakt uçlarından ikisi kaynak koddan birebir doğrulandı
  (`/v3/users/me/usage`, `/v3/users/me/watched/shows/plays?limit=all`); diğer uçlar Trakt'ın
  belgelenmiş genel yollarıdır. Betikte tüm yollar `traktPath()` içinde tek yerde
  toplanmıştır — biri farklıysa oradan düzeltilebilir.
- IMDb'nin GraphQL arayüzü resmî değildir; değişebilir. Kırılırsa yakalama modu ile
  yeni adı öğrenirsin.

## 6. Sınırlar

| Sınır | Değer | Etkisi |
|---|---|---|
| IMDb liste / watchlist / check-in | **12.000** öğe | Fazlası reddedilir; listeleri böl |
| IMDb Watched ("izleme geçmişi") | belgelenmiş tavan **yok** | 14.400 geçmiş buraya sığar |
| IMDb listeleri | 999 liste, başlık ≤255, not ≤10.000 | Liste adı otomatik kırpılır |
| IMDb tarih | geriye tarih yazılamaz | `watched_at`/`rated_at` taşınmaz, tarih = yazma anı |
| Trakt `total_list_items` | ücretsiz **1.000** | Köprünün var olma sebebi |
| Trakt `connected_apps` | ücretsiz **1** | Bu betik slotu **harcamaz** (kendi oturumunu kullanır) |

## 7. Hukuki / etik not

İki tarafın da kullanıcı verisi uçları resmî API değil: Trakt'ın kendi web sitesinin
oturumu ve IMDb'nin kendi web arayüzünün GraphQL ucu kullanılıyor. Kendi hesabının
verisini, kendi tarayıcında, kendi hızında taşımak için tasarlandı. IMDb'nin iç
API'sinin kamusal/ticari kullanımı yasak; hız sınırlarını aşma, eşzamanlı çok sekme
açma, ticari amaçla kullanma. Token'ını kimseyle paylaşma — betik onu yalnızca
`api.trakt.tv`'ye gönderir.

## 8. `imdb-watched-marker` ile ilişkisi

| | `imdb-watched-marker` | `imdb-trakt-bridge` (bu) |
|---|---|---|
| Kaynak | Trakt ZIP dosyaları, IMDb CSV, düz metin | **Trakt API'den canlı** + dosyalar |
| Hedef | yalnız Watched | liste, watchlist, Watched, puan |
| Bölüm ölçeği (14.400) | **evet, bunun için yapıldı** | evet ama ZIP/dosya ile beslemek gerekir |
| Sayfa | yalnız `imdb.com` | `app.trakt.tv` + `imdb.com` |
| İzinler | `@grant none` | GM deposu + `GM_xmlhttpRequest` |

İkisi aynı anda kurulabilir (farklı paneller) ama **aynı anda çalıştırma**: ikisi de
IMDb'ye yazar, hız sınırını birlikte tetiklersin. Yakalama modunu da aynı anda yalnız
birinde aç (ikisi de `fetch`/XHR'ı sarar).

## 9. Geliştirme

```bash
cd Trakt1000/imdb-trakt-bridge
npm run check     # node --check
npm test          # node --test tests/bridge.test.mjs  → 36 test
```

Testler betiğin `/* __PURE_START__ */ … /* __PURE_END__ */` arasındaki saf çekirdeğini
(DOM ve ağ kullanmayan bölüm) Node'da çalıştırır: token çıkarma, Trakt yolları, kapasite
özeti, Trakt kaydı → satır dönüşümü (film/dizi/bölüm/`imdb:null`/`nm`), birleştirme ve
tekilleştirme, hedef/tür filtreleri, gövde-bölüm çakışması ve 12.000 uyarıları, dört
GraphQL gövdesi, watchlist REST adresi, hata sınıflandırma, bekleme kademeleri, CSV
gidiş-dönüşü.

Saf çekirdeğe dokunursan testleri de güncelle; arayüz/ağ kodu değişse bile testler
çalışmaya devam eder.
