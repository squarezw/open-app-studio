/**
 * Self-contained live IFG viewer (no build step, no CDN) served at `/`.
 * The full Studio (Next.js + React Flow, screenshot nodes) replaces this in M1;
 * this page exists so `pnpm --filter @oas/gateway start` is demoable day one.
 */
export const VIEWER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>OAS — Live Interaction Flow Graph</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 14px/1.4 ui-sans-serif, system-ui; background: #0b0e14; color: #d6deeb; }
  header { display: flex; gap: 12px; align-items: center; padding: 10px 16px; border-bottom: 1px solid #1c2230; }
  header h1 { font-size: 15px; margin: 0 12px 0 0; font-weight: 600; }
  button, select { background: #1c2230; color: inherit; border: 1px solid #2a3347; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
  button:hover { border-color: #4a5775; }
  #status { color: #7a8aa6; margin-left: auto; }
  svg { width: 100vw; height: calc(100vh - 49px); display: block; }
  line { stroke: #2a3347; stroke-width: 1.5; }
  line.back { stroke-dasharray: 4 4; opacity: .5; }
  circle { stroke: #0b0e14; stroke-width: 2; }
  text { fill: #d6deeb; font-size: 11px; pointer-events: none; }
  text.role { fill: #7a8aa6; font-size: 9px; }
</style>
</head>
<body>
<header>
  <h1>Open App Studio — Live Flow Graph</h1>
  <button id="fakeBtn">▶ Run fake demo</button>
  <select id="runSel"><option value="">select a run…</option></select>
  <span id="status">idle</span>
</header>
<svg id="g"></svg>
<script>
const ROLE_COLORS = { launch:'#82aaff', auth:'#c792ea', search:'#89ddff', cart:'#f78c6c',
  checkout:'#ff5370', settings:'#a3aed0', profile:'#c3e88d', feed:'#ffcb6b', other:'#546e7a' };
const nodes = new Map(), edges = new Map();
let ws;

const svg = document.getElementById('g');
const statusEl = document.getElementById('status');
const runSel = document.getElementById('runSel');

document.getElementById('fakeBtn').onclick = async () => {
  const res = await fetch('/api/runs', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ appId:'com.fakeshop', driver:'fake', maxActions:60 }) });
  const { runId } = await res.json();
  await refreshRuns(runId);
  connect(runId);
};

runSel.onchange = () => runSel.value && connect(runSel.value);

async function refreshRuns(selectId) {
  const runs = await (await fetch('/api/runs')).json();
  runSel.replaceChildren(new Option('select a run…', ''));
  for (const r of runs) {
    // Option() assigns label via textContent — safe for untrusted appId.
    runSel.append(new Option(\`\${r.appId} — \${r.status}\`, r.id, false, r.id === selectId));
  }
}
refreshRuns();

function connect(runId) {
  if (ws) ws.close();
  nodes.clear(); edges.clear();
  statusEl.textContent = 'connecting…';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(\`\${proto}://\${location.host}/api/runs/\${runId}/events\`);
  ws.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.kind === 'graph') applyGraphEvent(ev.data);
    else if (ev.kind === 'log') statusEl.textContent = ev.data;
    else if (ev.kind === 'status') { statusEl.textContent = 'run ' + ev.data.status; refreshRuns(runId); }
  };
  ws.onclose = () => { if (statusEl.textContent === 'connecting…') statusEl.textContent = 'disconnected'; };
}

function applyGraphEvent(e) {
  const W = svg.clientWidth, H = svg.clientHeight;
  if (e.type === 'node') {
    const prev = nodes.get(e.node.id) ?? { x: W/2 + (Math.random()-0.5)*120, y: H/2 + (Math.random()-0.5)*120, vx:0, vy:0 };
    nodes.set(e.node.id, { ...prev, ...e.node });
  } else if (e.type === 'edge') {
    edges.set(e.edge.id, e.edge);
  }
}

function tick() {
  const W = svg.clientWidth, H = svg.clientHeight;
  const list = [...nodes.values()];
  for (const a of list) {
    a.vx += (W/2 - a.x) * 0.0008; a.vy += (H/2 - a.y) * 0.0008;
    for (const b of list) {
      if (a === b) continue;
      const dx = a.x-b.x, dy = a.y-b.y, d2 = Math.max(dx*dx+dy*dy, 100);
      const f = 9000 / d2; const d = Math.sqrt(d2);
      a.vx += (dx/d)*f*0.02; a.vy += (dy/d)*f*0.02;
    }
  }
  for (const e of edges.values()) {
    const a = nodes.get(e.from), b = nodes.get(e.to);
    if (!a || !b || a === b) continue;
    const dx = b.x-a.x, dy = b.y-a.y, d = Math.max(Math.sqrt(dx*dx+dy*dy), 1);
    const f = (d - 170) * 0.004;
    a.vx += (dx/d)*f; a.vy += (dy/d)*f; b.vx -= (dx/d)*f; b.vy -= (dy/d)*f;
  }
  for (const n of list) { n.vx *= 0.85; n.vy *= 0.85; n.x += n.vx; n.y += n.vy; }
  render();
  requestAnimationFrame(tick);
}

function render() {
  let out = '';
  for (const e of edges.values()) {
    const a = nodes.get(e.from), b = nodes.get(e.to);
    if (!a || !b) continue;
    out += \`<line class="\${e.action?.kind === 'back' ? 'back' : ''}" x1="\${a.x}" y1="\${a.y}" x2="\${b.x}" y2="\${b.y}"/>\`;
  }
  for (const n of nodes.values()) {
    const color = ROLE_COLORS[n.role] ?? ROLE_COLORS.other;
    const r = 14 + Math.min(n.visits ?? 1, 8);
    out += \`<circle cx="\${n.x}" cy="\${n.y}" r="\${r}" fill="\${color}"/>\`;
    out += \`<text x="\${n.x + r + 4}" y="\${n.y + 4}">\${escapeHtml(n.title ?? n.id)}</text>\`;
    if (n.role) out += \`<text class="role" x="\${n.x + r + 4}" y="\${n.y + 16}">\${escapeHtml(n.role)}</text>\`;
  }
  svg.innerHTML = out;
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
tick();
</script>
</body>
</html>
`;
