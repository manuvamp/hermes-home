/**
 * Simulated Alexa+ — the "client" half.
 *
 * Real Alexa+ discovers MCP tools over Streamable HTTP, lets an LLM decide
 * which to call, then speaks the result. This module does exactly that:
 *   1. connects to the Hermes Home MCP server with the official MCP SDK
 *   2. lists its tools (tools/list)
 *   3. lets an LLM (Gemini, if GOOGLE_API_KEY is set) pick tools via
 *      function-calling, or a keyword router if there is no key
 *   4. returns a short spoken reply + a trace of every MCP call
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = (process.env.MCP_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const MODEL = process.env.SIM_MODEL ?? 'gemini-2.5-flash';
const USER_ID = process.env.SIM_USER_ID ?? 'sim-user';
const MAX_STEPS = 5;

const SYSTEM = `You are Alexa+, a voice assistant. You have tools exposed by the "Hermes Home" MCP server.
Rules:
- Reply in one or two short spoken sentences. No markdown, no lists.
- Answer everyday questions, chit-chat and general knowledge YOURSELF. Do NOT call hermes_* tools unless the user mentions Hermes by name (those requests are normally routed before you see them).
- home_control is two-step: call it with confirm=false first, read the description back to the user and ask them to confirm. Only call it again with confirm=true after the user says yes.
- Never invent calendar, home or GitHub data; use the tools.`;

let client = null;
let toolsCache = null;

async function getClient() {
  if (client) return client;
  const c = new Client({ name: 'alexa-plus-simulator', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`), {
    requestInit: { headers: { 'x-user-id': USER_ID } },
  });
  await c.connect(transport);
  c.onclose = () => {
    client = null;
    toolsCache = null;
  };
  client = c;
  return c;
}

export async function listTools() {
  if (toolsCache) return toolsCache;
  const c = await getClient();
  toolsCache = (await c.listTools()).tools;
  return toolsCache;
}

async function callTool(name, args) {
  const started = Date.now();
  let result;
  try {
    const c = await getClient();
    const res = await c.callTool({ name, arguments: args ?? {} });
    const text = (res.content ?? []).map((p) => p.text ?? '').join('\n');
    try {
      result = JSON.parse(text);
    } catch {
      result = text;
    }
  } catch (err) {
    client = null;
    toolsCache = null;
    result = { success: false, error: String(err?.message ?? err) };
  }
  return { name, args: redact(args), result: redact(result), ms: Date.now() - started, _raw: result };
}

// Never put private identifiers (DM handles, snowflake IDs, tokens) on screen.
const REDACTIONS = [
  [/discord:[\w#.@-]+/gi, 'discord:•••'],
  [/\b\d{17,20}\b/g, '•••'],
  [/\b(?:sk|ghp|gsk|AIza)[\w-]{16,}\b/g, '•••'],
];
function redact(v) {
  if (v == null) return v;
  let t = typeof v === 'string' ? v : JSON.stringify(v);
  for (const [re, to] of REDACTIONS) t = t.replace(re, to);
  if (typeof v === 'string') return t;
  try { return JSON.parse(t); } catch { return t; }
}

// ---------- Gemini planner ----------

const UNSUPPORTED = new Set(['$schema', 'additionalProperties', 'default']);
function cleanSchema(s) {
  if (Array.isArray(s)) return s.map(cleanSchema);
  if (s && typeof s === 'object') {
    return Object.fromEntries(
      Object.entries(s)
        .filter(([k]) => !UNSUPPORTED.has(k))
        .map(([k, v]) => [k, cleanSchema(v)]),
    );
  }
  return s;
}

async function gemini(contents, tools) {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
    tools: [
      {
        functionDeclarations: tools.map((t) => {
          const schema = cleanSchema(t.inputSchema ?? {});
          const hasProps = schema.properties && Object.keys(schema.properties).length > 0;
          return {
            name: t.name,
            description: t.description ?? t.title ?? t.name,
            ...(hasProps ? { parameters: schema } : {}),
          };
        }),
      },
    ],
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': process.env.GOOGLE_API_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).candidates?.[0]?.content ?? { role: 'model', parts: [] };
}

const sessions = new Map(); // sessionId -> Gemini contents[]

async function llmTurn(sessionId, text) {
  const tools = await listTools();
  const contents = sessions.get(sessionId) ?? [];
  contents.push({ role: 'user', parts: [{ text }] });
  const trace = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const content = await gemini(contents, tools);
    contents.push({ role: 'model', parts: content.parts ?? [] });
    const calls = (content.parts ?? []).filter((p) => p.functionCall);
    if (calls.length === 0) {
      const reply = (content.parts ?? []).map((p) => p.text ?? '').join(' ').trim();
      sessions.set(sessionId, contents.slice(-30));
      return { reply: reply || 'Done.', trace };
    }
    const responses = [];
    for (const { functionCall } of calls) {
      const t = await callTool(functionCall.name, functionCall.args);
      trace.push(t);
      responses.push({
        functionResponse: {
          name: functionCall.name,
          response: { result: t._raw ?? t.result },
        },
      });
    }
    contents.push({ role: 'user', parts: responses });
  }
  sessions.set(sessionId, contents.slice(-30));
  return { reply: 'That took too many steps. Try asking a simpler question.', trace };
}


// ---------- OpenAI-compatible planner (Z.ai GLM, OpenAI, OpenRouter, ...) ----------
const oaSessions = new Map();
async function openaiTurn(sessionId, text) {
  const tools = await listTools();
  const messages = oaSessions.get(sessionId) ?? [{ role: 'system', content: SYSTEM }];
  messages.push({ role: 'user', content: text });
  const trace = [];
  const fns = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description ?? t.name, parameters: cleanSchema(t.inputSchema ?? { type: 'object', properties: {} }) },
  }));
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await fetch(`${process.env.SIM_LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.SIM_LLM_API_KEY}` },
      body: JSON.stringify({ model: process.env.SIM_LLM_MODEL, messages, tools: fns, ...(process.env.SIM_LLM_REASONING ? { reasoning_effort: process.env.SIM_LLM_REASONING } : {}) }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const msg = (await res.json()).choices?.[0]?.message ?? {};
    messages.push({ role: 'assistant', content: msg.content ?? '', ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) });
    if (!msg.tool_calls?.length) {
      oaSessions.set(sessionId, messages.slice(-30));
      return { reply: (msg.content ?? '').trim() || 'Done.', trace };
    }
    for (const tc of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
      const t = await callTool(tc.function.name, args);
      trace.push(t);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(t._raw ?? t.result).slice(0, 4000) });
    }
  }
  oaSessions.set(sessionId, messages.slice(-30));
  return { reply: 'That took too many steps. Try something simpler.', trace };
}

// ---------- keyword fallback (no API key needed) ----------


// Alexa's own replies for everyday chatter -- no Hermes involved.
function alexaChat(text) {
  const t = text.toLowerCase().trim();
  const now = new Date();
  if (/^(hi|hello|hey|yo|good (morning|afternoon|evening))\b/.test(t)) return 'Hi! What can I do for you?';
  if (/how are you/.test(t)) return "I'm doing great, thanks for asking.";
  if (/(thank|thanks)/.test(t)) return "You're welcome.";
  if (/what('?s| is) the time|what time/.test(t)) return `It's ${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
  if (/(what('?s| is) (the )?(date|day)|today'?s date)/.test(t)) return `Today is ${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}.`;
  if (/who are you|what are you/.test(t)) return "I'm Alexa, simulated here. For anything deep, I hand off to Hermes, your personal agent.";
  if (/(what can you do|help)/.test(t))
    return 'I can answer everyday questions, check your calendar and home, and message you on Discord. Say "ask Hermes" for research, plans, or carousels.';
  return "I'm not sure about that one. Say \"ask Hermes\" and I'll hand it to your agent.";
}

const pending = new Map(); // sessionId -> { target, action }
const lastRun = new Map(); // sessionId -> runId
let globalLastRun = null;   // most recent task, survives page refreshes
let globalLastKind = '';

const speak = (r) =>
  typeof r === 'string'
    ? r
    : r?.success === false
      ? `Sorry, that didn't work: ${r.error ?? 'unknown error'}`
      : r?.message ?? r?.answer ?? r?.result ?? r?.summary ?? JSON.stringify(r).slice(0, 300);

async function ruleTurn(sessionId, text) {
  const t = text.toLowerCase().trim();
  const trace = [];
  const run = async (name, args) => {
    const r = await callTool(name, args);
    trace.push(r);
    return r._raw ?? r.result;
  };

  if (pending.has(sessionId)) {
    const p = pending.get(sessionId);
    pending.delete(sessionId);
    if (/^(yes|yeah|yep|confirm|do it|sure|ok)/.test(t)) {
      const r = await run('home_control', { ...p, confirm: true });
      return { reply: speak(r), trace };
    }
    return { reply: 'Okay, cancelled.', trace };
  }

  let m;
  if ((m = t.match(/turn (on|off) (?:the |my )?(.+)/))) {
    const args = { target: m[2], action: m[1], confirm: false };
    const r = await run('home_control', args);
    if (r?.success === false) return { reply: speak(r), trace };
    pending.set(sessionId, { target: args.target, action: args.action });
    return { reply: `${speak(r)} Should I go ahead?`, trace };
  }
  if (/tomorrow/.test(t) && /(calendar|schedule|meeting|plate)/.test(t))
    return { reply: speak(await run('calendar_tomorrow', {})), trace };
  if (/(calendar|schedule|meeting|plate|today)/.test(t))
    return { reply: speak(await run('calendar_today', {})), trace };
  if (/github|issues/.test(t))
    return { reply: speak(await run('github_my_issues', {})), trace };
  if (/(is hermes done|what did it find|status)/.test(t) && lastRun.has(sessionId)) {
    const id = lastRun.get(sessionId);
    const s = await run('hermes_task_status', { runId: id });
    if (s?.status === 'completed') return { reply: brief(speak(await run('hermes_task_result', { runId: id }))), trace };
    return { reply: `Hermes is still ${s?.status ?? 'working'}.`, trace };
  }
  if (/^remember /.test(t))
    return { reply: speak(await run('hermes_remember', { content: text.slice(9) })), trace };
  return { reply: alexaChat(text), trace };
}

// Voice-friendly: strip markdown, keep at most two sentences / ~240 chars. Full text stays in the trace.
function brief(t) {
  const plain = String(t).replace(/[*#`_>]+/g, ' ').replace(/\s+/g, ' ').trim();
  const sentences = plain.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [plain];
  let out = '';
  for (const x of sentences) {
    if ((out + x).length > 240 && out) break;
    out += x;
    if (out.split(/[.!?]/).length > 2) break;
  }
  out = out.trim() || plain;
  return out.length > 260 ? out.slice(0, 257) + '...' : out;
}

// Anything that mentions Hermes goes straight to the Hermes agent.
async function hermesTurn(sessionId, text) {
  const t = text.toLowerCase();
  const trace = [];
  const run = async (name, args) => {
    const r = await callTool(name, args);
    trace.push(r);
    return r._raw ?? r.result;
  };
  const id = lastRun.get(sessionId) ?? globalLastRun;
  const asksStatus = /(done|finished|ready|what did (it|he|hermes) find|status|result)/.test(t);
  if (!id && asksStatus && !/(ask hermes|tell hermes)/.test(t))
    return { reply: "I'm not tracking any Hermes task right now.", trace };
  if (id && asksStatus) {
    const s = await run('hermes_task_status', { runId: id });
    if (s?.status === 'completed' || s?.status === 'complete')
      return { reply: speak(await run('hermes_task_result', { runId: id })), trace };
    return { reply: `Hermes is still ${s?.status ?? 'working'}.`, trace };
  }
  const prompt = text
    .replace(/^\s*(alexa,?\s*)?(please\s*)?(ask|tell|have|get)\s+hermes\s*(to|about|if|whether|that)?\s*/i, '')
    .trim() || text;
  if (/(research|figure out|prepare|look into|find out|investigate|summari[sz]e|plan|draft|write)/.test(t)) {
    const r = await run('hermes_start_task', { prompt });
    if (r?.runId) { lastRun.set(sessionId, r.runId); globalLastRun = r.runId; }
    return { reply: "I've asked Hermes to work on that. Ask me if it's done.", trace };
  }
  const r = await run('hermes_ask', { prompt });
  if (r?.success === false && /abort|timed? ?out/i.test(String(r.error))) {
    // Too slow for a quick ask: run it as a background task and wait for the answer.
    const start = await run('hermes_start_task', { prompt });
    if (!start?.runId) return { reply: speak(start), trace };
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      const st = await run('hermes_task_status', { runId: start.runId });
      if (st?.status === 'completed' || st?.status === 'complete')
        return { reply: brief(speak(await run('hermes_task_result', { runId: start.runId }))), trace };
      if (['failed', 'error', 'cancelled'].includes(st?.status))
        return { reply: `Hermes couldn't finish that (${st.status}).`, trace };
    }
    return { reply: 'Hermes is still thinking. Ask me again in a moment.', trace };
  }
  return { reply: brief(speak(r)), trace };
}

const MESSAGE_RE = /(send|message|text|dm|ping)\b.*\b(discord|telegram|slack)\b|\b(discord|telegram|slack)\b.*\b(send|message|ping)|\b(dm me|send me)\b/i;

// "Make me a carousel for The Homeless Entrepreneur and send it to Discord" — runs the
// homeless-carousel skill (renders slide images) as a long Hermes task; the skill delivers to Discord.
async function carouselTurn(sessionId, text) {
  const trace = [];
  const run = async (name, args) => {
    const r = await callTool(name, args);
    trace.push(r);
    return r._raw ?? r.result;
  };
  const topic = text.replace(/(alexa|hermes)/gi, '').trim();
  const prompt =
    `Voice request: "${topic}". Use your homeless-carousel skill to create a LinkedIn/Instagram carousel for ` +
    `The Homeless Entrepreneur (Manu's personal brand) on the topic they asked for, or pick a strong topic from your topic pool if none was given. ` +
    `Render the slides and deliver them ONLY to my Discord DM using the skill's own Discord delivery. ` +
    `Do NOT publish or post anywhere else. When finished, reply with one line: "Delivered: <carousel title>", or "Failed: <reason>".`;
  const start = await run('hermes_start_task', { prompt });
  if (!start?.runId) return { reply: speak(start), trace };
  lastRun.set(sessionId, start.runId); globalLastRun = start.runId; globalLastKind = 'task';
  let lastStatus;
  for (let i = 0; i < 160; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const stc = await callTool('hermes_task_status', { runId: start.runId });
    const st = stc._raw ?? stc.result;
    lastStatus = stc;
    if (st?.status === 'completed' || st?.status === 'complete') {
      if (lastStatus) trace.push(lastStatus);
      const out = String((await run('hermes_task_result', { runId: start.runId }))?.result ?? '');
      const failed = /^\s*Failed:/i.test(out);
      return { reply: failed ? `The carousel didn't finish. ${out.replace(/^\s*Failed:\s*/i, '').slice(0, 200)}` : 'Your carousel is on Discord.', sent: !failed, trace };
    }
    if (['failed', 'error', 'cancelled'].includes(st?.status))
      return { reply: `Hermes couldn't finish the carousel (${st.status}).`, trace };
  }
  return { reply: 'The carousel is still rendering. Check Discord in a minute.', trace };
}

// "Send me a message on Discord ..." — optionally have Hermes write it first.
async function messageTurn(text) {
  const trace = [];
  const run = async (name, args) => {
    const r = await callTool(name, args);
    trace.push(r);
    return r._raw ?? r.result;
  };
  const channel = /discord/i.test(text) ? 'discord' : /telegram/i.test(text) ? 'telegram' : /slack/i.test(text) ? 'slack' : undefined;

  // Preferred path: Hermes already has the messaging platform wired up, so
  // delegate the whole thing to the agent and wait for it to finish.
  if (process.env.SIM_DELEGATE_TO_HERMES) {
    const where = channel ?? 'Discord';
    const cleaned = text.replace(/\b(alexa|hermes)\b,?/gi, '').trim();
    const prompt =
      `The user asked, via voice: "${cleaned}". ` +
      `Use your messaging/send_message capability to deliver the requested message to the user's ${where} home channel. ` +
      `If they gave exact wording, send that. If they asked for a question or note, write a short, genuinely good one yourself (under 300 characters) and send it. ` +
      `After sending, reply with exactly what you sent, prefixed by "Sent:". If you cannot send, say why in one sentence, prefixed by "Failed:". Never reveal tokens.`;
    const start = await run('hermes_start_task', { prompt });
    if (!start?.runId) return { reply: speak(start), trace };
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const s = await run('hermes_task_status', { runId: start.runId });
      if (s?.status === 'completed' || s?.status === 'complete') {
        const out = String((await run('hermes_task_result', { runId: start.runId }))?.result ?? '');
        return {
          reply: /^\s*Failed:/i.test(out) ? `Hermes couldn't send it. ${out.replace(/^\s*Failed:\s*/i, '')}` : `Done. Hermes sent it to your ${where}. ${out.replace(/^\s*Sent:\s*/i, '')}`,
          trace,
        };
      }
      if (s?.status === 'failed' || s?.status === 'error' || s?.status === 'cancelled')
        return { reply: `Hermes ran into a problem sending that (${s.status}). Try again in a moment.`, trace };
    }
    return { reply: "Hermes is still working on sending that. I'll let you know.", trace };
  }

  // Explicit wording: send ... saying/that/: "<message>"
  const explicit = text.match(/(?:saying|says|that says|the message)\s*:?\s*["“']?(.+?)["”']?\s*$/i) ?? text.match(/:\s*["“']?(.+?)["”']?\s*$/);
  let message = explicit?.[1]?.trim();
  if (!message || /hermes/i.test(text)) {
    // Let Hermes write (or answer) the content, then deliver it.
    const ask = text
      .replace(/(and\s+)?(send|message|text|dm|ping)\s+(it|that|me)?\s*(to me)?\s*(on|via|to|through)?\s*(my\s+)?(personal\s+)?(discord|telegram|slack)/gi, '')
      .replace(/\b(alexa|ask hermes( to)?)\b,?/gi, '')
      .trim();
    const prompt = ask.length > 8
      ? `${ask}\n\nReply with only the message text, under 400 characters, no preamble.`
      : 'Write one short, thought-provoking question for me to ponder today. Reply with only the question.';
    const heavy = /(buffer|breakdown|analytics|report|summar|last week|this week|posts|research|review|stats|performance)/i.test(text);
    if (heavy) {
      // Real work (e.g. Buffer analysis): run as an async Hermes task and wait for it.
      const full = prompt.replace('under 400 characters', 'under 1500 characters, plain text with short lines (it will be sent as a Discord message)');
      const start = await run('hermes_start_task', { prompt: full });
      if (!start?.runId) return { reply: speak(start), trace };
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const s = await run('hermes_task_status', { runId: start.runId });
        if (s?.status === 'completed' || s?.status === 'complete') {
          message = String((await run('hermes_task_result', { runId: start.runId }))?.result ?? '').trim();
          break;
        }
        if (['failed', 'error', 'cancelled'].includes(s?.status))
          return { reply: `Hermes couldn't finish that (${s.status}). Try again in a moment.`, trace };
      }
      if (!message) return { reply: "Hermes is still working on it. Ask me again in a minute.", trace };
    } else {
      const r = await run('hermes_ask', { prompt });
      message = r?.success === false ? undefined : String(r?.answer ?? '').trim();
      if (!message) return { reply: speak(r), trace };
    }
  }
  if (/^\W*(refused|failed|error|sorry|i (can't|cannot|am unable)|unable to)\b|restricted to its owner/i.test(message.slice(0, 160)))
    return { reply: `Hermes couldn't do that, so I didn't send anything. It said: ${message.slice(0, 160)}`, trace };
  const sent = await run('send_message', { message: message.slice(0, 1800) });
  return {
    reply: sent?.success
      ? `Sent to your ${channel ?? 'messaging channel'}.`
      : speak(sent),
    sent: Boolean(sent?.success),
    trace,
  };
}

// Results of background work, picked up by the page via /sim/poll.
const outbox = new Map(); // sessionId -> [{reply, trace, brain}]
const clean = (out) => ({ ...out, reply: redact(out.reply), trace: (out.trace ?? []).map(({ _raw, ...t }) => t) });

export function poll(sessionId) {
  const q = outbox.get(sessionId) ?? [];
  outbox.set(sessionId, []);
  return q;
}

// Hermes- and messaging-bound requests answer instantly and finish in the background.
export async function say(sessionId, text) {
  const isCar = /carousel/i.test(text);
  const isMsg = !isCar && MESSAGE_RE.test(text);
  if (isCar || isMsg || /hermes/i.test(text)) {
    const work = isCar ? carouselTurn(sessionId, text) : isMsg ? messageTurn(text) : hermesTurn(sessionId, text);
    const brain = isCar ? 'carousel-route' : isMsg ? 'message-route' : 'hermes-route';
    work
      .then((out) => {
        const o = clean(out);
        if (isMsg) o.reply = out.sent ? 'Sent to your Discord.' : o.reply;
        outbox.set(sessionId, [...(outbox.get(sessionId) ?? []), { ...o, brain }]);
      })
      .catch((err) =>
        outbox.set(sessionId, [...(outbox.get(sessionId) ?? []), { reply: `Sorry, that failed: ${err.message}`, trace: [], brain }]),
      );
    return {
      reply: isCar ? "On it. I'll make that carousel and send it to your Discord. It takes a couple of minutes." : isMsg ? "On it. I'll send that to your Discord." : 'Let me ask Hermes.',
      trace: [],
      brain,
      pending: true,
    };
  }
  return clean(await sayInner(sessionId, text));
}

async function sayInner(sessionId, text) {
  try {
    if (process.env.SIM_LLM_API_KEY && process.env.SIM_LLM_BASE_URL && process.env.SIM_LLM_MODEL)
      return { ...(await openaiTurn(sessionId, text)), brain: `llm:${process.env.SIM_LLM_MODEL}` };
    return process.env.GOOGLE_API_KEY
      ? { ...(await llmTurn(sessionId, text)), brain: `gemini:${MODEL}` }
      : { ...(await ruleTurn(sessionId, text)), brain: 'alexa-basic' };
  } catch (err) {
    return { reply: `Sorry, something went wrong: ${err.message}`, trace: [], brain: 'error' };
  }
}
