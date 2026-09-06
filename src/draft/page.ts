import { countByStatus } from "./draft.js";
import type { ReviewSession } from "../review/session.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The page is served from a local server with no network access to CDNs, and
 * pulling a markdown library would make it depend on the internet to render a
 * handful of bold marks and code spans. So it renders them itself.
 */
const MARKDOWN_JS = String.raw`
function inline(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^_]+)_/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function renderMarkdown(source) {
  const out = [];
  let list = null;

  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();

    if (/^---+$/.test(line)) { if (list) { out.push("</ul>"); list = null; } out.push("<hr>"); continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      if (!list) { out.push("<ul>"); list = true; }
      out.push("<li>" + inline(line.replace(/^\s*[-*]\s+/, "")) + "</li>");
      continue;
    }
    if (list) { out.push("</ul>"); list = null; }
    if (line === "") continue;

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) { const level = heading[1].length; out.push("<h" + level + ">" + inline(heading[2]) + "</h" + level + ">"); continue; }

    out.push("<p>" + inline(line) + "</p>");
  }

  if (list) out.push("</ul>");
  return out.join("");
}
`;

const STYLE = `
:root { color-scheme: light dark; --bg:#fbfbfa; --fg:#1a1a19; --muted:#6b6b68; --line:#e3e3e0;
  --card:#fff; --accent:#2f6f4f; --danger:#a33; --warn:#8a6d1f;
  /* One colour per severity, mirroring the GitHub alert each one publishes as. */
  --blocker:#c0392b; --issue:#b7791f; --suggestion:#2f855a; --question:#2b6cb0;
  --blocker-bg:#c0392b14; --issue-bg:#b7791f14; --suggestion-bg:#2f855a14; --question-bg:#2b6cb014;
  /* Badges are solid: filled on light, so the count reads at a glance. */
  --b-fg:#fff; --b-pending:#5b6573; --b-valid:#2f855a; --b-discarded:#c0392b; --b-rework:#b7791f; }
@media (prefers-color-scheme: dark) { :root { --bg:#17181a; --fg:#e8e8e6; --muted:#9a9a96;
  --line:#2e3033; --card:#1e2022; --accent:#6cc49a; --danger:#e08c8c; --warn:#d9bd6a; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; }
header { position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line); padding:16px 24px; z-index:5; }
h1 { margin:0 0 4px; font-size:17px; }
.sub { color:var(--muted); font-size:13px; }
main { max-width:900px; margin:0 auto; padding:24px; }
details.group { border:1px solid var(--line); border-radius:10px; background:var(--card); margin-bottom:10px; }
details.group > summary { cursor:pointer; padding:13px 16px; list-style:none;
  display:flex; gap:10px; align-items:flex-start; border-radius:9px; }
details.group > summary::-webkit-details-marker { display:none; }
details.group > summary::before { content:"\u25B8"; color:var(--muted); flex:0 0 12px;
  line-height:1.5; transition:transform .15s ease; }
details.group[open] > summary::before { transform:rotate(90deg); }
details.group > summary:hover { background:rgba(127,127,127,.05); }
details.group[open] > summary { border-bottom:1px solid var(--line); border-radius:9px 9px 0 0; margin-bottom:14px; }
.head { flex:1; min-width:0; }
.name { font-weight:650; word-break:break-all; }
.path { font-style:italic; font-size:12px; color:var(--muted); word-break:break-all; margin-top:1px; }
.badges { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.badge { font-size:11px; font-weight:650; line-height:1.9; padding:0 10px; border-radius:999px;
  white-space:nowrap; color:var(--b-fg); border:1px solid transparent; letter-spacing:.01em; }
.badge[data-kind="pending"]   { background:var(--b-pending); }
.badge[data-kind="valid"]     { background:var(--b-valid); }
.badge[data-kind="discarded"] { background:var(--b-discarded); }
.badge[data-kind="rework"]    { background:var(--b-rework); }
.badge[data-kind="done"]      { background:var(--b-valid); }
.badge[data-kind="skipped"]   { background:var(--b-pending); }
/* A zero is not news: it drops to an outline so the filled ones carry the eye. */
.badge.zero { background:transparent; color:var(--muted); border-color:var(--line); font-weight:500; }
details.group > .card { margin:0 14px 14px; }
details.group > .fix { margin:0; padding:12px 16px; }
.card { background:var(--card); border:1px solid var(--line); border-left:4px solid var(--line);
  border-radius:10px; padding:16px; margin-bottom:14px; }
.card[data-sev="blocker"]    { border-left-color:var(--blocker); }
.card[data-sev="issue"]      { border-left-color:var(--issue); }
.card[data-sev="suggestion"] { border-left-color:var(--suggestion); }
.card[data-sev="question"]   { border-left-color:var(--question); }
.sev { border:1px solid currentColor; border-radius:999px; padding:1px 9px; font-weight:600; }
.sev[data-sev="blocker"]    { color:var(--blocker); background:var(--blocker-bg); }
.sev[data-sev="issue"]      { color:var(--issue); background:var(--issue-bg); }
.sev[data-sev="suggestion"] { color:var(--suggestion); background:var(--suggestion-bg); }
.sev[data-sev="question"]   { color:var(--question); background:var(--question-bg); }
.fix[data-sev] .fixtitle::before { content:""; display:inline-block; width:8px; height:8px;
  border-radius:50%; margin-right:8px; vertical-align:middle; }
.fix[data-sev="blocker"]    .fixtitle::before { background:var(--blocker); }
.fix[data-sev="issue"]      .fixtitle::before { background:var(--issue); }
.fix[data-sev="suggestion"] .fixtitle::before { background:var(--suggestion); }
.fix[data-sev="question"]   .fixtitle::before { background:var(--question); }
.card.discarded { opacity:.45; }
.card.valid { border-color:var(--accent); }
.card.rework { border-color:var(--warn); }
.meta { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:10px; font-size:12px; color:var(--muted); }
.tag { border:1px solid var(--line); border-radius:999px; padding:1px 9px; }
.body p { margin:.5em 0; } .body h1,.body h2,.body h3 { font-size:15px; margin:.6em 0 .2em; }
.body code { background:rgba(127,127,127,.16); padding:1px 5px; border-radius:4px; font-size:13px; }
.body hr { border:0; border-top:1px solid var(--line); margin:12px 0; }
.actions { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
button { font:inherit; font-size:13px; padding:5px 12px; border-radius:7px; border:1px solid var(--line);
  background:transparent; color:var(--fg); cursor:pointer; }
button:hover { border-color:var(--muted); }
button.on[data-act="valid"] { background:var(--accent); border-color:var(--accent); color:#fff; }
button.on[data-act="discarded"] { background:var(--danger); border-color:var(--danger); color:#fff; }
button.on[data-act="rework"] { background:var(--warn); border-color:var(--warn); color:#111; }
textarea { width:100%; min-height:110px; font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;
  padding:10px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--fg); }
.hidden { display:none; }
.confirm { margin:32px 0 60px; padding-top:20px; border-top:1px solid var(--line); }
button.primary { background:var(--accent); border-color:var(--accent); color:#fff; padding:9px 18px; font-size:14px; }
.done { color:var(--accent); font-weight:600; }
.empty { color:var(--muted); padding:40px 0; }
.fix { display:flex; gap:12px; align-items:flex-start; padding:12px 0; border-bottom:1px solid var(--line); }
.fix.done .fixtitle, .fix.skipped .fixtitle { text-decoration:line-through; color:var(--muted); }
.fix .where { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; color:var(--muted); }
.fixnote { font-size:13px; color:var(--muted); margin-top:4px; }
.mark { width:26px; height:26px; flex:0 0 26px; border-radius:7px; padding:0; line-height:1; }
.mode { display:flex; gap:8px; margin-bottom:18px; }
`;

export function renderPage(session: ReviewSession): string {
  const draft = session.draft;
  const counts = draft ? countByStatus(draft) : undefined;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Revisión PR #${session.prNumber}</title>
<style>${STYLE}</style></head>
<body>
<header>
  <h1>PR #${session.prNumber} — ${escapeHtml(session.title)}</h1>
  <div class="sub">
    ${escapeHtml(session.sourceBranch)} → ${escapeHtml(session.targetBranch)} ·
    <span id="summary">${counts ? `${counts.pending} sin revisar · ${counts.valid} válidos · ${counts.discarded} descartados · ${counts.rework} para otra vuelta` : ""}</span>
  </div>
</header>
<main>
  <div id="list"></div>
  <div class="confirm">
    <button class="primary" id="confirm">Confirmar borrador</button>
    <span id="confirmed" class="done hidden">Confirmado. Vuelve al agente para continuar.</span>
  </div>
</main>
<script>
${MARKDOWN_JS}
const REVIEW = ${JSON.stringify(session.id)};
const SEV = { blocker: "🛑 Bloqueante", issue: "⚠️ Problema", suggestion: "💡 Sugerencia", question: "❓ Duda" };

async function post(path, payload) {
  await fetch("/r/" + REVIEW + "/" + path, {
    method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify(payload),
  });
}

// The body being edited, while it is only in the browser.
//
// Every action rebuilds the whole list from the server, so without this a click
// on one comment throws away the edit you had half written on another. Keyed by
// comment id, it outlives the elements it belongs to.
const typed = new Map();

function stateOf(id) {
  let state = typed.get(id);
  if (!state) { state = { body: undefined, editing: false }; typed.set(id, state); }
  return state;
}

async function save(id, payload) {
  await post("comment/" + id, payload);
  await load();
}

// Which accordions are open, so a reload does not close what you were reading.
const openGroups = new Set();

function esc(text) { return String(text).replace(/</g, "&lt;"); }

function badge(count, label, kind) {
  return '<span class="badge' + (count === 0 ? " zero" : "") + '" data-kind="' + kind + '">' +
         count + " " + label + "</span>";
}

function accordion(label, rows, badges) {
  const el = document.createElement("details");
  el.className = "group";
  el.open = openGroups.has(label);
  el.ontoggle = () => { el.open ? openGroups.add(label) : openGroups.delete(label); };

  // The file name first, because that is what you recognise; the full path under
  // it, because two files can share a name.
  const slash = label.lastIndexOf("/");
  const name = slash === -1 ? label : label.slice(slash + 1);
  const where = slash === -1 ? "no pertenecen a ningún archivo" : label;

  const head = document.createElement("summary");
  head.innerHTML =
    '<div class="head">' +
      '<div class="name">' + esc(name) + '</div>' +
      '<div class="path">' + esc(where) + '</div>' +
      '<div class="badges">' + badges + '</div>' +
    '</div>';

  el.appendChild(head);
  for (const row of rows) el.appendChild(row);
  return el;
}

function draftCounts(comments) {
  const c = { pending:0, valid:0, discarded:0, rework:0 };
  for (const x of comments) c[x.status]++;
  return badge(c.pending, "sin revisar", "pending") + badge(c.valid, "válidos", "valid") +
         badge(c.discarded, "descartados", "discarded") + badge(c.rework, "para otra vuelta", "rework");
}

function fixCounts(fixes) {
  const c = { pending:0, done:0, skipped:0 };
  for (const x of fixes) c[x.status]++;
  return badge(c.done, "resueltos", "done") + badge(c.skipped, "omitidos", "skipped") +
         badge(c.pending, "pendientes", "pending");
}

/** Groups by file, keeping the order in which they arrived. */
function groupByFile(items) {
  const groups = new Map();

  for (const item of items) {
    // What belongs to no file forms a group of its own.
    const key = item.path || "Comentarios del PR";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  return groups;
}

function card(comment) {
  const el = document.createElement("div");
  el.className = "card " + comment.status;
  el.dataset.sev = comment.severity;

  const where = comment.scope === "pr" ? "todo el PR"
    : comment.line ? "L" + comment.line + (comment.endLine && comment.endLine !== comment.line ? "-" + comment.endLine : "")
    : "archivo completo";

  el.innerHTML =
    '<div class="meta"><span class="sev" data-sev="' + comment.severity + '">' +
    (SEV[comment.severity] || comment.severity) + '</span>' +
    '<span class="tag">' + where + '</span>' +
    (comment.edited ? '<span class="tag">editado</span>' : '') + '</div>' +
    '<div class="body"><strong>' + comment.title.replace(/</g,"&lt;") + '</strong>' +
    renderMarkdown(comment.body) + '</div>';

  // What the server has, unless there is something typed over it.
  const state = stateOf(comment.id);

  const editor = document.createElement("textarea");
  editor.className = state.editing ? "" : "hidden";
  editor.value = state.body !== undefined ? state.body : comment.body;
  editor.oninput = () => { state.body = editor.value; };

  const actions = document.createElement("div");
  actions.className = "actions";

  for (const [act, label] of [["valid","Válido"],["rework","Otra vuelta"],["discarded","Descartar"]]) {
    const b = document.createElement("button");
    b.dataset.act = act; b.textContent = label;
    if (comment.status === act) b.classList.add("on");
    b.onclick = () => save(comment.id, { status: comment.status === act ? "pending" : act });
    actions.appendChild(b);
  }

  const edit = document.createElement("button");
  edit.textContent = state.editing ? "Guardar" : "Editar";
  edit.onclick = () => {
    if (!state.editing) {
      state.editing = true;
      editor.classList.remove("hidden");
      edit.textContent = "Guardar";
      editor.focus();
      return;
    }

    const body = editor.value;

    // Stored: what is on the server from here on is the good copy.
    state.editing = false;
    state.body = undefined;
    // Returned like every other handler here, so the caller can wait for it.
    return save(comment.id, { body: body });
  };
  actions.appendChild(edit);

  el.appendChild(editor);
  el.appendChild(actions);
  return el;
}

function fixRow(fix) {
  const el = document.createElement("div");
  el.className = "fix " + fix.status;
  el.dataset.sev = fix.severity;

  const mark = document.createElement("button");
  mark.className = "mark" + (fix.status === "done" ? " on" : "");
  mark.dataset.act = "valid";
  mark.textContent = fix.status === "done" ? "✓" : fix.status === "skipped" ? "–" : "";
  mark.title = "Marcar como resuelto";
  mark.onclick = () => saveFix(fix.id, { status: fix.status === "done" ? "pending" : "done" });

  const text = document.createElement("div");
  text.innerHTML =
    '<div class="fixtitle"><strong>' + fix.title.replace(/</g,"&lt;") + '</strong></div>' +
    '<div class="where">' + (fix.path ? fix.path + (fix.line ? " L" + fix.line : "") : "todo el PR") + '</div>' +
    (fix.note ? '<div class="fixnote">' + fix.note.replace(/</g,"&lt;") + '</div>' : '');

  const skip = document.createElement("button");
  skip.textContent = "Omitir";
  skip.onclick = () => saveFix(fix.id, { status: fix.status === "skipped" ? "pending" : "skipped" });

  el.appendChild(mark);
  el.appendChild(text);
  el.appendChild(skip);
  return el;
}

async function saveFix(id, payload) {
  await post("fix/" + id, payload);
  await load();
}

async function load() {
  const draft = await (await fetch("/r/" + REVIEW + "/data")).json();
  const list = document.getElementById("list");
  list.innerHTML = "";

  // Once the comments become work to do, the page turns into that list.
  if (draft.fixes) {
    const done = draft.fixes.filter(f => f.status === "done").length;
    const skipped = draft.fixes.filter(f => f.status === "skipped").length;
    document.getElementById("summary").textContent =
      done + " resueltos · " + skipped + " omitidos · " + (draft.fixes.length - done - skipped) + " pendientes";
    document.querySelector(".confirm").classList.add("hidden");

    for (const [file, fixes] of groupByFile(draft.fixes)) {
      list.appendChild(accordion(file, fixes.map(fixRow), fixCounts(fixes)));
    }
    return;
  }

  if (draft.comments.length === 0) {
    list.innerHTML = '<p class="empty">La revisión no generó ningún comentario.</p>';
  }

  for (const [file, comments] of groupByFile(draft.comments)) {
    list.appendChild(accordion(file, comments.map(card), draftCounts(comments)));
  }

  const c = { pending:0, valid:0, discarded:0, rework:0 };
  for (const comment of draft.comments) c[comment.status]++;
  document.getElementById("summary").textContent =
    c.pending + " sin revisar · " + c.valid + " válidos · " + c.discarded + " descartados · " + c.rework + " para otra vuelta";
  document.getElementById("confirmed").classList.toggle("hidden", !draft.confirmed);
}

document.getElementById("confirm").onclick = async () => {
  await fetch("/r/" + REVIEW + "/confirm", {
    method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ confirmed: true }),
  });
  await load();
};

load();
</script>
</body></html>`;
}
