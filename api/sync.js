// Simpan sebagai: api/sync.js (di repo GitHub Catatan Lirik)
// Sinkron album dan lagu: Vercel Function + Upstash Redis, tanpa paket tambahan.
const DB_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const DB_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const OK_KEY = /^[asr]:[A-Za-z0-9_-]{1,60}$/;

async function redis(cmd) {
  const r = await fetch(DB_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + DB_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

function toObj(a) {
  const o = {};
  if (Array.isArray(a)) for (let i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1];
  else Object.assign(o, a || {});
  return o;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const pass = process.env.JOURNAL_KEY;
  if (!pass || req.headers['x-key'] !== pass) return res.status(401).json({ error: 'kata sandi salah' });
  if (!DB_URL || !DB_TOKEN) return res.status(500).json({ error: 'database belum terhubung' });

  try {
    if (req.method === 'GET') {
      // versi terakhir (murah, dipakai untuk cek ada perubahan atau tidak)
      if (req.query.v) {
        const v = await redis(['HGET', 'lirik:m', 'v']);
        return res.status(200).json({ v: v || '0' });
      }
      // ambil isi beberapa album/lagu sekaligus
      if (req.query.k) {
        const keys = String(req.query.k).split(',').filter((k) => OK_KEY.test(k)).slice(0, 10);
        const items = {};
        if (keys.length) {
          const vals = await redis(['HMGET', 'lirik:d', ...keys]);
          keys.forEach((k, i) => { if (vals[i]) items[k] = JSON.parse(vals[i]); });
        }
        return res.status(200).json({ items });
      }
      // daftar semua item beserta waktu ubah terakhir
      const idx = toObj(await redis(['HGETALL', 'lirik:i']));
      for (const k in idx) idx[k] = Number(idx[k]);
      return res.status(200).json({ idx });
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const items = body && body.items;
      if (!items || typeof items !== 'object') return res.status(400).json({ error: 'data tidak valid' });
      const keys = Object.keys(items)
        .filter((k) => OK_KEY.test(k) && items[k] && typeof items[k].u === 'number')
        .slice(0, 60);
      const written = [];
      if (keys.length) {
        const cur = await redis(['HMGET', 'lirik:i', ...keys]);
        const d = ['HSET', 'lirik:d'];
        const ix = ['HSET', 'lirik:i'];
        keys.forEach((k, i) => {
          // hanya terima kalau lebih baru dari yang tersimpan
          if (items[k].u > (Number(cur[i]) || 0)) {
            d.push(k, JSON.stringify(items[k]));
            ix.push(k, String(items[k].u));
            written.push(k);
          }
        });
        if (written.length) {
          await redis(d);
          await redis(ix);
          await redis(['HSET', 'lirik:m', 'v', String(Date.now())]);
        }
      }
      return res.status(200).json({ written });
    }

    return res.status(405).json({ error: 'metode tidak didukung' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
