import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadTrace } from "./analyzer.js";
import { buildTimeline } from "./timeline.js";

export async function serveTraceViewer(tracePath: string, port = 7399): Promise<void> {
  const server = createServer(async (req, res) => {
    try {
      await route(req, res, tracePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      json(res, 500, { ok: false, error: message });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  process.stdout.write(`Trace viewer started at http://127.0.0.1:${port}\n`);
}

async function route(req: IncomingMessage, res: ServerResponse, tracePath: string): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (url.pathname === "/") {
    html(res, viewerHtml());
    return;
  }

  if (url.pathname === "/api/trace") {
    const records = await loadTrace(tracePath);
    json(res, 200, { ok: true, records });
    return;
  }

  if (url.pathname === "/api/timeline") {
    const records = await loadTrace(tracePath);
    const timeline = buildTimeline(records);
    const lagMs = Date.now() - timeline.latestTs;
    json(res, 200, {
      ok: true,
      generatedAt: Date.now(),
      lagMs,
      totalRecords: records.length,
      ...timeline,
    });
    return;
  }

  json(res, 404, { ok: false, error: "not found" });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function viewerHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FlexTrace Timeline</title>
  <style>
    :root { --bg:#101114; --panel:#16181e; --panel2:#1e222b; --line:#2b313d; --text:#e8edf6; --muted:#98a2b3; --accent:#5ab0ff; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--bg); color:var(--text); }
    .wrap { max-width: 1380px; margin: 0 auto; padding: 12px; }
    h1 { margin:0; font-size: 16px; letter-spacing: .2px; }
    .meta { color: var(--muted); margin-top: 4px; margin-bottom: 12px; font-size: 12px; }
    .grid { display:grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap:8px; margin-bottom:10px; }
    .card { background: var(--panel); border:1px solid var(--line); border-radius:6px; padding:8px 10px; }
    .card .k { color:var(--muted); font-size:11px; text-transform: uppercase; }
    .card .v { font-size:18px; margin-top:4px; }

    .trace { background: var(--panel); border:1px solid var(--line); border-radius:6px; overflow:hidden; margin-bottom:12px; }
    .trace-head { display:grid; grid-template-columns: 180px 1fr; border-bottom:1px solid var(--line); }
    .trace-head .left { background: var(--panel2); padding:6px 8px; color:var(--muted); font-size:11px; text-transform:uppercase; }
    .trace-head .right { position:relative; padding:6px 8px; color:var(--muted); font-size:11px; }
    .ticks { position:relative; height:18px; }
    .tick { position:absolute; top:0; bottom:0; width:1px; background:#333a47; }
    .tick-label { position:absolute; top:0; transform:translateX(-50%); white-space:nowrap; color:#8f99ac; }

    .lane { display:grid; grid-template-columns: 180px 1fr; border-bottom:1px solid #242a35; min-height:32px; }
    .lane:last-child { border-bottom:none; }
    .lane-label { background: var(--panel2); padding:7px 8px; font-size:12px; color:#c6d4e6; border-right:1px solid var(--line); }
    .lane-track { position:relative; min-height:32px; }
    .lane-gridline { position:absolute; top:0; bottom:0; width:1px; background:#252c38; }
    .task { position:absolute; top:6px; height:20px; border-radius:4px; overflow:hidden; border:1px solid rgba(255,255,255,.15); }
    .task-label { font-size:10px; line-height:18px; padding:0 6px; white-space:nowrap; text-overflow:ellipsis; overflow:hidden; color:#f4f7ff; }
    .a-agent_run { background: linear-gradient(90deg,#6166f5,#8d79ff); }
    .a-reasoning { background: linear-gradient(90deg,#f6a93b,#ffcb66); color:#1b1a19; }
    .a-coding { background: linear-gradient(90deg,#2cb67d,#65d99f); color:#10241a; }
    .a-tool { background: linear-gradient(90deg,#4fa3ff,#71c5ff); }
    .a-unknown-activity { background: linear-gradient(90deg,#6f7684,#8f95a2); }
    .status-running { box-shadow: 0 0 0 1px #7fffd4 inset; }
    .status-error { box-shadow: 0 0 0 1px #ff7b7b inset; }

    .section { margin-top: 12px; }
    .title { margin:0 0 6px; font-size:12px; color:#b8c4d6; text-transform: uppercase; }
    table { width:100%; border-collapse: collapse; background: var(--panel); border:1px solid var(--line); border-radius:6px; overflow:hidden; }
    th,td { padding:7px; border-bottom:1px solid #242a35; text-align:left; font-size:11px; }
    th { color:var(--muted); font-weight:600; text-transform: uppercase; }
    .tag { border:1px solid #3d4b61; padding:1px 6px; border-radius:999px; color:#c8dcf8; font-size:10px; }
    .error { color:#ff8f8f; }
    @media (max-width: 980px) { .grid { grid-template-columns: repeat(2,minmax(0,1fr)); } .trace-head, .lane { grid-template-columns: 120px 1fr; } }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>FlexTrace Timeline (Perfetto-style)</h1>
    <div class="meta" id="meta">Loading...</div>
    <div class="grid" id="cards"></div>

    <div class="section">
      <h2 class="title">Agent Lanes</h2>
      <div class="trace">
        <div class="trace-head">
          <div class="left">Agent / CPU</div>
          <div class="right"><div class="ticks" id="ticks"></div></div>
        </div>
        <div id="lanes"></div>
      </div>
    </div>

    <div class="section">
      <h2 class="title">Active Now</h2>
      <table><thead><tr><th>Agent</th><th>Activity</th><th>Name</th><th>Duration</th></tr></thead><tbody id="running"></tbody></table>
    </div>

    <div class="section">
      <h2 class="title">Agent Activity Totals</h2>
      <table><thead><tr><th>Agent</th><th>Activity</th><th>Count</th><th>Total</th><th>Avg</th><th>Errors</th></tr></thead><tbody id="agg"></tbody></table>
    </div>
  </div>
<script>
const fmt = (ms) => (ms < 1000 ? ms + "ms" : (ms/1000).toFixed(2) + "s");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[m]));

function renderTicks(el, minTs, maxTs) {
  const span = Math.max(1, maxTs - minTs);
  const n = 8;
  const items = [];
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * 100;
    const t = minTs + (span * i) / n;
    items.push('<div class="tick" style="left:'+x+'%"></div>');
    items.push('<div class="tick-label" style="left:'+x+'%">'+new Date(t).toLocaleTimeString()+'</div>');
  }
  el.innerHTML = items.join("");
}

function renderLanes(data) {
  const lanesEl = document.getElementById("lanes");
  const all = data.completedTasks.concat(data.activeTasks);
  if (!all.length) {
    lanesEl.innerHTML = '<div style="padding:10px;color:#98a2b3;">No tasks yet</div>';
    document.getElementById("ticks").innerHTML = "";
    return;
  }

  const minTs = Math.min(...all.map(s => s.startTs));
  const maxTs = Math.max(...all.map(s => s.endTs));
  const total = Math.max(1, maxTs - minTs);
  renderTicks(document.getElementById("ticks"), minTs, maxTs);

  const byAgent = new Map();
  for (const s of all) {
    const agent = s.agent || "unknown-agent";
    if (!byAgent.has(agent)) byAgent.set(agent, []);
    byAgent.get(agent).push(s);
  }

  const laneRows = [...byAgent.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([agent, tasks]) => {
    const bars = tasks.map((s) => {
      const left = ((s.startTs - minTs) / total) * 100;
      const width = Math.max(0.8, ((s.endTs - s.startTs) / total) * 100);
      const activity = s.activity || "unknown-activity";
      const cls = 'task a-' + activity + ' status-' + s.status;
      const label = esc(s.name + " • " + fmt(s.durationMs));
      const title = esc("agent=" + agent + "\\nactivity=" + activity + "\\nstatus=" + s.status + "\\nduration=" + fmt(s.durationMs));
      return '<div class="'+cls+'" title="'+title+'" style="left:'+left+'%;width:'+width+'%;"><div class="task-label">'+label+'</div></div>';
    }).join("");

    const gridLines = Array.from({length:9}).map((_,i)=>{
      const x=(i/8)*100;
      return '<div class="lane-gridline" style="left:'+x+'%"></div>';
    }).join("");

    return '<div class="lane"><div class="lane-label">'+esc(agent)+'</div><div class="lane-track">'+gridLines+bars+'</div></div>';
  });

  lanesEl.innerHTML = laneRows.join("");
}

async function pull() {
  const r = await fetch("/api/timeline", { cache: "no-store" });
  const data = await r.json();
  if (!data.ok) return;
  const lag = data.lagMs > 0 ? (" | trace-lag=" + fmt(data.lagMs)) : "";
  document.getElementById("meta").textContent = "records=" + data.totalRecords + " | trace-ts=" + new Date(data.latestTs).toLocaleTimeString() + lag;

  const cards = [
    ["Active tasks", data.activeTasks.length],
    ["Completed tasks", data.completedTasks.length],
    ["Tracepoints", data.tracepoints.length],
    ["Counters", data.counters.length],
  ];
  document.getElementById("cards").innerHTML = cards.map(([k,v]) => '<div class="card"><div class="k">'+k+'</div><div class="v">'+v+'</div></div>').join("");

  renderLanes(data);

  document.getElementById("running").innerHTML = data.activeTasks.slice(0,20).map(s =>
    "<tr><td><span class='tag'>"+(s.agent||"-")+"</span></td><td>"+(s.activity||"-")+"</td><td>"+s.name+"</td><td class='running'>"+fmt(s.durationMs)+"</td></tr>"
  ).join("");

  document.getElementById("agg").innerHTML = data.byAgentActivity.map(a =>
    "<tr><td><span class='tag'>"+a.agent+"</span></td><td>"+a.activity+"</td><td>"+a.count+"</td><td>"+fmt(a.totalMs)+"</td><td>"+fmt(a.avgMs)+"</td><td>"+a.errors+"</td></tr>"
  ).join("");
}
pull();
setInterval(pull, 2000);
</script>
</body>
</html>`;
}
