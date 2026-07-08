// อันดับออนไลน์ — Vercel Serverless Function + Upstash Redis (REST)
// เชื่อมผ่าน Vercel Marketplace: Storage → Upstash Redis (ตั้ง env อัตโนมัติ)
const KEY = 'cr_leaderboard';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return res.status(200).json({ ok: false, reason: 'no-store' });
  }

  const redis = async (cmd) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    return r.json();
  };

  try {
    if (req.method === 'POST') {
      let { n, s, c } = req.body || {};
      n = String(n || 'Cookie').replace(/[|<>]/g, '').trim().slice(0, 12) || 'Cookie';
      s = Math.max(0, Math.min(5000000, Math.floor(+s || 0)));
      c = Math.max(0, Math.min(3, Math.floor(+c || 0)));
      if (s < 50) return res.status(200).json({ ok: true });   // กันสแปมแต้มศูนย์
      const member = `${n}|${c}|${Date.now()}`;
      await redis(['ZADD', KEY, String(s), member]);
      await redis(['ZREMRANGEBYRANK', KEY, '0', '-101']);      // เก็บ Top 100
      return res.status(200).json({ ok: true });
    }

    // GET: Top 20
    const out = await redis(['ZRANGE', KEY, '0', '19', 'REV', 'WITHSCORES']);
    const arr = out.result || [];
    const top = [];
    for (let i = 0; i < arr.length; i += 2) {
      const [n, c, t] = String(arr[i]).split('|');
      top.push({ n, c: +c || 0, t: +t || 0, s: +arr[i + 1] || 0 });
    }
    return res.status(200).json({ ok: true, top });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'error' });
  }
};
