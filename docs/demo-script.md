# Demo script (≈2:30, limit 3:00)

**Before recording:** `npm run demo` → open `http://127.0.0.1:3100/sim` (Chrome, Ctrl+F5). Discord open on a second screen/phone. Delete old test DMs. Do one dry run of the carousel so Hermes is warm.

| Time | On screen | Say |
|---|---|---|
| **0:00–0:15** | README architecture diagram | "Alexa+ plugs into remote MCP servers. Hermes, my personal AI agent, only speaks stdio. So I built Hermes Home — a Streamable HTTP MCP bridge between them." |
| **0:15–0:35** | Simulator page. Say or type **"Hi"** | "This is an Alexa+ simulator — an MCP client built on the official SDK. Everyday chat, Alexa handles herself." |
| **0:35–1:00** | Click **🎙 Reflect** (or say "Ask Hermes what a good question to reflect on today is") | "When I say 'Hermes', it hands off. Notice Alexa answers instantly while the agent works — voice never waits on a slow agent." Point at the trace panel: "That's a real `tools/call` over Streamable HTTP." |
| **1:00–1:25** | Click **💬 Discord question** → show phone | "Now an action. Hermes writes a question and delivers it through its own Discord gateway." Cut to the DM arriving. |
| **1:25–2:05** | Click **🎠 Carousel → Discord** | "The big one: I ask for a carousel for my brand. Hermes runs its carousel skill — plans, renders eight slides — and delivers them to Discord. Long task, fully async." (Cut while it renders, ~90 s.) |
| **2:05–2:20** | Discord: carousel slides | "Real rendered slides, from one sentence." |
| **2:20–2:45** | README / safety list | "14 hand-picked tools, never the whole agent. Fail-closed gate, per-user isolation, confirmation for home control, OAuth2 for internet exposure. MIT licensed." |
| **2:45–3:00** | Repo URL on screen | "Hermes Home: your voice on the front, your agent underneath." |

## Don't show
- Hermes skill list, Discord DM list/handle, `.env`, the VM IP.
- Calendar / home / GitHub (not configured).

## If something fails live
- Carousel slow? Pre-record it and cut in the Discord arrival.
- Hermes timeout? Click the button again; detailed asks auto-fall back to a background task.
