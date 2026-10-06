export const simPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alexa+ Simulator — Hermes Home</title>
<style>
:root{--bg:#0b1020;--card:#141b30;--line:#26304f;--ink:#e8ecf7;--mute:#8b95b5;--cyan:#27c4f5;--ok:#3fb950;--bad:#f85149}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px system-ui,sans-serif;height:100vh;display:grid;grid-template-columns:1fr 380px}
@media(max-width:800px){body{grid-template-columns:1fr;height:auto}}
main{display:flex;flex-direction:column;height:100vh;min-width:0}
header{padding:14px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px}
.ring{width:26px;height:26px;border-radius:50%;border:4px solid var(--cyan);box-shadow:0 0 14px var(--cyan)}
.ring.live{animation:p 1s infinite alternate}@keyframes p{to{box-shadow:0 0 28px var(--cyan);transform:scale(1.12)}}
header b{font-size:17px}header small{color:var(--mute);margin-left:auto}
#chat{flex:1;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:10px}
.m{max-width:80%;padding:10px 14px;border-radius:14px;line-height:1.4}
.u{align-self:flex-end;background:#1d4ed8}.a{align-self:flex-start;background:var(--card);border:1px solid var(--line)}
form{display:flex;gap:8px;padding:14px 20px;border-top:1px solid var(--line)}
input{flex:1;background:var(--card);border:1px solid var(--line);color:var(--ink);padding:12px 14px;border-radius:10px;font:inherit}
button{background:var(--cyan);color:#001;border:0;border-radius:10px;padding:0 16px;font-weight:600;cursor:pointer}
button.mic{background:var(--card);color:var(--ink);border:1px solid var(--line)}button.mic.on{background:var(--bad);color:#fff}
.chips{padding:0 20px 10px;display:flex;gap:6px;flex-wrap:wrap}.chips span{font-size:12px;border:1px solid var(--line);border-radius:99px;padding:4px 10px;color:var(--mute);cursor:pointer}
aside{border-left:1px solid var(--line);background:#0e1428;overflow:auto;padding:16px;height:100vh}
aside h3{margin:0 0 4px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}
.call{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px;margin:8px 0;font:12px ui-monospace,Consolas,monospace}
.call b{color:var(--cyan)}.call .ms{float:right;color:var(--mute)}.call pre{margin:6px 0 0;white-space:pre-wrap;word-break:break-word;color:#b6c2e8;max-height:140px;overflow:auto}
.tag{font-size:11px;color:var(--mute)}
</style></head><body>
<main>
<header><div class="ring" id="ring"></div><b>Alexa+ <span style="color:var(--mute);font-weight:400">simulator</span></b><small id="brain"></small></header>
<div id="chat"></div>
<div class="chips" id="chips"></div>
<form id="f"><button type="button" class="mic" id="mic" title="Speak">🎙</button><input id="t" placeholder='Try: "Alexa, what is on my calendar today?"' autocomplete="off"><button>Send</button></form>
</main>
<aside><h3>MCP traffic</h3><div class="tag">Streamable HTTP · tools/call → Hermes Home</div><div id="trace"></div></aside>
<script>
const sid='s'+Math.random().toString(36).slice(2),chat=document.getElementById('chat'),trace=document.getElementById('trace'),ring=document.getElementById('ring');
const prompts=["Ask Hermes what a good question to reflect on today is","Send me a message on Discord with a question to think about","Ask Hermes to plan a productive Saturday","Is Hermes done?"];
const chips=document.getElementById('chips');prompts.forEach(p=>{const s=document.createElement('span');s.textContent=p;s.onclick=()=>send(p);chips.append(s)});
function add(cls,txt){const d=document.createElement('div');d.className='m '+cls;d.textContent=txt;chat.append(d);chat.scrollTop=1e9;return d}
function speak(t){if(!window.speechSynthesis)return;speechSynthesis.cancel();t=t.replace(/[*#_\`>-]+/g,' ').replace(/\\s+/g,' ').trim();if(t.length>260)t=t.slice(0,260).replace(/[^.!?]*$/,'')||t.slice(0,260);const u=new SpeechSynthesisUtterance(t);u.onstart=()=>ring.classList.add('live');u.onend=()=>ring.classList.remove('live');speechSynthesis.speak(u)}
function renderTrace(list){for(const c of list){const d=document.createElement('div');d.className='call';d.innerHTML='<span class="ms"></span><b></b><pre></pre>';d.querySelector('.ms').textContent=c.ms+' ms';d.querySelector('b').textContent='tools/call '+c.name;d.querySelector('pre').textContent=JSON.stringify(c.args)+'\n→ '+JSON.stringify(c.result,null,1);trace.prepend(d)}}
async function waitFor(){const start=Date.now();while(Date.now()-start<240000){await new Promise(r=>setTimeout(r,2000));const evs=await (await fetch('/sim/poll?sid='+sid)).json();if(evs.length){for(const e of evs){add('a',e.reply);renderTrace(e.trace);speak(e.reply)}return}}add('a',"Hermes is taking a while. Ask me again in a moment.")}
async function send(text){text=text.replace(/^alexa,?\\s*/i,'').trim();if(!text)return;add('u',text);const w=add('a','…');ring.classList.add('live');
 try{const r=await (await fetch('/sim/say',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:sid,text})})).json();
  w.textContent=r.reply;document.getElementById('brain').textContent='brain: '+r.brain;
  for(const c of r.trace){const d=document.createElement('div');d.className='call';d.innerHTML='<span class="ms"></span><b></b><pre></pre>';d.querySelector('.ms').textContent=c.ms+' ms';d.querySelector('b').textContent='tools/call '+c.name;d.querySelector('pre').textContent=JSON.stringify(c.args)+'\\n→ '+JSON.stringify(c.result,null,1);trace.prepend(d)}
  speak(r.reply);if(r.pending)waitFor()}catch(e){w.textContent='Error: '+e}finally{if(!speechSynthesis.speaking)ring.classList.remove('live')}}
document.getElementById('f').onsubmit=e=>{e.preventDefault();const i=document.getElementById('t');send(i.value);i.value=''};
const SR=window.SpeechRecognition||window.webkitSpeechRecognition,mic=document.getElementById('mic');
if(SR){const r=new SR();r.lang='en-US';r.onresult=e=>send(e.results[0][0].transcript);r.onend=()=>mic.classList.remove('on');mic.onclick=()=>{mic.classList.add('on');r.start()}}else mic.style.display='none';
add('a',"Hi, I'm Alexa+ (simulated). I'm connected to the Hermes Home MCP server. Ask me anything.");
</script></body></html>`;
