/**
 * Hermes Home — developer dashboard (minimal, dependency-free).
 *
 * A single debug surface (spec §46): polls the MCP server's /health,
 * /ready and /tools endpoints and renders a status page. This is a
 * developer/debug surface, not the consumer experience.
 *
 * Run: MCP_URL=http://127.0.0.1:3000 node src/server.js  →  :3100
 */
import http from 'node:http';
import { say, poll } from './sim/agent.js';
import { simPage } from './sim/page.js';

const MCP_URL = (process.env.MCP_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const PORT = Number(process.env.DASHBOARD_PORT ?? 3100);

async function getJson(path) {
  try {
    const res = await fetch(`${MCP_URL}${path}`, { signal: AbortSignal.timeout(3000) });
    return { ok: res.ok, status: res.status, body: await res.json() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

const dot = (ok) => `<span class="dot ${ok ? 'on' : 'off'}"></span>`;
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => `&#${c.codePointAt(0)};`);

const server = http.createServer(async (req, res) => {
  if (req.url === '/sim') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(simPage);
  }
  if (req.url.startsWith('/sim/poll')) {
    const sid = new URL(req.url, 'http://x').searchParams.get('sid') ?? 'default';
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(poll(sid)));
  }
  if (req.url === '/sim/say' && req.method === 'POST') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {}
    const out = await say(String(body.sessionId ?? 'default'), String(body.text ?? ''));
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(out));
  }
  const [health, ready, tools] = await Promise.all([
    getJson('/health'),
    getJson('/ready'),
    getJson('/tools'),
  ]);

  const hermes = ready.body?.hermes ?? {};
  const ha = ready.body?.homeAssistant ?? {};

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Hermes Home — Dashboard</title>
<meta http-equiv="refresh" content="5">
<style>
body{font-family:ui-monospace,Consolas,monospace;background:#0e1116;color:#e6edf3;margin:2rem;max-width:720px}
h1{font-size:1.4rem;letter-spacing:.1em}
h2{font-size:.9rem;color:#8b949e;margin-top:2rem;text-transform:uppercase;letter-spacing:.15em}
.dot{display:inline-block;width:.7em;height:.7em;border-radius:50%;margin-right:.5em}
.dot.on{background:#3fb950;box-shadow:0 0 8px #3fb950}
.dot.off{background:#f85149}
.row{display:flex;justify-content:space-between;padding:.4rem .6rem;background:#161b22;border-radius:6px;margin:.3rem 0}
.tool{padding:.5rem .6rem;background:#161b22;border-radius:6px;margin:.3rem 0}
.tool b{color:#79c0ff}
.tool p{margin:.2rem 0 0;color:#8b949e;font-size:.8rem}
</style></head><body>
<h1>HERMES HOME</h1>
<h2>Components</h2>
<div class="row"><span>${dot(health.ok)}Alexa+ MCP Server</span><span>${esc(MCP_URL)}</span></div>
<div class="row"><span>${dot(hermes.ok)}Hermes Agent</span><span>${esc(hermes.detail ?? hermes.error ?? 'unknown')}</span></div>
<div class="row"><span>${dot(Boolean(ha.ok))}Home Assistant</span><span>${esc(ha.detail ?? ha.error ?? 'not configured')}</span></div>
<h2>Exposed tools (${Array.isArray(tools.body) ? tools.body.length : 0})</h2>
${
  Array.isArray(tools.body)
    ? tools.body
        .map(
          (t) =>
            `<div class="tool"><b>${esc(t.name)}</b><p>${esc(t.description)}</p></div>`,
        )
        .join('\n')
    : '<p>tools endpoint unreachable</p>'
}
<h2>Endpoints</h2>
<div class="row"><span>POST /mcp</span><span>Alexa+ Streamable HTTP</span></div>
<div class="row"><span>GET /health · /ready · /tools</span><span>debug</span></div>
</body></html>`;

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, () => {
  console.log(`dashboard → http://127.0.0.1:${PORT} (watching ${MCP_URL})`);
});
