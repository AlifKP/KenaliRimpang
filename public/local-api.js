/* KenaliRimpang - versi Netlify (tanpa server Python).
   File ini menggantikan backend FastAPI: semua panggilan fetch ke /predict, /feedback dan /api/*
   dicegat dan dijalankan DI BROWSER:
     - klasifikasi memakai TensorFlow.js (model di folder model/)
     - akun dan riwayat disimpan di localStorage browser (per perangkat)
     - laporan prediksi salah dikirim ke Discord lewat Netlify Function (netlify/functions/feedback.mjs)
   script.js tidak perlu tahu bedanya. */
(() => {
  "use strict";

  // ------------------------------------------------------------ pengaturan
  const CFG = {
    wajibLogin: true,        // true = pengguna harus masuk dulu (sama seperti WAJIB_LOGIN di app.py)
    minKeyakinan: 0.60,      // keyakinan tertinggi minimal (MIN_KEYAKINAN di app.py)
    minSelisih: 0.30,        // selisih jawaban ke-1 dan ke-2 minimal (MIN_SELISIH di app.py)
    maxRiwayat: 50,          // riwayat terlama dihapus otomatis
    thumbUkuran: 256,
    maxUploadMB: 15,
    sesiHari: 30,
    pbkdf2: 200000,
    modelDir: "model/",
    feedbackUrl: "/.netlify/functions/feedback",
  };
  const CLASSES = ["Jahe", "Kencur", "Kunyit", "Lengkuas", "Temulawak"];
  const DATA = {
  "info": {
    "Jahe": {
      "nama_latin": "Zingiber officinale",
      "ciri_fisik": "Bercabang seperti jari tangan dengan ruas yang jelas. Kulit tipis krem kecokelatan, daging kuning pucat dan berserat.",
      "aroma": "Hangat, pedas, dan segar menyengat.",
      "manfaat": [
        "Menghangatkan badan dan membantu meredakan mual",
        "Bahan wedang jahe, bandrek, dan bumbu masakan",
        "Dipakai dalam ramuan jamu tradisional"
      ],
      "tips_membedakan": "Dagingnya kuning pucat, bukan oranye seperti kunyit, dan rasanya jauh lebih pedas."
    },
    "Kencur": {
      "nama_latin": "Kaempferia galanga",
      "ciri_fisik": "Kecil, gemuk, bulat-lonjong, tumbuh bergerombol. Kulit cokelat muda, daging putih krem dan padat.",
      "aroma": "Harum tajam khas, agak seperti kamper, dengan rasa pedas ringan.",
      "manfaat": [
        "Bahan utama jamu beras kencur",
        "Bumbu pecel, urap, dan sambal",
        "Secara tradisional dipakai untuk meredakan batuk dan pegal"
      ],
      "tips_membedakan": "Ukurannya paling kecil dari kelimanya dan bentuknya membulat, tidak memanjang."
    },
    "Kunyit": {
      "nama_latin": "Curcuma longa",
      "ciri_fisik": "Ramping, memanjang, dan bercabang. Kulit kuning kecokelatan, daging oranye cerah menyala.",
      "aroma": "Hangat, earthy, dan sedikit pahit.",
      "manfaat": [
        "Pewarna alami nasi kuning, kari, dan soto",
        "Mengandung kurkumin yang diteliti sebagai antiinflamasi",
        "Bahan jamu kunyit asam"
      ],
      "tips_membedakan": "Warna daging oranye terang yang mewarnai jari saat dipatahkan adalah ciri paling mudah."
    },
    "Lengkuas": {
      "nama_latin": "Alpinia galanga",
      "ciri_fisik": "Besar, keras, dan berserat kuat. Kulit krem kemerahan dengan garis ruas melingkar, daging putih kekuningan.",
      "aroma": "Segar seperti jeruk dan pinus, rasa pedas bersih.",
      "manfaat": [
        "Bumbu soto, rawon, rendang, dan gulai",
        "Mengharumkan masakan berkuah santan",
        "Digunakan dalam pengobatan tradisional untuk gangguan pencernaan"
      ],
      "tips_membedakan": "Teksturnya paling keras dan seratnya kasar, dengan garis ruas melingkar yang rapat."
    },
    "Temulawak": {
      "nama_latin": "Curcuma zanthorrhiza",
      "ciri_fisik": "Besar dan gemuk, bercabang tebal. Kulit kuning kecokelatan, daging kuning tua hingga oranye kecokelatan.",
      "aroma": "Tajam, pahit, dan lebih pekat daripada kunyit.",
      "manfaat": [
        "Bahan jamu yang secara tradisional dipakai untuk menjaga fungsi hati",
        "Dipercaya membantu menambah nafsu makan",
        "Diolah menjadi serbuk instan dan minuman kesehatan"
      ],
      "tips_membedakan": "Mirip kunyit tetapi jauh lebih besar dan daging oranyenya lebih tua, cenderung kecokelatan."
    }
  },
  "disclaimer": "Informasi bersifat edukatif dan bukan pengganti saran medis."
};
  const RIMPANG_INFO = DATA.info;
  const DISCLAIMER = DATA.disclaimer;

  const nativeFetch = window.fetch.bind(window);
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  const galat = (status, detail) => json({ detail }, status);
  class Galat extends Error { constructor(status, pesan) { super(pesan); this.status = status; } }

  // ------------------------------------------------------------ penyimpanan (localStorage)
  const K_USERS = "kr_users", K_SESI = "kr_sesi", K_LAPORAN = "kr_laporan", K_RIWAYAT = "kr_riwayat:";
  const simpan = {
    ambil(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    taruh(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    hapus(k) { try { localStorage.removeItem(k); } catch { /* abaikan */ } },
  };

  // ------------------------------------------------------------ akun
  const POLA_USERNAME = /^[A-Za-z0-9._-]{3,30}$/;
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  const dariHex = (h) => new Uint8Array((h.match(/../g) || []).map((x) => parseInt(x, 16)));

  async function hashSandi(sandi, garamHex, iterasi) {
    if (!window.crypto || !crypto.subtle) throw new Galat(500, "Browser ini tidak mendukung penyimpanan sandi aman. Buka lewat https.");
    const kunci = await crypto.subtle.importKey("raw", new TextEncoder().encode(sandi), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: dariHex(garamHex), iterations: iterasi }, kunci, 256);
    return hex(new Uint8Array(bits));
  }

  function validasi(username, sandi) {
    username = (username || "").trim();
    sandi = sandi || "";
    if (!POLA_USERNAME.test(username)) throw new Galat(400, "Nama pengguna 3-30 karakter: huruf, angka, titik, garis bawah, atau strip.");
    if (sandi.length < 6) throw new Galat(400, "Kata sandi minimal 6 karakter.");
    if (sandi.length > 128) throw new Galat(400, "Kata sandi maksimal 128 karakter.");
    return [username, sandi];
  }

  function mulaiSesi(kunciUser) {
    simpan.taruh(K_SESI, { user: kunciUser, exp: Date.now() + CFG.sesiHari * 86400000 });
  }

  function penggunaSaatIni() {
    const s = simpan.ambil(K_SESI, null);
    if (!s || !s.user || s.exp < Date.now()) return null;
    const u = simpan.ambil(K_USERS, {})[s.user];
    return u ? { key: s.user, username: u.username } : null;
  }

  async function daftar(username, sandi) {
    [username, sandi] = validasi(username, sandi);
    const users = simpan.ambil(K_USERS, {});
    const key = username.toLowerCase();
    if (users[key]) throw new Galat(409, "Nama pengguna sudah dipakai di perangkat ini. Coba nama lain.");
    const garam = hex(crypto.getRandomValues(new Uint8Array(16)));
    users[key] = { username, garam, iterasi: CFG.pbkdf2, hash: await hashSandi(sandi, garam, CFG.pbkdf2), dibuat: new Date().toISOString() };
    if (!simpan.taruh(K_USERS, users)) throw new Galat(500, "Penyimpanan browser penuh atau dinonaktifkan.");
    mulaiSesi(key);
    return { login: true, username };
  }

  async function masuk(username, sandi) {
    username = (username || "").trim();
    const key = username.toLowerCase();
    const u = simpan.ambil(K_USERS, {})[key];
    // Pesan sengaja sama untuk "pengguna tidak ada" dan "sandi salah"
    if (!u) throw new Galat(401, "Nama pengguna atau kata sandi salah.");
    if ((await hashSandi(sandi || "", u.garam, u.iterasi)) !== u.hash) throw new Galat(401, "Nama pengguna atau kata sandi salah.");
    mulaiSesi(key);
    return { login: true, username: u.username };
  }

  const wajibLogin = () => {
    const u = penggunaSaatIni();
    if (!u) throw new Galat(401, "Silakan masuk terlebih dahulu.");
    return u;
  };

  // ------------------------------------------------------------ riwayat
  const kunciRiwayat = (u) => K_RIWAYAT + u.key;

  function simpanRiwayat(u, item) {
    let daftarRiwayat = simpan.ambil(kunciRiwayat(u), []);
    item.id = (daftarRiwayat.reduce((m, r) => Math.max(m, r.id), 0)) + 1;
    daftarRiwayat.unshift(item);
    daftarRiwayat = daftarRiwayat.slice(0, CFG.maxRiwayat);
    // Jika penyimpanan penuh, buang riwayat terlama sampai muat
    while (!simpan.taruh(kunciRiwayat(u), daftarRiwayat) && daftarRiwayat.length > 1) daftarRiwayat.pop();
    return item.id;
  }

  // ------------------------------------------------------------ model TensorFlow.js
  // ------------------------------------------------------------ penyesuaian model Keras 3 -> TF.js (layers)
  // TF.js belum paham beberapa penulisan konfigurasi Keras 3, jadi model.json diterjemahkan dulu di memori.
  function perbaikiKeras3(node) {
    if (Array.isArray(node)) { node.forEach(perbaikiKeras3); return node; }
    if (!node || typeof node !== "object") return node;

    // batch_shape (Keras 3) -> batch_input_shape (TF.js)
    if (node.batch_shape && !node.batch_input_shape) node.batch_input_shape = node.batch_shape;
    // dtype berbentuk objek DTypePolicy -> teks biasa
    if (node.dtype && typeof node.dtype === "object" && node.dtype.class_name === "DTypePolicy") {
      node.dtype = (node.dtype.config && node.dtype.config.name) || "float32";
    }
    // Daftar layer: terjemahkan inbound_nodes gaya Keras 3 ke gaya lama [[nama, node, tensor, {}], ...]
    if (Array.isArray(node.layers)) {
      const kumpul = (x, hasil) => {
        if (x && x.class_name === "__keras_tensor__" && x.config && x.config.keras_history) {
          const [nama, n, t] = x.config.keras_history;
          hasil.push([nama, n, t, {}]);
        } else if (Array.isArray(x)) x.forEach((y) => kumpul(y, hasil));
        else if (x && typeof x === "object") Object.values(x).forEach((y) => kumpul(y, hasil));
        return hasil;
      };
      node.layers.forEach((l) => {
        if (Array.isArray(l.inbound_nodes)) {
          l.inbound_nodes = l.inbound_nodes.map((nd) => (nd && !Array.isArray(nd) && nd.args ? kumpul(nd.args, []) : nd));
        }
      });
      // input_layers / output_layers tunggal ditulis datar: ["nama", 0, 0] -> [["nama", 0, 0]]
      ["input_layers", "output_layers"].forEach((k) => {
        if (Array.isArray(node[k]) && typeof node[k][0] === "string") node[k] = [node[k]];
      });
    }
    Object.keys(node).forEach((k) => perbaikiKeras3(node[k]));
    return node;
  }

  async function muatLayersKeras3(url) {
    const artefak = await tf.io.http(url).load();
    perbaikiKeras3(artefak.modelTopology);
    return tf.loadLayersModel({ load: async () => artefak });
  }

  let modelPromise = null;
  let cfgModel = null;

  function muatModel() {
    if (!modelPromise) {
      modelPromise = (async () => {
        if (typeof tf === "undefined") throw new Galat(500, "TensorFlow.js gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.");
        const r = await nativeFetch(CFG.modelDir + "config.json", { cache: "no-store" });
        if (!r.ok) throw new Galat(500, "Model belum dipasang: file model/config.json tidak ditemukan.");
        cfgModel = await r.json();
        const url = CFG.modelDir + "model.json";
        const model = cfgModel.format === "layers" ? await muatLayersKeras3(url) : await tf.loadGraphModel(url);
        const s = cfgModel.img_size;
        tf.tidy(() => { // pemanasan agar prediksi pertama tidak lambat
          let o = model.predict(tf.zeros([1, s, s, 3]));
          if (Array.isArray(o)) o = o[0];
          o.dataSync();
        });
        return model;
      })();
      modelPromise.catch(() => { modelPromise = null; });
    }
    return modelPromise;
  }
  // Mulai memuat model di latar belakang supaya klasifikasi pertama terasa cepat
  window.addEventListener("load", () => { setTimeout(() => muatModel().catch(() => {}), 300); });

  async function bacaGambar(file) {
    if (!file || (file.type && !file.type.startsWith("image/"))) throw new Galat(400, "File harus berupa gambar (JPG, PNG, atau WEBP).");
    if (file.size > CFG.maxUploadMB * 1024 * 1024) throw new Galat(413, `Ukuran gambar maksimal ${CFG.maxUploadMB} MB.`);
    try {
      try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
      catch { return await createImageBitmap(file); }
    } catch {
      throw new Galat(400, "Gambar tidak dapat dibaca. Coba file lain (JPG, PNG, atau WEBP).");
    }
  }

  // Perkecil bertahap (dibagi dua berulang) supaya hasilnya mendekati resize PIL di versi Python
  function gambarKeKanvas(bmp, sisiBaru) {
    let sumber = bmp, w = bmp.width, h = bmp.height;
    while (w / 2 >= sisiBaru && h / 2 >= sisiBaru) {
      const c = document.createElement("canvas");
      w = Math.floor(w / 2); h = Math.floor(h / 2);
      c.width = w; c.height = h;
      const x = c.getContext("2d");
      x.imageSmoothingQuality = "high";
      x.drawImage(sumber, 0, 0, w, h);
      sumber = c;
    }
    const akhir = document.createElement("canvas");
    akhir.width = akhir.height = sisiBaru;
    const x = akhir.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.drawImage(sumber, 0, 0, sisiBaru, sisiBaru);
    return akhir;
  }

  function miniatur(bmp, sisi) {
    const skala = Math.min(1, sisi / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * skala));
    c.height = Math.max(1, Math.round(bmp.height * skala));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  }

  function softmax(a) {
    const m = Math.max(...a);
    const e = a.map((v) => Math.exp(v - m));
    const t = e.reduce((p, q) => p + q, 0);
    return e.map((v) => v / t);
  }

  async function prediksi(bmp) {
    const model = await muatModel();
    const s = cfgModel.img_size;
    const pre = cfgModel.preprocess || "none";
    const kanvas = gambarKeKanvas(bmp, s);
    const keluaran = tf.tidy(() => {
      let x = tf.browser.fromPixels(kanvas).toFloat();
      if (pre === "rescale") x = x.div(255);
      else if (pre === "mobilenet") x = x.div(127.5).sub(1);
      else if (pre === "imagenet") x = x.div(255).sub(tf.tensor1d([0.485, 0.456, 0.406])).div(tf.tensor1d([0.229, 0.224, 0.225]));
      let o = model.predict(x.expandDims(0));
      if (Array.isArray(o)) o = o[0];
      return o.reshape([-1]);
    });
    let arr = Array.from(await keluaran.data());
    keluaran.dispose();
    const jumlah = arr.reduce((p, q) => p + q, 0);
    if (Math.abs(jumlah - 1) > 1e-3 || arr.some((v) => v < 0)) arr = softmax(arr); // model mengeluarkan logits
    return arr;
  }

  async function onPredict(init) {
    const user = penggunaSaatIni();
    if (CFG.wajibLogin && !user) throw new Galat(401, "Silakan masuk terlebih dahulu.");
    const file = init && init.body instanceof FormData ? init.body.get("file") : null;
    const bmp = await bacaGambar(file);
    const t0 = performance.now();
    let probs;
    try {
      probs = await prediksi(bmp);
    } catch (e) {
      if (e instanceof Galat) throw e;
      console.error(e);
      throw new Galat(500, "Model gagal memproses gambar. Muat ulang halaman lalu coba lagi.");
    }
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    const ranking = CLASSES.map((c, i) => ({ label: c, probability: probs[i] })).sort((a, b) => b.probability - a.probability);
    const top = ranking[0];

    let alasan = null;
    if (top.probability < CFG.minKeyakinan) alasan = "keyakinan_rendah";
    else if (top.probability - ranking[1].probability < CFG.minSelisih) alasan = "ragu";

    const hasil = alasan
      ? { ditolak: true, alasan, ambang: { keyakinan: CFG.minKeyakinan, selisih: CFG.minSelisih }, tebakan: ranking[0], kedua: ranking[1], mode: "tfjs", inference_ms: ms, login: user !== null, tersimpan: false }
      : { label: top.label, confidence: top.probability, probabilities: ranking, info: { ...RIMPANG_INFO[top.label], disclaimer: DISCLAIMER }, mode: "tfjs", inference_ms: ms, login: user !== null, tersimpan: false };

    if (user) {
      try {
        hasil.riwayat_id = simpanRiwayat(user, {
          label: top.label, confidence: top.probability, probabilities: ranking,
          time: new Date().toISOString(), ada_foto: true, ditolak: Boolean(alasan), foto: miniatur(bmp, CFG.thumbUkuran),
        });
        hasil.tersimpan = true;
      } catch (e) { console.warn("Gagal menyimpan riwayat:", e); }
    }
    if (bmp.close) bmp.close();
    return hasil;
  }

  // ------------------------------------------------------------ laporan prediksi salah
  async function perkecilJpeg(file, sisi = 1024) {
    const bmp = await bacaGambar(file);
    const skala = Math.min(1, sisi / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * skala));
    c.height = Math.max(1, Math.round(bmp.height * skala));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
  }

  async function onFeedback(init) {
    const user = penggunaSaatIni();
    if (CFG.wajibLogin && !user) throw new Galat(401, "Silakan masuk terlebih dahulu.");
    const src = init && init.body instanceof FormData ? init.body : new FormData();
    const fd = new FormData();
    for (const k of ["predicted_label", "correct_label", "confidence", "note"]) fd.append(k, String(src.get(k) ?? ""));
    const file = src.get("file");
    if (file && file.size) { try { fd.append("file", await perkecilJpeg(file), "laporan.jpg"); } catch { /* kirim tanpa foto */ } }
    try {
      const r = await nativeFetch(CFG.feedbackUrl, { method: "POST", body: fd });
      if (r.ok) return await r.json();
    } catch { /* jatuh ke cadangan di bawah */ }
    // Cadangan: Discord belum diatur / function tidak tersedia -> catat teks di browser ini saja
    const log = simpan.ambil(K_LAPORAN, []);
    log.push({ waktu: new Date().toISOString(), tebakan: String(src.get("predicted_label") || ""), seharusnya: String(src.get("correct_label") || ""), catatan: String(src.get("note") || "").slice(0, 500) });
    simpan.taruh(K_LAPORAN, log.slice(-100));
    return { status: "saved-local" };
  }

  // ------------------------------------------------------------ router
  async function tangani(method, path, init) {
    const body = init && init.body instanceof FormData ? init.body : null;
    if (method === "POST" && path === "/api/daftar") return await daftar(body?.get("username"), body?.get("password"));
    if (method === "POST" && path === "/api/masuk") return await masuk(body?.get("username"), body?.get("password"));
    if (method === "POST" && path === "/api/keluar") { simpan.hapus(K_SESI); return { login: false }; }
    if (method === "GET" && path === "/api/saya") {
      const u = penggunaSaatIni();
      return { login: u !== null, username: u ? u.username : null, wajib_login: CFG.wajibLogin };
    }
    if (method === "GET" && path === "/api/health") return { status: "ok", mode: "tfjs", classes: CLASSES };
    if (method === "GET" && path === "/api/riwayat") {
      const u = wajibLogin();
      return { items: simpan.ambil(kunciRiwayat(u), []), maks: CFG.maxRiwayat };
    }
    if (method === "DELETE" && path === "/api/riwayat") {
      const u = wajibLogin();
      const n = simpan.ambil(kunciRiwayat(u), []).length;
      simpan.hapus(kunciRiwayat(u));
      return { status: "dihapus", jumlah: n };
    }
    let m = path.match(/^\/api\/riwayat\/(\d+)$/);
    if (method === "DELETE" && m) {
      const u = wajibLogin();
      const id = Number(m[1]);
      const sebelum = simpan.ambil(kunciRiwayat(u), []);
      const sesudah = sebelum.filter((r) => r.id !== id);
      if (sesudah.length === sebelum.length) throw new Galat(404, "Riwayat tidak ditemukan.");
      simpan.taruh(kunciRiwayat(u), sesudah);
      return { status: "dihapus" };
    }
    if (method === "POST" && path === "/predict") return await onPredict(init);
    if (method === "POST" && path === "/feedback") return await onFeedback(init);
    throw new Galat(404, "Tidak ditemukan.");
  }

  const RUTE = /^\/(predict|feedback|api\/(daftar|masuk|keluar|saya|health|riwayat))(\/|$)/;

  window.fetch = function (input, init) {
    let url;
    try { url = new URL(typeof input === "string" ? input : input.url, location.href); } catch { return nativeFetch(input, init); }
    if (!RUTE.test(url.pathname)) return nativeFetch(input, init);
    const method = ((init && init.method) || (typeof input !== "string" && input.method) || "GET").toUpperCase();
    return tangani(method, url.pathname, init).then(
      (data) => json(data),
      (e) => (e instanceof Galat ? galat(e.status, e.message) : (console.error(e), galat(500, "Terjadi kesalahan di browser."))),
    );
  };
})();
