# KenaliRimpang (versi Netlify)

Website statis: klasifikasi rimpang berjalan di browser (TensorFlow.js).
Akun dan riwayat tersimpan di browser pengunjung (localStorage), per perangkat.
Laporan prediksi salah diteruskan ke Discord lewat Netlify Function (opsional).

Struktur:
- public/            -> isi website (index.html, script.js, local-api.js, model/, ...)
- netlify/functions/ -> feedback.mjs (kirim laporan ke Discord)
- netlify.toml       -> pengaturan Netlify
- KONVERSI_MODEL_COLAB.py -> skrip konversi model (jalankan di Google Colab, bukan di Netlify)
