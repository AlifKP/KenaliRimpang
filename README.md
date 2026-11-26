# KenaliRimpang (versi Netlify)

Website statis: klasifikasi rimpang berjalan di browser (TensorFlow.js).
Akun dan riwayat tersimpan di browser pengunjung (localStorage), per perangkat.
Laporan prediksi salah diteruskan ke Discord lewat Netlify Function (opsional).

Struktur:
- public/            -> isi website (index.html, script.js, local-api.js, model/, ...)
- netlify/functions/ -> feedback.mjs (kirim laporan ke Discord)
- netlify.toml       -> pengaturan Netlify
- KONVERSI_MODEL_COLAB.py -> skrip konversi model (jalankan di Google Colab, bukan di Netlify)
- tools/perbaiki_model_keras3.py -> memperbaiki model TF.js hasil konversi Keras 3 supaya bisa dibaca TensorFlow.js
  Pakai: python3 tools/perbaiki_model_keras3.py <folder_model_asli> <folder_hasil>, lalu salin isi <folder_hasil> ke public/model/
  (dan config.json), lalu naikkan modelVersi di public/local-api.js.
