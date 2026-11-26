// Netlify Function: meneruskan laporan "prediksi salah" ke channel Discord.
// Alamat webhook disimpan sebagai variabel lingkungan DISCORD_WEBHOOK_URL (Netlify > Site configuration >
// Environment variables), jadi TIDAK ikut terlihat di kode atau browser pengunjung.
const BALAS = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return BALAS({ detail: "Metode tidak diizinkan." }, 405);

  const webhook = (Netlify.env.get("DISCORD_WEBHOOK_URL") || "").trim();
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(webhook)) {
    return BALAS({ detail: "Discord belum diatur." }, 503);
  }

  let form;
  try { form = await req.formData(); } catch { return BALAS({ detail: "Data tidak valid." }, 400); }

  const bersih = (v, n) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, n);
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const tebakan = bersih(form.get("predicted_label"), 50);
  const benar = bersih(form.get("correct_label"), 50);
  const yakin = Number(form.get("confidence")) || 0;
  const catatan = bersih(form.get("note"), 500);

  const teks =
    `**Laporan prediksi salah** \`${id}\`\n` +
    `Tebakan model: **${tebakan}** (${(yakin * 100).toFixed(1)}%)\n` +
    `Seharusnya: **${benar}**\n` +
    `Catatan: ${catatan || "-"}`;

  const kirim = new FormData();
  kirim.append("payload_json", JSON.stringify({ content: teks, allowed_mentions: { parse: [] } }));
  const file = form.get("file");
  if (file && typeof file === "object" && file.size > 0 && file.size < 7 * 1024 * 1024) {
    kirim.append("files[0]", file, `${id}.jpg`);
  }

  try {
    const r = await fetch(webhook, { method: "POST", body: kirim });
    if (!r.ok) return BALAS({ detail: "Discord menolak laporan." }, 502);
  } catch {
    return BALAS({ detail: "Gagal menghubungi Discord." }, 502);
  }
  return BALAS({ status: "saved", id });
};
