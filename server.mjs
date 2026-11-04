// Fish Audio voice clone + voice-to-voice call tester. Zero deps, Node 22+.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

try { process.loadEnvFile('.env'); } catch {}
const { FISH_API_KEY, LLM_API_KEY, LLM_BASE_URL = 'https://api.openai.com/v1', LLM_MODEL = 'gpt-4o-mini',
  TTS_MODEL = 's2-pro', PORT = 8787, ANAM_API_KEY,
  ANAM_AVATAR_ID = '30fa96d0-26c4-4e55-94a0-517025942e18', // stock "Cara" from the Anam gallery
  ANAM_LLM_ID = 'a7cf662c-2ace-4de1-a21e-ef0fbf144bb7' } = process.env; // Anam's default LLM, turnkey mode only
const FISH = 'https://api.fish.audio';
const ANAM = 'https://api.anam.ai/v1';
const anamAuth = { Authorization: `Bearer ${ANAM_API_KEY}` };
const anamPost = async (path, obj) => (await ok(await fetch(`${ANAM}${path}`, {
  method: 'POST', headers: { ...anamAuth, 'content-type': 'application/json' }, body: JSON.stringify(obj),
}))).json();
const anamAll = async (path) => { // every page of GET /v1/<path>
  const get = async (p) => (await ok(await fetch(`${ANAM}${path}?perPage=100&page=${p}`, { headers: anamAuth }))).json();
  const first = await get(1);
  const rest = await Promise.all(Array.from({ length: first.meta.lastPage - 1 }, (_, i) => get(i + 2)));
  return [first, ...rest].flatMap((r) => r.data);
};
const byName = (a, b) => a.name.localeCompare(b.name);
const fishAuth = { Authorization: `Bearer ${FISH_API_KEY}` };

// browser webm/opus -> mono mp3 (piped wav would have a bogus length header)
const toMp3 = (buf) => new Promise((res, rej) => {
  const p = spawn('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '24000', '-b:a', '64k', '-f', 'mp3', 'pipe:1']);
  const out = []; p.stdout.on('data', (d) => out.push(d));
  p.on('close', (c) => c ? rej(new Error('ffmpeg failed')) : res(Buffer.concat(out)));
  p.stdin.end(buf);
});

const body = async (req) => { const c = []; for await (const d of req) c.push(d); return Buffer.concat(c); };
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const ok = async (r) => { if (!r.ok) throw new Error(`${r.url} ${r.status}: ${(await r.text()).slice(0, 300)}`); return r; };

async function asr(mp3) {
  const fd = new FormData();
  fd.append('audio', new Blob([mp3], { type: 'audio/mpeg' }), 'speech.mp3');
  fd.append('language', 'en');
  const r = await ok(await fetch(`${FISH}/v1/asr`, { method: 'POST', headers: { ...fishAuth, model: 'transcribe-1-pro' }, body: fd }));
  return (await r.json()).text.replace(/<\|[^|]*\|>/g, '').trim();
}

async function llm(system, history) {
  const r = await ok(await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${LLM_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: LLM_MODEL, max_tokens: 150, messages: [{ role: 'system', content: system }, ...history] }),
  }));
  return (await r.json()).choices[0].message.content.trim();
}

const pending = new Map(); // tts id -> {text, voice}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const q = Object.fromEntries(url.searchParams);
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(readFileSync('index.html')); }
  if (route === 'GET /api/status') return json(res, 200, { FISH_API_KEY: !!FISH_API_KEY, LLM_API_KEY: !!LLM_API_KEY, ANAM_API_KEY: !!ANAM_API_KEY, ANAM_AVATAR_ID, LLM_MODEL, TTS_MODEL });

  if (url.pathname.startsWith('/api/anam/') && !ANAM_API_KEY) return json(res, 500, { error: 'ANAM_API_KEY missing in .env' });
  if (route === 'POST /api/anam/session') { // ?avatar=  passthrough: our audio drives the face. +voice=&system= : Anam turnkey
    const personaConfig = { avatarId: q.avatar || ANAM_AVATAR_ID, avatarModel: 'cara-4' };
    if (q.voice) Object.assign(personaConfig, { voiceId: q.voice, llmId: ANAM_LLM_ID, systemPrompt: q.system, skipGreeting: true });
    else personaConfig.enableAudioPassthrough = true;
    return json(res, 200, { token: (await anamPost('/auth/session-token', { personaConfig })).sessionToken });
  }
  if (route === 'GET /api/anam/avatars') { // own avatars first, then stock
    const list = (await anamAll('/avatars')).map((a) => ({ id: a.id, name: [a.displayName, a.variantName].filter(Boolean).join(' · '), own: !!a.createdByOrganizationId, image: a.imageUrl }));
    return json(res, 200, list.sort((a, b) => b.own - a.own || byName(a, b)));
  }
  if (route === 'GET /api/anam/voices') { // group: 0 imported Fish, 1 other own, 2 stock Fish, 3 rest
    const list = (await anamAll('/voices')).map((v) => ({ id: v.id, name: v.displayName, provider: v.provider,
      group: (v.createdByOrganizationId ? 0 : 2) + (v.provider === 'FISH_AUDIO' ? 0 : 1) }));
    return json(res, 200, list.sort((a, b) => a.group - b.group || byName(a, b)));
  }
  if (route === 'POST /api/anam/import-voice') { // ?voice=<fish id>; Anam only imports public Fish voices
    const v = await anamPost('/voice-imports', { provider: 'FISH_AUDIO', providerVoiceId: q.voice });
    return json(res, 200, { id: v.id, name: v.displayName });
  }
  if (!FISH_API_KEY) return json(res, 500, { error: 'FISH_API_KEY missing in .env' });

  if (route === 'GET /api/voices') { // all own voices, by title
    const items = [];
    for (let p = 1; ; p++) {
      const d = await (await ok(await fetch(`${FISH}/model?self=true&page_size=100&page_number=${p}`, { headers: fishAuth }))).json();
      items.push(...d.items);
      if (!d.has_more || !d.items.length) break;
    }
    return json(res, 200, items.map((m) => ({ id: m._id, title: m.title, state: m.state })).sort((a, b) => a.title.localeCompare(b.title)));
  }

  if (route === 'POST /api/clone') { // body = raw audio, ?title=
    const fd = new FormData();
    fd.append('type', 'tts'); fd.append('title', q.title || 'clone'); fd.append('visibility', q.public ? 'public' : 'private'); fd.append('train_mode', 'fast');
    fd.append('voices', new Blob([await toMp3(await body(req))], { type: 'audio/mpeg' }), 'sample.mp3');
    const t = Date.now();
    const r = await ok(await fetch(`${FISH}/model`, { method: 'POST', headers: fishAuth, body: fd }));
    const m = await r.json();
    return json(res, 200, { id: m._id, title: m.title, state: m.state, ms: Date.now() - t });
  }

  if (route === 'POST /api/turn') { // body = raw audio, ?voice=&history=&system=  -> transcript + reply + tts url
    if (!LLM_API_KEY) return json(res, 500, { error: 'LLM_API_KEY missing in .env' });
    let t = Date.now();
    const user = await asr(await toMp3(await body(req)));
    const asr_ms = Date.now() - t; t = Date.now();
    const history = [...JSON.parse(q.history || '[]'), { role: 'user', content: user }];
    const reply = await llm(q.system || 'You are on a phone call. Reply in 1-2 short spoken sentences.', history);
    const llm_ms = Date.now() - t;
    const id = randomUUID(); pending.set(id, { text: reply, voice: q.voice });
    return json(res, 200, { user, reply, asr_ms, llm_ms, tts: `/api/tts/${id}` });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/tts')) { // streams Fish mp3 to <audio>, or ?pcm=1 raw s16le 24k mono for Anam
    const job = pending.get(url.pathname.split('/')[3]) || { text: q.text, voice: q.voice };
    const format = q.pcm ? { format: 'pcm', sample_rate: 24000 } : { format: 'mp3' };
    const r = await ok(await fetch(`${FISH}/v1/tts`, {
      method: 'POST', headers: { ...fishAuth, 'content-type': 'application/json', model: TTS_MODEL },
      body: JSON.stringify({ text: job.text, reference_id: job.voice || undefined, ...format, latency: 'balanced' }),
    }));
    res.writeHead(200, { 'content-type': q.pcm ? 'application/octet-stream' : 'audio/mpeg' });
    for await (const chunk of r.body) res.write(chunk);
    return res.end();
  }
  json(res, 404, { error: 'not found' });
}

http.createServer((req, res) => handle(req, res).catch((e) => { console.error(e.message); res.headersSent ? res.end() : json(res, 500, { error: e.message }); }))
  .listen(PORT, '127.0.0.1', () => console.log(`http://localhost:${PORT}`));
