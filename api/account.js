// บัญชีคลาวด์ — ล็อกอินด้วยอีเมล + PIN แล้วซิงก์เซฟข้ามเครื่อง
// Vercel Serverless Function + Upstash Redis (REST)
const crypto = require('crypto');

const hashPin = (email, pin) =>
  crypto.createHash('sha256').update(`cr-salt|${email}|${pin}`).digest('hex');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'method' });

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return res.status(200).json({ ok: false, reason: 'no-store' });

  const redis = async (cmd) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    return r.json();
  };

  try {
    let { action, email, pin, data } = req.body || {};
    email = String(email || '').trim().toLowerCase().slice(0, 80);
    pin = String(pin || '').trim().slice(0, 12);
    if (!/^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/.test(email))
      return res.status(200).json({ ok: false, reason: 'bad-email' });
    if (pin.length < 4)
      return res.status(200).json({ ok: false, reason: 'bad-pin' });

    const KEY = 'cr_acc:' + email;
    const existing = (await redis(['GET', KEY])).result;
    const acc = existing ? JSON.parse(existing) : null;

    if (action === 'login') {
      if (!acc) {
        // ยังไม่มีบัญชี → สมัครใหม่อัตโนมัติ
        const fresh = { h: hashPin(email, pin), data: null, t: Date.now() };
        await redis(['SET', KEY, JSON.stringify(fresh)]);
        return res.status(200).json({ ok: true, created: true, data: null });
      }
      if (acc.h !== hashPin(email, pin))
        return res.status(200).json({ ok: false, reason: 'wrong-pin' });
      return res.status(200).json({ ok: true, created: false, data: acc.data || null });
    }

    if (action === 'save') {
      if (!acc || acc.h !== hashPin(email, pin))
        return res.status(200).json({ ok: false, reason: 'wrong-pin' });
      const payload = JSON.stringify(data || {});
      if (payload.length > 200000)
        return res.status(200).json({ ok: false, reason: 'too-big' });
      acc.data = data || {};
      acc.t = Date.now();
      await redis(['SET', KEY, JSON.stringify(acc)]);
      return res.status(200).json({ ok: true, t: acc.t });
    }

    if (action === 'load') {
      if (!acc || acc.h !== hashPin(email, pin))
        return res.status(200).json({ ok: false, reason: 'wrong-pin' });
      return res.status(200).json({ ok: true, data: acc.data || null, t: acc.t || 0 });
    }

    return res.status(200).json({ ok: false, reason: 'bad-action' });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'error' });
  }
};
