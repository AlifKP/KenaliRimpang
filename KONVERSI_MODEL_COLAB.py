# =====================================================================
# Konversi model Keras (.keras) -> TensorFlow.js, dijalankan di Google Colab (gratis)
#
# CARA PAKAI
#  1. Buka https://colab.research.google.com  ->  New notebook
#  2. CELL 1: tempel BAGIAN 1 di bawah, jalankan. Setelah selesai,
#     klik menu  Runtime -> Restart session  (WAJIB).
#  3. CELL 2: tempel BAGIAN 2, jalankan. Pilih file  kenalirimpang.keras  saat diminta.
#  4. File  model_tfjs.zip  terunduh otomatis. Ekstrak, lalu isinya (model.json,
#     config.json, *.bin) ditaruh di folder  public/model/  pada proyek web.
# =====================================================================

# ------------------------------- BAGIAN 1 (cell 1) -------------------
# !pip install -q tensorflow==2.20.0 keras==3.13.2
# !pip install -q tensorflowjs --no-deps
# !pip install -q tf-keras tensorflow-hub packaging six

# ------------------------------- BAGIAN 2 (cell 2) -------------------
import json, os, shutil, subprocess, sys, zipfile
from google.colab import files

print("Pilih file kenalirimpang.keras ...")
up = files.upload()
nama = next(iter(up))

import keras
print("Keras", keras.__version__)
model = keras.models.load_model(nama, compile=False)
print("input:", model.input_shape, "| output:", model.output_shape)

# Samakan dengan logika app.py: jika model sudah menormalisasi sendiri, jangan normalisasi lagi
teks = json.dumps(model.get_config(), default=str)
sudah = any(f'"{n}"' in teks for n in ("TrueDivide", "Rescaling", "Normalization"))
preprocess = "none" if sudah else "mobilenet"   # ganti "rescale" jika modelmu dilatih dengan x/255
print("preprocess:", preprocess, "(model menormalisasi sendiri)" if sudah else "")

img = int(model.input_shape[1])
OUT = "tfjs_out"
shutil.rmtree(OUT, ignore_errors=True)
fmt = None

# Cara A (disarankan): SavedModel -> TF.js graph model
try:
    shutil.rmtree("saved_model_dir", ignore_errors=True)
    model.export("saved_model_dir")
    subprocess.run([
        sys.executable, "-m", "tensorflowjs.converters.converter",
        "--input_format=tf_saved_model", "--output_format=tfjs_graph_model",
        "--signature_name=serving_default", "--saved_model_tags=serve",
        "saved_model_dir", OUT,
    ], check=True)
    fmt = "graph"
except Exception as e:
    print("Cara A gagal:", e)

# Cara B (cadangan): langsung dari file .keras -> TF.js layers model
if fmt is None:
    shutil.rmtree(OUT, ignore_errors=True)
    subprocess.run([
        sys.executable, "-m", "tensorflowjs.converters.converter",
        "--input_format=keras_keras", "--output_format=tfjs_layers_model", nama, OUT,
    ], check=True)
    fmt = "layers"

json.dump({
    "format": fmt, "img_size": img, "preprocess": preprocess,
    "classes": ["Jahe", "Kencur", "Kunyit", "Lengkuas", "Temulawak"],
}, open(f"{OUT}/config.json", "w"), indent=2)

with zipfile.ZipFile("model_tfjs.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for f in os.listdir(OUT):
        z.write(os.path.join(OUT, f), f)
print("Selesai. Format:", fmt, "| file:", sorted(os.listdir(OUT)))
files.download("model_tfjs.zip")
