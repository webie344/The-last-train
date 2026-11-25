// Vercel serverless function: strategic AI Director for The Last Train.
// Set GROQ_API_KEY (and optionally GROQ_MODEL) in the project's environment variables. The key never reaches the browser.
const ACTIONS = ['none', 'hunt', 'investigate', 'stalk', 'ambush', 'retreat', 'hide', 'pressure'];
const SYSTEM = `You are the AI Director of a survival horror game set in an abandoned subway station. A single creature (the Stalker) hunts the player.
You only choose a STRATEGIC action; movement, attacks and navigation are handled by the game. Be fair: horror comes from tension and release, not constant attacks.
Allowed actions: none, hunt (go to the player), investigate (check where the player was heard), stalk (follow from a distance, creating dread), ambush (hide ahead of the player), retreat (back off, give the player room), hide, pressure (appear at distance and unsettle).
Rules: never choose an action whose cost exceeds threatBudget. Costs: hunt 40, ambush 30, investigate 10, stalk 5, pressure 8, others 0. If mercy>0 or playerHp<35 choose none or retreat. If the player is inTrain choose none/stalk/retreat. Prefer variety; avoid repeating lastAction twice in a row.
Reply ONLY with JSON: {"action":"<one of the allowed>","reason":"<8 words max>"}`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const key = process.env.GROQ_API_KEY;
  if (!key) { res.status(503).json({ error: 'director not configured' }); return; }
  let state = req.body; if (typeof state === 'string') { try { state = JSON.parse(state); } catch { state = null; } }
  if (!state || typeof state !== 'object') { res.status(400).json({ error: 'bad state' }); return; }
  const compact = JSON.stringify(state).slice(0, 1500);
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 2500);
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant', temperature: 0.6, max_tokens: 80, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: compact }] }),
    });
    if (!r.ok) { res.status(502).json({ error: 'upstream ' + r.status }); return; }
    const j = await r.json(); let out = {}; try { out = JSON.parse(j.choices?.[0]?.message?.content || '{}'); } catch { /* ignore */ }
    const action = ACTIONS.includes(out.action) ? out.action : 'none';
    res.status(200).json({ action, reason: String(out.reason || '').slice(0, 80) });
  } catch (e) { res.status(504).json({ error: 'timeout' }); } finally { clearTimeout(to); }
}
