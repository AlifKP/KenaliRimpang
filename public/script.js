/* KenaliRimpang - logika frontend (Vanilla JS + Fetch API) */
(() => {
  "use strict";

  // Jika index.html dibuka langsung (file://), arahkan ke server lokal.
  const API_BASE = location.protocol === "file:" ? "http://localhost:8000" : "";
  const MAX_MB = 15;
  const LOW_CONFIDENCE = 0.6;

  // Warna batang per jenis rimpang (mengikuti warna daging aslinya)
  const COLORS = {
    Jahe: "#d9bc7a",
    Kencur: "#b89a68",
    Kunyit: "#f0a317",
    Lengkuas: "#e3a98e",
    Temulawak: "#d9741f",
  };

  const $ = (id) => document.getElementById(id);
  // Memastikan dialog kamera ada di halaman. Jika markup di index.html hilang atau tidak lengkap,
  // dialog dibuat otomatis agar tombol kamera tetap berfungsi.
  function ensureCameraDialog() {
    const need = ["cameraDialog", "cameraVideo", "btnShot", "btnCloseCamera"];
    if (need.every((id) => document.getElementById(id))) return;

    const old = document.getElementById("cameraDialog");
    if (old) old.remove();

    if (!document.getElementById("cameraFallbackStyle")) {
      const st = document.createElement("style");
      st.id = "cameraFallbackStyle";
      st.textContent = `
        #cameraDialog{width:min(92vw,560px);padding:0;border:0;border-radius:20px}
        #cameraDialog::backdrop{background:rgba(15,23,42,.65)}
        #cameraDialog .inner{padding:16px}
        #cameraDialog .camera-title{margin:0 0 12px;font-size:1.1rem;font-weight:700}
        #cameraDialog video{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px;background:#000}
        #cameraDialog .camera-stage{position:relative}
        #cameraDialog .camera-status{position:absolute;inset:0;display:grid;place-items:center;padding:16px;text-align:center;color:#fff;background:rgba(15,23,42,.55);border-radius:12px}
        #cameraDialog .camera-status[hidden]{display:none}
        #cameraDialog .camera-actions{display:flex;gap:12px;margin-top:14px}
        #cameraDialog .camera-actions button{flex:1;padding:.8rem 1rem;border-radius:12px;font-weight:700;cursor:pointer;border:1.5px solid var(--line-2,#cbd5e1);background:var(--surface,#fff);color:var(--ink,#0f172a)}
        #cameraDialog .camera-actions button.btn-primary{background:#047857;border-color:#047857;color:#fff}
        #cameraDialog .camera-actions button:disabled{opacity:.5;cursor:not-allowed}`;
      document.head.appendChild(st);
    }

    const dlg = document.createElement("dialog");
    dlg.id = "cameraDialog";
    dlg.className = "camera-dialog";
    dlg.innerHTML = `
      <div class="inner">
        <h3 class="camera-title">Ambil foto rimpang</h3>
        <div class="camera-stage">
          <video id="cameraVideo" autoplay playsinline muted></video>
          <p id="cameraStatus" class="camera-status">Mengaktifkan kamera...</p>
        </div>
        <div class="camera-actions">
          <button id="btnShot" type="button" class="btn btn-primary" disabled>Ambil Foto</button>
          <button id="btnCloseCamera" type="button" class="btn btn-ghost">Batal</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
  }
  ensureCameraDialog();

  const el = {
    dropzone: $("dropzone"), fileInput: $("fileInput"), cameraFallback: $("cameraFallback"),
    btnCamera: $("btnCamera"), cameraDialog: $("cameraDialog"), cameraVideo: $("cameraVideo"),
    btnShot: $("btnShot"), btnCloseCamera: $("btnCloseCamera"), cameraStatus: $("cameraStatus"),
    previewBox: $("previewBox"), previewImg: $("previewImg"), fileName: $("fileName"), btnClear: $("btnClear"),
    errorMsg: $("errorMsg"), btnClassify: $("btnClassify"),
    emptyState: $("emptyState"), loadingState: $("loadingState"), resultState: $("resultState"),
    rejectState: $("rejectState"), rejectReason: $("rejectReason"), rejectGuess: $("rejectGuess"),
    resLabel: $("resLabel"), resLatin: $("resLatin"), resConf: $("resConf"),
    lowConfWarn: $("lowConfWarn"), modeBadge: $("modeBadge"),
    probList: $("probList"), resTime: $("resTime"),
    eduName: $("eduName"), eduCiri: $("eduCiri"), eduAroma: $("eduAroma"),
    eduManfaat: $("eduManfaat"), eduTips: $("eduTips"), eduDisclaimer: $("eduDisclaimer"),
    btnFeedback: $("btnFeedback"), feedbackForm: $("feedbackForm"), correctLabel: $("correctLabel"),
    feedbackNote: $("feedbackNote"), btnSendFeedback: $("btnSendFeedback"), feedbackMsg: $("feedbackMsg"),
  };

  const state = { file: null, previewUrl: null, result: null, stream: null };

  // ---------------------------------------------------------------- util
  const pct = (p) => (p * 100).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";

  function showError(msg) {
    el.errorMsg.textContent = msg;
    el.errorMsg.classList.toggle("hidden", !msg);
  }

  function showPanel(name) {
    el.emptyState.classList.toggle("hidden", name !== "empty");
    el.loadingState.classList.toggle("hidden", name !== "loading");
    el.resultState.classList.toggle("hidden", name !== "result");
    el.rejectState.classList.toggle("hidden", name !== "reject");
  }

  // ---------------------------------------------------------------- pemilihan gambar
  function setImage(file) {
    showError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) return showError("File harus berupa gambar (JPG, PNG, atau WEBP).");
    if (file.size > MAX_MB * 1024 * 1024) return showError(`Ukuran gambar maksimal ${MAX_MB} MB.`);

    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.file = file;
    state.previewUrl = URL.createObjectURL(file);
    el.previewImg.src = state.previewUrl;
    el.fileName.textContent = file.name || "foto-kamera.jpg";
    el.previewBox.classList.remove("hidden");
    el.btnClassify.disabled = false;

    // Hasil lama tidak lagi sesuai dengan foto baru
    state.result = null;
    showPanel("empty");
    resetFeedback();
  }

  function clearImage() {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    Object.assign(state, { file: null, previewUrl: null, result: null });
    el.previewImg.removeAttribute("src");
    el.previewBox.classList.add("hidden");
    el.btnClassify.disabled = true;
    el.fileInput.value = "";
    el.cameraFallback.value = "";
    showError("");
    showPanel("empty");
    resetFeedback();
  }

  el.fileInput.addEventListener("change", (e) => setImage(e.target.files[0]));
  el.cameraFallback.addEventListener("change", (e) => setImage(e.target.files[0]));
  el.btnClear.addEventListener("click", clearImage);

  // Drag and drop
  ["dragenter", "dragover"].forEach((evt) =>
    el.dropzone.addEventListener(evt, (e) => { e.preventDefault(); el.dropzone.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((evt) =>
    el.dropzone.addEventListener(evt, (e) => { e.preventDefault(); el.dropzone.classList.remove("dragover"); })
  );
  el.dropzone.addEventListener("drop", (e) => setImage(e.dataTransfer.files[0]));
  el.dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.fileInput.click(); }
  });

  // ---------------------------------------------------------------- kamera
  // Alur: klik tombol kamera -> modal terbuka -> izin kamera -> video tampil ->
  // "Ambil Foto" menangkap frame -> masuk ke preview upload yang sama dengan unggah file ->
  // siap dikirim ke /predict lewat tombol "Klasifikasikan".
  let cameraOpening = false;
  el.btnShot.textContent = "Ambil Foto";
  el.btnCloseCamera.textContent = "Batal";

  function setCameraStatus(text) {
    if (!el.cameraStatus) return;
    el.cameraStatus.textContent = text || "";
    el.cameraStatus.hidden = !text;
  }

  function cameraErrorMessage(err) {
    const tail = " Anda tetap bisa mengunggah foto dari galeri.";
    switch (err && err.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Izin kamera ditolak. Klik ikon kamera atau gembok di address bar, izinkan akses, lalu coba lagi." + tail;
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "Kamera tidak ditemukan pada perangkat ini." + tail;
      case "NotReadableError":
      case "TrackStartError":
        return "Kamera sedang dipakai aplikasi lain (misalnya Zoom atau Meet). Tutup aplikasi itu lalu coba lagi." + tail;
      default:
        return "Kamera tidak bisa dibuka (" + ((err && (err.message || err.name)) || "kesalahan tidak diketahui") + ")." + tail;
    }
  }

  // Tombol "Ambil Foto" baru aktif setelah video benar-benar punya gambar
  function onVideoReady() {
    if (!state.stream || !el.cameraVideo.videoWidth) return;
    setCameraStatus("");
    el.btnShot.disabled = false;
  }

  // Kamera yang sedang dipakai: "environment" = belakang, "user" = depan
  let facing = "environment";

  // Mencoba beberapa cara berurutan supaya kamera belakang benar-benar terpilih:
  // 1) wajib kamera yang diminta, 2) lebih disukai, 3) kamera apa saja (mis. laptop).
  async function getCameraStream(wanted) {
    const attempts = [
      { video: { facingMode: { exact: wanted } }, audio: false },
      { video: { facingMode: { ideal: wanted } }, audio: false },
      { video: true, audio: false },
    ];
    let lastErr;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
        // Izin ditolak atau kamera sedang dipakai: percuma mencoba cara lain
        const n = err && err.name;
        if (n === "NotAllowedError" || n === "SecurityError" || n === "NotReadableError") throw err;
      }
    }
    throw lastErr;
  }

  async function attachStream(stream) {
    state.stream = stream;
    stream.getVideoTracks().forEach((track) =>
      track.addEventListener("ended", () => {
        if (state.stream !== stream) return;
        closeCamera();
        showError("Koneksi kamera terputus. Coba buka kamera lagi.");
      })
    );
    el.cameraVideo.srcObject = stream;
    await el.cameraVideo.play().catch(() => {});
    onVideoReady();
  }

  // Tombol "Putar kamera": berpindah antara kamera belakang dan depan
  const btnFlip = document.createElement("button");
  btnFlip.id = "btnFlip";
  btnFlip.type = "button";
  btnFlip.className = "btn btn-ghost";
  btnFlip.textContent = "Putar kamera";
  el.btnCloseCamera.parentElement.insertBefore(btnFlip, el.btnCloseCamera);

  async function switchCamera() {
    if (cameraOpening || !el.cameraDialog.open) return;
    cameraOpening = true;
    btnFlip.disabled = true;
    stopCamera();
    setCameraStatus("Berpindah kamera...");
    facing = facing === "environment" ? "user" : "environment";
    try {
      const stream = await getCameraStream(facing);
      if (!el.cameraDialog.open) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      await attachStream(stream);
    } catch (err) {
      closeCamera();
      showError(cameraErrorMessage(err));
    } finally {
      cameraOpening = false;
      btnFlip.disabled = false;
    }
  }
  btnFlip.addEventListener("click", switchCamera);

  async function openCamera() {
    showError("");
    if (cameraOpening || el.cameraDialog.open) return;

    // Tanpa getUserMedia (mis. HTTP non-localhost di HP): pakai kamera bawaan lewat input file
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      el.cameraFallback.click();
      return;
    }

    cameraOpening = true;
    el.btnShot.disabled = true;
    setCameraStatus("Mengaktifkan kamera... Izinkan akses kamera jika diminta browser.");
    el.cameraDialog.showModal();

    try {
      facing = "environment"; // selalu mulai dari kamera belakang (di HP)
      const stream = await getCameraStream(facing);

      // Pengguna menekan Batal saat menunggu izin: lepaskan kamera langsung
      if (!el.cameraDialog.open) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      await attachStream(stream);
    } catch (err) {
      closeCamera();
      showError(cameraErrorMessage(err));
    } finally {
      cameraOpening = false;
    }
  }

  function stopCamera() {
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
    el.cameraVideo.srcObject = null;
    el.btnShot.disabled = true;
  }

  function closeCamera() {
    stopCamera();
    if (el.cameraDialog.open) el.cameraDialog.close();
  }

  function takePhoto() {
    const v = el.cameraVideo;
    if (!state.stream || !v.videoWidth) return;

    // Batasi sisi terpanjang 1920 px agar ukuran file wajar
    const scale = Math.min(1, 1920 / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);

    el.btnShot.disabled = true; // cegah klik ganda selama proses encode
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          el.btnShot.disabled = false;
          return showError("Gagal mengambil foto. Coba lagi.");
        }
        // Masuk ke alur yang sama dengan unggah file: preview, tombol Klasifikasikan aktif
        setImage(new File([blob], `kamera-${Date.now()}.jpg`, { type: "image/jpeg" }));
        closeCamera();
      },
      "image/jpeg",
      0.92
    );
  }

  el.btnCamera.addEventListener("click", openCamera);
  el.btnShot.addEventListener("click", takePhoto);
  el.btnCloseCamera.addEventListener("click", closeCamera);
  el.cameraDialog.addEventListener("close", stopCamera); // termasuk saat menekan Esc
  el.cameraDialog.addEventListener("click", (e) => { if (e.target === el.cameraDialog) closeCamera(); }); // klik area gelap
  el.cameraVideo.addEventListener("loadeddata", onVideoReady);
  el.cameraVideo.addEventListener("playing", onVideoReady);

  // ---------------------------------------------------------------- klasifikasi
  async function classify() {
    if (!state.file) return;
    showError("");
    el.btnClassify.disabled = true;
    el.btnClassify.textContent = "Menganalisis...";
    showPanel("loading");

    const body = new FormData();
    body.append("file", state.file);

    try {
      const res = await fetch(`${API_BASE}/predict`, { method: "POST", body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const galat = new Error(err.detail || `Server mengembalikan status ${res.status}.`);
        galat.status = res.status;
        throw galat;
      }
      const data = await res.json();
      if (data.ditolak) {
        // Penjaga hasil di server: model kurang yakin, jadi tidak ditampilkan sebagai jenis rimpang
        state.result = null;
        renderDitolak(data);
        showPanel("reject");
        document.dispatchEvent(new CustomEvent("kr:hasil", { detail: data }));
        el.rejectState.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      state.result = data;
      renderResult(state.result);
      showPanel("result");
      // Memberi tahu bagian akun/riwayat bahwa ada hasil baru (lihat bagian "Akun dan riwayat" di bawah)
      document.dispatchEvent(new CustomEvent("kr:hasil", { detail: state.result }));
      el.resultState.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      showPanel("empty");
      if (err.status === 401) document.dispatchEvent(new CustomEvent("kr:perlu-login")); // sesi habis / belum masuk
      showError(
        err instanceof TypeError
          ? "Tidak dapat terhubung ke server. Pastikan backend berjalan di http://localhost:8000."
          : err.message
      );
    } finally {
      el.btnClassify.disabled = false;
      el.btnClassify.textContent = "Klasifikasikan";
    }
  }
  el.btnClassify.addEventListener("click", classify);

  // ---------------------------------------------------------------- render hasil
  // Tampilan "Foto belum dikenali dengan yakin" (r berisi alasan, tebakan, kedua, ambang dari server)
  function renderDitolak(r) {
    const persen = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const p = (x) => `${persen.format(x * 100)}%`;
    el.rejectReason.textContent =
      r.alasan === "ragu"
        ? `Model ragu antara ${r.tebakan.label} (${p(r.tebakan.probability)}) dan ${r.kedua.label} (${p(r.kedua.probability)}).`
        : `Keyakinan model hanya ${p(r.tebakan.probability)}, di bawah batas ${p(r.ambang.keyakinan)}.`;
    el.rejectGuess.textContent = `Tebakan terdekat: ${r.tebakan.label} (${p(r.tebakan.probability)}). Belum cukup yakin untuk dijadikan hasil.`;
  }

  function renderResult(r) {
    el.resLabel.textContent = r.label;
    el.resLabel.style.color = ""; // teks tetap gelap agar kontras terjaga
    el.resLatin.textContent = r.info?.nama_latin || "";
    el.resConf.textContent = pct(r.confidence);

    el.lowConfWarn.classList.toggle("hidden", r.confidence >= LOW_CONFIDENCE);
    el.lowConfWarn.textContent =
      "Keyakinan model rendah. Coba foto lebih dekat, cahaya lebih terang, atau tampilkan bagian yang dipotong.";

    const dummy = r.mode === "dummy";
    el.modeBadge.classList.toggle("hidden", !dummy);
    if (dummy) {
      el.modeBadge.textContent =
        "Mode demo: server belum memuat model terlatih, jadi hasil ini hanya perkiraan dari warna gambar.";
    }

    // Batang probabilitas
    el.probList.innerHTML = "";
    r.probabilities.forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "prob-row" + (i === 0 ? " top" : "");

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = p.label;

      const track = document.createElement("div");
      track.className = "prob-track";
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute("aria-valuenow", String(Math.round(p.probability * 100)));
      track.setAttribute("aria-label", `Peluang ${p.label}`);
      const fill = document.createElement("div");
      fill.className = "prob-fill";
      fill.style.background = COLORS[p.label] || "#2f5d46";
      track.appendChild(fill);

      const val = document.createElement("span");
      val.className = "pct";
      val.textContent = pct(p.probability);

      li.append(name, track, val);
      el.probList.appendChild(li);

      requestAnimationFrame(() =>
        requestAnimationFrame(() => { fill.style.width = Math.max(p.probability * 100, 1) + "%"; })
      );
    });
    el.resTime.textContent = `Waktu inferensi ${r.inference_ms} ms`;

    // Kartu edukasi
    const info = r.info || {};
    el.eduName.textContent = r.label;
    el.eduCiri.textContent = info.ciri_fisik || "-";
    el.eduAroma.textContent = info.aroma || "-";
    el.eduTips.textContent = info.tips_membedakan || "-";
    el.eduDisclaimer.textContent = info.disclaimer || "";
    el.eduManfaat.innerHTML = "";
    (info.manfaat || []).forEach((m) => {
      const li = document.createElement("li");
      li.textContent = m;
      el.eduManfaat.appendChild(li);
    });

    // Preset pilihan feedback ke label selain hasil prediksi
    resetFeedback();
    const alt = r.probabilities.find((p) => p.label !== r.label);
    if (alt) el.correctLabel.value = alt.label;
  }

  // ---------------------------------------------------------------- feedback / error case
  function resetFeedback() {
    el.feedbackForm.classList.add("hidden");
    el.btnFeedback.setAttribute("aria-expanded", "false");
    el.feedbackNote.value = "";
    el.feedbackMsg.classList.add("hidden");
    el.btnSendFeedback.disabled = false;
  }

  el.btnFeedback.addEventListener("click", () => {
    const open = el.feedbackForm.classList.toggle("hidden") === false;
    el.btnFeedback.setAttribute("aria-expanded", String(open));
  });

  el.btnSendFeedback.addEventListener("click", async () => {
    if (!state.result || !state.file) return;
    el.btnSendFeedback.disabled = true;

    const body = new FormData();
    body.append("predicted_label", state.result.label);
    body.append("correct_label", el.correctLabel.value);
    body.append("confidence", String(state.result.confidence));
    body.append("note", el.feedbackNote.value);
    body.append("file", state.file);

    try {
      const res = await fetch(`${API_BASE}/feedback`, { method: "POST", body });
      if (!res.ok) throw new Error();
      el.feedbackMsg.textContent = `Laporan tersimpan: prediksi "${state.result.label}", seharusnya "${el.correctLabel.value}". Terima kasih.`;
      el.feedbackMsg.style.color = "";
      el.feedbackForm.classList.add("hidden");
      el.btnFeedback.setAttribute("aria-expanded", "false");
    } catch {
      el.feedbackMsg.textContent = "Laporan gagal dikirim. Periksa koneksi ke server lalu coba lagi.";
      el.feedbackMsg.style.color = "var(--err)";
      el.btnSendFeedback.disabled = false;
    }
    el.feedbackMsg.classList.remove("hidden");
  });

  window.addEventListener("beforeunload", stopCamera);
})();

/* Tombol ganti mode terang/gelap. Pilihan disimpan di browser (localStorage). */
(() => {
  "use strict";
  const btn = document.getElementById("themeToggle");
  if (!btn) return;
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="theme-color"]');

  function terapkan(tema) {
    root.setAttribute("data-theme", tema);
    btn.setAttribute("aria-pressed", String(tema === "dark"));
    btn.setAttribute("aria-label", tema === "dark" ? "Beralih ke mode terang" : "Beralih ke mode gelap");
    if (meta) meta.setAttribute("content", tema === "dark" ? "#0b1220" : "#f8fafc");
  }

  terapkan(root.getAttribute("data-theme") === "dark" ? "dark" : "light");

  btn.addEventListener("click", () => {
    const berikut = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    terapkan(berikut);
    try { localStorage.setItem("tema", berikut); } catch (e) { /* abaikan */ }
  });
})();

/* ============================ Akun dan riwayat ============================
   Masuk/daftar dan riwayat hasil pengecekan. Datanya disimpan di server (lihat riwayat.py dan app.py). */
(() => {
  "use strict";
  const API = location.protocol === "file:" ? "http://localhost:8000" : "";
  const $ = (id) => document.getElementById(id);
  const ui = {
    btnMasuk: $("btnMasuk"), btnRiwayat: $("btnRiwayat"), btnKeluar: $("btnKeluar"), akunInfo: $("akunInfo"),
    authDialog: $("authDialog"), authTitle: $("authTitle"), authForm: $("authForm"), authHint: $("authHint"),
    tabMasuk: $("tabMasuk"), tabDaftar: $("tabDaftar"),
    authUser: $("authUser"), authPass: $("authPass"), authPass2: $("authPass2"), authPass2Wrap: $("authPass2Wrap"),
    authError: $("authError"), btnAuthSubmit: $("btnAuthSubmit"), btnAuthCancel: $("btnAuthCancel"),
    historyDialog: $("historyDialog"), historyList: $("historyList"), historyEmpty: $("historyEmpty"),
    historyInfo: $("historyInfo"), historyError: $("historyError"),
    btnCloseHistory: $("btnCloseHistory"), btnClearHistory: $("btnClearHistory"), btnDownloadHistory: $("btnDownloadHistory"),
    historyHint: $("historyHint"), historyHintText: $("historyHintText"), btnHintAction: $("btnHintAction"), authBrand: $("authBrand"),
    rejectNote: $("rejectNote"), rejectHistoryText: $("rejectHistoryText"), btnRejectHistory: $("btnRejectHistory"),
  };
  if (!ui.authDialog || !ui.historyDialog) return;

  let pengguna = null;      // nama pengguna yang sedang masuk, atau null jika tamu
  let wajibLogin = false;   // true = halaman login tampil lebih dulu (diatur di app.py: WAJIB_LOGIN)
  let mode = "masuk";       // "masuk" atau "daftar"
  let sibuk = false;
  let riwayatTerakhir = []; // salinan riwayat yang sedang tampil (dipakai untuk fitur unduh)
  let aksiHint = null;      // "masuk" atau "riwayat" (untuk tombol kecil di bawah hasil)

  const persen = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtPersen = (p) => `${persen.format(p * 100)}%`;
  const fmtWaktu = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  };

  // Panggilan ke server. Cookie sesi ikut terkirim otomatis (same-origin).
  async function api(path, opsi = {}) {
    const res = await fetch(`${API}${path}`, { credentials: "same-origin", ...opsi });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const d = data.detail;
      const err = new Error(
        typeof d === "string" ? d : res.status === 422 ? "Data yang dikirim tidak valid." : `Server mengembalikan status ${res.status}.`
      );
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const pesanGalat = (err) => (err instanceof TypeError ? "Tidak dapat terhubung ke server." : err.message);

  // ---------------------------------------------------------------- bilah atas
  function perbaruiTopbar() {
    const masuk = pengguna !== null;
    ui.btnMasuk.classList.toggle("hidden", masuk);
    ui.btnRiwayat.classList.toggle("hidden", !masuk);
    ui.btnKeluar.classList.toggle("hidden", !masuk);
    ui.akunInfo.classList.toggle("hidden", !masuk);
    ui.akunInfo.textContent = masuk ? pengguna : "";
    ui.akunInfo.title = masuk ? `Masuk sebagai ${pengguna}` : "";
  }

  async function muatPengguna() {
    try {
      const d = await api("/api/saya");
      pengguna = d.login ? d.username : null;
      wajibLogin = Boolean(d.wajib_login);
    } catch (e) {
      pengguna = null;
      wajibLogin = false; // server tidak terjangkau: jangan mengunci halaman
    }
    perbaruiTopbar();
    terapkanGerbang();
  }

  // Jika login wajib dan belum masuk: tutupi seluruh halaman dengan layar login. Jika sudah masuk: tampilkan aplikasi.
  function terapkanGerbang(pesan = "") {
    const gerbang = wajibLogin && pengguna === null;
    document.body.classList.toggle("belum-login", gerbang);
    ui.authDialog.classList.toggle("auth-gate", gerbang);
    ui.authBrand.classList.toggle("hidden", !gerbang);
    ui.btnAuthCancel.classList.toggle("hidden", gerbang);
    if (gerbang) bukaAuth("masuk", pesan);
  }

  // ---------------------------------------------------------------- masuk / daftar
  function galatAuth(teks) {
    ui.authError.textContent = teks;
    ui.authError.classList.toggle("hidden", !teks);
  }

  function aturMode(m) {
    mode = m;
    const daftar = m === "daftar";
    ui.tabMasuk.classList.toggle("active", !daftar);
    ui.tabDaftar.classList.toggle("active", daftar);
    ui.tabMasuk.setAttribute("aria-selected", String(!daftar));
    ui.tabDaftar.setAttribute("aria-selected", String(daftar));
    ui.authTitle.textContent = daftar ? "Buat akun baru" : "Masuk ke akun";
    ui.btnAuthSubmit.textContent = daftar ? "Daftar" : "Masuk";
    ui.authPass2Wrap.classList.toggle("hidden", !daftar);
    ui.authPass.autocomplete = daftar ? "new-password" : "current-password";
    const gerbang = ui.authDialog.classList.contains("auth-gate");
    ui.authHint.textContent = daftar
      ? "Nama pengguna 3-30 karakter (huruf, angka, titik, garis bawah, strip). Kata sandi minimal 6 karakter."
      : gerbang
        ? "Masuk untuk mulai menggunakan KenaliRimpang."
        : "Masuk untuk menyimpan riwayat hasil pengecekan Anda.";
    galatAuth("");
  }

  function bukaAuth(m, pesan = "") {
    aturMode(m);
    ui.authPass.value = "";
    ui.authPass2.value = "";
    if (pesan) galatAuth(pesan);
    if (!ui.authDialog.open) ui.authDialog.showModal();
    ui.authUser.focus();
  }

  async function kirimAuth(e) {
    e.preventDefault();
    if (sibuk) return;
    const username = ui.authUser.value.trim();
    const password = ui.authPass.value;
    if (!username || !password) return galatAuth("Isi nama pengguna dan kata sandi.");
    if (mode === "daftar" && password !== ui.authPass2.value) return galatAuth("Kata sandi dan ulangannya tidak sama.");

    sibuk = true;
    ui.btnAuthSubmit.disabled = true;
    ui.btnAuthSubmit.textContent = "Memproses...";
    galatAuth("");
    try {
      const body = new FormData();
      body.append("username", username);
      body.append("password", password);
      const data = await api(mode === "daftar" ? "/api/daftar" : "/api/masuk", { method: "POST", body });
      pengguna = data.username;
      perbaruiTopbar();
      ui.authPass.value = "";
      ui.authPass2.value = "";
      ui.authDialog.close();
      terapkanGerbang(); // membuka aplikasi bila tadinya tertutup layar login
    } catch (err) {
      galatAuth(pesanGalat(err));
    } finally {
      sibuk = false;
      ui.btnAuthSubmit.disabled = false;
      ui.btnAuthSubmit.textContent = mode === "daftar" ? "Daftar" : "Masuk";
    }
  }

  async function keluar() {
    try {
      await api("/api/keluar", { method: "POST" });
    } catch (e) {
      /* tetap dianggap keluar di tampilan */
    }
    if (wajibLogin) {
      location.reload(); // muat ulang agar hasil pengguna sebelumnya hilang dan layar login tampil
      return;
    }
    pengguna = null;
    perbaruiTopbar();
    ui.historyHint.classList.add("hidden");
    if (ui.historyDialog.open) ui.historyDialog.close();
  }

  // ---------------------------------------------------------------- riwayat
  function buatItem(item) {
    const art = document.createElement("article");
    art.className = "history-item";

    const img = document.createElement("img");
    img.className = "history-thumb";
    img.loading = "lazy";
    img.alt = `Foto hasil ${item.label}`;
    if (item.foto) img.src = item.foto;
    else if (item.ada_foto) img.src = `${API}/api/riwayat/${item.id}/foto`;

    const isi = document.createElement("div");
    const baris1 = document.createElement("p");
    baris1.className = "history-label";
    const tolak = Boolean(item.ditolak);
    if (tolak) art.classList.add("tolak");
    baris1.textContent = tolak ? "Tidak dikenali" : item.label;
    if (tolak) {
      const lencana = document.createElement("span");
      lencana.className = "history-badge";
      lencana.textContent = "kurang yakin";
      baris1.append(lencana);
    } else {
      const conf = document.createElement("span");
      conf.className = "history-conf";
      conf.textContent = fmtPersen(item.confidence);
      baris1.append(conf);
    }
    const waktu = document.createElement("p");
    waktu.className = "history-time";
    waktu.textContent = fmtWaktu(item.time);
    isi.append(baris1, waktu);
    const daftarPeluang = item.probabilities || [];
    const detailTeks = tolak
      ? daftarPeluang[0] ? `Tebakan terdekat: ${daftarPeluang[0].label} ${fmtPersen(daftarPeluang[0].probability)}` : ""
      : daftarPeluang.slice(1, 3).map((p) => `${p.label} ${fmtPersen(p.probability)}`).join(", ");
    if (detailTeks) {
      const detail = document.createElement("p");
      detail.className = "history-detail";
      detail.textContent = tolak ? detailTeks : `Peluang lain: ${detailTeks}`;
      isi.append(detail);
    }

    const hapus = document.createElement("button");
    hapus.type = "button";
    hapus.className = "btn btn-ghost history-del";
    hapus.textContent = "Hapus";
    hapus.addEventListener("click", () => hapusItem(item.id));

    art.append(img, isi, hapus);
    return art;
  }

  function sesiBerakhir() {
    pengguna = null;
    perbaruiTopbar();
    if (ui.historyDialog.open) ui.historyDialog.close();
    const pesan = "Sesi Anda berakhir. Silakan masuk lagi.";
    if (wajibLogin) terapkanGerbang(pesan);
    else bukaAuth("masuk", pesan);
  }

  async function muatRiwayat() {
    ui.historyError.classList.add("hidden");
    ui.historyEmpty.classList.add("hidden");
    ui.historyList.replaceChildren();
    ui.btnClearHistory.classList.add("hidden");
    ui.btnDownloadHistory.classList.add("hidden");
    ui.historyInfo.textContent = "Memuat riwayat...";
    try {
      const data = await api("/api/riwayat");
      ui.historyInfo.textContent = `${data.items.length} hasil tersimpan (maksimal ${data.maks} terakhir).`;
      ui.historyList.replaceChildren(...data.items.map(buatItem));
      ui.historyEmpty.classList.toggle("hidden", data.items.length > 0);
      ui.btnClearHistory.classList.toggle("hidden", data.items.length === 0);
      ui.btnDownloadHistory.classList.toggle("hidden", data.items.length === 0);
      riwayatTerakhir = data.items;
    } catch (err) {
      ui.historyInfo.textContent = "";
      if (err.status === 401) return sesiBerakhir();
      ui.historyError.textContent = pesanGalat(err);
      ui.historyError.classList.remove("hidden");
    }
  }

  function bukaRiwayat() {
    if (!ui.historyDialog.open) ui.historyDialog.showModal();
    muatRiwayat();
  }

  async function hapusItem(id) {
    try {
      await api(`/api/riwayat/${id}`, { method: "DELETE" });
    } catch (err) {
      if (err.status === 401) return sesiBerakhir();
      if (err.status !== 404) {
        ui.historyError.textContent = pesanGalat(err);
        ui.historyError.classList.remove("hidden");
        return;
      }
    }
    muatRiwayat();
  }

  // Mengunduh riwayat sebagai file CSV (dibuka di Excel). Dibuat langsung di browser dari data yang sudah dimuat.
  // Pemisah kolom titik koma dan angka berkoma desimal agar kolomnya rapi di Excel berbahasa Indonesia. Foto tidak ikut.
  function unduhRiwayat() {
    if (!riwayatTerakhir.length) return;
    const dua = (n) => String(n).padStart(2, "0");
    const waktuLokal = (iso) => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      return `${d.getFullYear()}-${dua(d.getMonth() + 1)}-${dua(d.getDate())} ${dua(d.getHours())}:${dua(d.getMinutes())}:${dua(d.getSeconds())}`;
    };
    const desimal = (p) => (p * 100).toFixed(1).replace(".", ",");

    const jenis = [];
    riwayatTerakhir.forEach((it) =>
      (it.probabilities || []).forEach((p) => {
        if (!jenis.includes(p.label)) jenis.push(p.label);
      })
    );
    jenis.sort();

    const kepala = ["No", "Waktu", "Hasil", "Keyakinan tertinggi (%)", "Status", "Tebakan model", ...jenis.map((j) => `Peluang ${j} (%)`)];
    const baris = riwayatTerakhir.map((it, i) => {
      const peluang = Object.fromEntries((it.probabilities || []).map((p) => [p.label, p.probability]));
      return [
        i + 1,
        waktuLokal(it.time),
        it.ditolak ? "Tidak dikenali" : it.label,
        desimal(it.confidence),
        it.ditolak ? "Kurang yakin (ditolak)" : "Dikenali",
        it.label,
        ...jenis.map((j) => (j in peluang ? desimal(peluang[j]) : "")),
      ];
    });
    const sel = (v) => {
      const t = String(v);
      return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = "\uFEFF" + [kepala, ...baris].map((r) => r.map(sel).join(";")).join("\r\n") + "\r\n";

    const sekarang = new Date();
    const tanggal = `${sekarang.getFullYear()}-${dua(sekarang.getMonth() + 1)}-${dua(sekarang.getDate())}`;
    const nama = (pengguna || "pengguna").replace(/[^A-Za-z0-9._-]/g, "");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `riwayat-kenalirimpang-${nama}-${tanggal}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function hapusSemua() {
    if (!window.confirm("Hapus semua riwayat? Tindakan ini tidak bisa dibatalkan.")) return;
    try {
      await api("/api/riwayat", { method: "DELETE" });
    } catch (err) {
      if (err.status === 401) return sesiBerakhir();
      ui.historyError.textContent = pesanGalat(err);
      ui.historyError.classList.remove("hidden");
      return;
    }
    muatRiwayat();
  }

  // ---------------------------------------------------------------- catatan di bawah hasil
  document.addEventListener("kr:hasil", (e) => {
    const r = e.detail || {};
    // r.login berasal dari server, jadi tampilan ikut disesuaikan (mis. sesi sudah berakhir atau login di tab lain)
    if (!r.login && pengguna !== null) {
      pengguna = null;
      perbaruiTopbar();
    } else if (r.login && pengguna === null) {
      muatPengguna();
    }
    if (r.ditolak) {
      // Foto "belum dikenali": catatan ditampilkan di kartu penolakan, bukan di kartu hasil
      ui.rejectNote.classList.remove("hidden");
      ui.btnRejectHistory.classList.remove("hidden");
      if (r.tersimpan) {
        ui.rejectHistoryText.textContent = "Hasil ini tetap dicatat di riwayat Anda.";
        ui.btnRejectHistory.textContent = "Lihat riwayat";
        aksiHint = "riwayat";
      } else if (!r.login) {
        ui.rejectHistoryText.textContent = "Masuk untuk mencatat hasil ke riwayat.";
        ui.btnRejectHistory.textContent = "Masuk";
        aksiHint = "masuk";
      } else {
        ui.rejectHistoryText.textContent = "Hasil ini tidak dapat dicatat ke riwayat.";
        ui.btnRejectHistory.classList.add("hidden");
        aksiHint = null;
      }
      return;
    }
    ui.rejectNote.classList.add("hidden");
    ui.historyHint.classList.remove("hidden");
    ui.btnHintAction.classList.remove("hidden");
    if (r.tersimpan) {
      ui.historyHintText.textContent = "Hasil ini tersimpan di riwayat Anda.";
      ui.btnHintAction.textContent = "Lihat riwayat";
      aksiHint = "riwayat";
    } else if (!r.login) {
      ui.historyHintText.textContent = "Masuk untuk menyimpan hasil ini ke riwayat.";
      ui.btnHintAction.textContent = "Masuk";
      aksiHint = "masuk";
    } else {
      ui.historyHintText.textContent = "Hasil ini tidak dapat disimpan ke riwayat.";
      ui.btnHintAction.classList.add("hidden");
      aksiHint = null;
    }
  });

  // ---------------------------------------------------------------- pemasangan tombol
  ui.btnMasuk.addEventListener("click", () => bukaAuth("masuk"));
  ui.btnKeluar.addEventListener("click", keluar);
  ui.btnRiwayat.addEventListener("click", bukaRiwayat);
  ui.tabMasuk.addEventListener("click", () => aturMode("masuk"));
  ui.tabDaftar.addEventListener("click", () => aturMode("daftar"));
  ui.authForm.addEventListener("submit", kirimAuth);
  ui.btnAuthCancel.addEventListener("click", () => ui.authDialog.close());
  ui.btnCloseHistory.addEventListener("click", () => ui.historyDialog.close());
  ui.btnClearHistory.addEventListener("click", hapusSemua);
  ui.btnDownloadHistory.addEventListener("click", unduhRiwayat);
  ui.btnHintAction.addEventListener("click", () => (aksiHint === "riwayat" ? bukaRiwayat() : bukaAuth("masuk")));
  ui.btnRejectHistory.addEventListener("click", () => (aksiHint === "riwayat" ? bukaRiwayat() : bukaAuth("masuk")));
  // Klik di luar kotak dialog (pada latar gelap) menutupnya, kecuali layar login yang wajib
  [ui.authDialog, ui.historyDialog].forEach((dlg) =>
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg && !dlg.classList.contains("auth-gate")) dlg.close();
    })
  );
  // Tombol Esc tidak boleh menutup layar login yang wajib
  ui.authDialog.addEventListener("cancel", (e) => {
    if (ui.authDialog.classList.contains("auth-gate")) e.preventDefault();
  });
  // Dikirim oleh bagian klasifikasi bila server menjawab 401 (belum masuk / sesi habis)
  document.addEventListener("kr:perlu-login", sesiBerakhir);

  aturMode("masuk");
  muatPengguna();
})();