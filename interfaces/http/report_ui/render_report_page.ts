type RenderReportDocumentInput = {
  title: string;
  subtitle: string;
  report: unknown;
  meta?: {
    reportRef?: string;
    source?: string;
    generatedAt?: string;
  };
};

type SectionDescriptor = {
  id: "meta" | "passport" | "deal" | "pilot" | "product";
  title: string;
  keys: string[];
  emptyLabel: string;
};

const SECTIONS: SectionDescriptor[] = [
  { id: "meta", title: "Meta", keys: ["meta"], emptyLabel: "⚠️ не указано" },
  { id: "passport", title: "Паспорт", keys: ["passport"], emptyLabel: "⚠️ не указано" },
  { id: "deal", title: "Deal Track", keys: ["deal_track", "deal"], emptyLabel: "не зафиксировано" },
  { id: "pilot", title: "Pilot/PoC", keys: ["pilot_poc", "pilot"], emptyLabel: "не зафиксировано" },
  { id: "product", title: "Product Track", keys: ["product_track", "product"], emptyLabel: "не зафиксировано" },
];

export function renderReportDocument(input: RenderReportDocumentInput): string {
  const root = toRecord(input.report);
  const sectionValues = SECTIONS.map((section) => ({
    section,
    value: pickSection(root, section.keys),
  }));

  const metaObj = toRecord(sectionValues[0]?.value ?? null);
  const schemaVersion = firstString(metaObj, ["schema_version", "schema", "version"]) || "unknown";
  const meetingType = extractMeetingType(metaObj);
  const subtitleParts = [input.subtitle.trim(), meetingType].filter((part) => part !== "");

  const knownTopKeys = new Set(SECTIONS.flatMap((section) => section.keys));
  const extraBlocks = collectExtraBlocks(root, knownTopKeys);

  const renderedSections = sectionValues
    .map(({ section, value }) => renderSectionCard(section, value, { schemaVersion, meta: input.meta }))
    .join("\n");

  const extraSection = extraBlocks.length > 0
    ? `
      <section class="card" id="extra">
        <div class="section-h">
          <h2>Дополнительно</h2>
          <div class="meta">${escapeHtml(String(extraBlocks.length))} блок(а)</div>
        </div>
        <div class="pad">
          ${extraBlocks.map(([key, value]) => renderRawJsonDetails(`Raw JSON: ${humanizeKey(key)}`, value)).join("\n")}
        </div>
      </section>
    `
    : "";

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
  <meta name="description" content="Отчёт по созвону: паспорт сделки, deal track, пилот и продуктовый трек." />
  <style>
:root{
  --bg:#0b0f17; --text:#e9eef7; --muted:#b7c1d6; --muted2:#93a0bb;
  --line:rgba(255,255,255,.08); --shadow:0 10px 30px rgba(0,0,0,.35); --radius:18px;
  --ok-bg:rgba(46,204,113,.16); --ok:#baf3d0;
  --warn-bg:rgba(241,196,15,.16); --warn:#ffeaa7;
  --risk-bg:rgba(231,76,60,.16); --risk:#ffc3bd;
  --accent:#8ab4ff; --accent2:#a78bfa;
  --mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;
  --sans:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,"Helvetica Neue",Arial,"Noto Sans","Apple Color Emoji","Segoe UI Emoji";
}
*{ box-sizing:border-box; }
html,body{ height:100%; }
body{
  margin:0; font-family:var(--sans); color:var(--text); line-height:1.55; letter-spacing:.2px;
  background:
    radial-gradient(1200px 700px at 20% 0%, rgba(138,180,255,.16), transparent 55%),
    radial-gradient(900px 600px at 90% 10%, rgba(167,139,250,.12), transparent 55%),
    radial-gradient(900px 700px at 50% 120%, rgba(46,204,113,.08), transparent 60%),
    var(--bg);
}
a{ color:var(--accent); text-decoration:none; } a:hover{ text-decoration:underline; }
.wrap{ max-width:1100px; margin:0 auto; padding:28px 18px 64px; }
header{ display:grid; gap:14px; padding:18px 18px 0; }
.topbar{ display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.title{ display:flex; gap:12px; align-items:baseline; flex-wrap:wrap; }
h1{ margin:0; font-size:clamp(22px,2.3vw,32px); letter-spacing:.2px; }
.subtitle{ color:var(--muted); font-size:14px; }
.toolbar{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.btn{
  appearance:none; border:1px solid var(--line); background:rgba(255,255,255,.04); color:var(--text);
  padding:10px 12px; border-radius:12px; cursor:pointer; font-size:13px;
  transition:transform .06s ease, background .2s ease, border-color .2s ease;
}
.btn:hover{ background:rgba(255,255,255,.07); border-color:rgba(255,255,255,.14); }
.btn:active{ transform:translateY(1px); }
.btn .k{ font-family:var(--mono); font-size:12px; color:var(--muted2); margin-left:8px; }
.card{
  background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
  border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); overflow:hidden;
}
.pad{ padding:16px; }
.toc{ display:flex; gap:10px; flex-wrap:wrap; padding:10px 18px 18px; }
.pill{
  display:inline-flex; align-items:center; gap:8px; padding:8px 10px; border-radius:999px;
  border:1px solid var(--line); background:rgba(0,0,0,.12); font-size:13px; color:var(--text);
}
.dot{ width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 4px rgba(138,180,255,.12); }
main{ display:grid; gap:14px; margin-top:14px; }
section{ scroll-margin-top:90px; }
.section-h{
  display:flex; align-items:flex-end; justify-content:space-between; gap:12px; padding:16px 16px 12px;
  border-bottom:1px solid var(--line); background:rgba(0,0,0,.10);
}
.section-h h2{ margin:0; font-size:18px; }
.section-h .meta{ color:var(--muted2); font-size:13px; white-space:nowrap; }
.grid-2{ display:grid; gap:12px; grid-template-columns:repeat(2, minmax(0,1fr)); }
@media (max-width:860px){ .grid-2{ grid-template-columns:1fr; } }
.kv{ display:grid; gap:10px; }
.kv .row{
  display:grid; grid-template-columns:240px 1fr; gap:12px; padding:10px 12px;
  border:1px solid var(--line); border-radius:14px; background:rgba(0,0,0,.08);
}
@media (max-width:650px){ .kv .row{ grid-template-columns:1fr; } }
.k{ color:var(--muted2); font-size:13px; }
.v{ color:var(--text); font-size:14px; }
.muted{ color:var(--muted); }
.mono{ font-family:var(--mono); font-size:13px; color:var(--muted); }
details{ border-top:1px solid var(--line); background:rgba(0,0,0,.04); }
summary{
  list-style:none; cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:14px 16px; user-select:none; font-weight:650;
}
summary::-webkit-details-marker{ display:none; }
.sum-left{ display:flex; align-items:center; gap:10px; min-width:0; }
.chev{
  width:10px; height:10px; border-right:2px solid var(--muted2); border-bottom:2px solid var(--muted2);
  transform:rotate(-45deg); transition:transform .15s ease; flex:0 0 auto;
}
details[open] .chev{ transform:rotate(45deg); }
.sum-title{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sum-badges{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
.badge{
  display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px;
  border:1px solid var(--line); font-size:12px; color:var(--muted); background:rgba(0,0,0,.08); white-space:nowrap;
}
.badge.ok{ background:var(--ok-bg); color:var(--ok); border-color:rgba(46,204,113,.25); }
.badge.warn{ background:var(--warn-bg); color:var(--warn); border-color:rgba(241,196,15,.25); }
.badge.risk{ background:var(--risk-bg); color:var(--risk); border-color:rgba(231,76,60,.25); }
.content{ padding:0 16px 16px; display:grid; gap:12px; }
.split{ display:grid; gap:12px; grid-template-columns:1fr 1fr; }
@media (max-width:860px){ .split{ grid-template-columns:1fr; } }
.box{ border:1px solid var(--line); border-radius:16px; background:rgba(0,0,0,.08); padding:12px; }
.box h4{ margin:0 0 8px 0; font-size:13px; letter-spacing:.2px; }
.box.ok h4{ color:var(--ok); } .box.warn h4{ color:var(--warn); } .box.risk h4{ color:var(--risk); }
ul{ margin:0; padding-left:18px; } li{ margin:6px 0; }
.chips{ display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
.chip{ font-size:12px; padding:6px 10px; border-radius:999px; border:1px solid var(--line); background:rgba(255,255,255,.04); color:var(--muted); }
.callout{ border:1px dashed rgba(255,255,255,.18); background:rgba(255,255,255,.03); border-radius:16px; padding:12px; color:var(--muted); font-size:13px; }
footer{ margin-top:18px; color:var(--muted2); font-size:12px; padding:0 6px; text-align:center; }
@media print{
  body{ background:white; color:#111; } .btn{ display:none; } .card{ box-shadow:none; }
  .pill,.badge,.chip{ border-color:#ddd; } a{ color:#111; text-decoration:none; } .section-h{ background:transparent; }
}
</style>
</head>
<body>
  <div class="wrap">
    <header class="card" id="top">
      <div class="topbar pad">
        <div class="title">
          <h1>${escapeHtml(input.title)}</h1>
          <div class="subtitle">${escapeHtml(subtitleParts.join(" • "))}</div>
        </div>
        <div class="toolbar">
          <button class="btn" onclick="toggleAll(true)">Развернуть всё <span class="k">Alt+↓</span></button>
          <button class="btn" onclick="toggleAll(false)">Свернуть всё <span class="k">Alt+↑</span></button>
          <button class="btn" onclick="window.print()">Печать / PDF <span class="k">⌘/Ctrl+P</span></button>
        </div>
      </div>
      <nav class="toc">
        <a class="pill" href="#meta"><span class="dot"></span> Meta</a>
        <a class="pill" href="#passport"><span class="dot"></span> Паспорт</a>
        <a class="pill" href="#deal"><span class="dot"></span> Deal Track</a>
        <a class="pill" href="#pilot"><span class="dot"></span> Pilot/PoC</a>
        <a class="pill" href="#product"><span class="dot"></span> Product Track</a>
      </nav>
    </header>

    <main>
      ${renderedSections}
      ${extraSection}

      <footer>
        Перевёрстано как standalone-отчёт: отдельная страница без overlay. Горячие клавиши: <span class="mono">Alt+↓</span>/<span class="mono">Alt+↑</span>.
      </footer>
    </main>
  </div>

<script>
  function toggleAll(open){
    document.querySelectorAll('details').forEach((d) => { d.open = open; });
  }
  window.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); toggleAll(true); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); toggleAll(false); }
  });
</script>

</body>
</html>`;
}

function renderSectionCard(
  section: SectionDescriptor,
  value: unknown,
  input: { schemaVersion: string; meta?: RenderReportDocumentInput["meta"] },
): string {
  const sectionMeta = buildSectionMeta(section.id, value, input);
  const body = renderSectionBody(section, value);
  return `
    <section class="card" id="${section.id}">
      <div class="section-h">
        <h2>${escapeHtml(section.title)}</h2>
        <div class="meta">${escapeHtml(sectionMeta)}</div>
      </div>
      <div class="pad">${body}</div>
    </section>
  `;
}

function renderSectionBody(section: SectionDescriptor, value: unknown): string {
  if (isMissing(value)) {
    return `<div class="kv">${renderRow("Статус", `<span class='muted'>${escapeHtml(section.emptyLabel)}</span>`)}</div>`;
  }

  if (isScalar(value)) {
    return `<div class="kv">${renderRow("Значение", renderText(value))}</div>`;
  }

  if (Array.isArray(value)) {
    return `<div class="kv">${renderRow("Пункты", renderList(value))}</div>`;
  }

  const objectValue = toRecord(value);
  if (!objectValue) {
    return renderRawJsonDetails("Raw JSON", value);
  }

  const scalarEntries = Object.entries(objectValue).filter(([, entry]) => isScalar(entry));
  const nestedEntries = Object.entries(objectValue).filter(([, entry]) => !isScalar(entry));

  const kvHtml = scalarEntries.length > 0
    ? `<div class="kv">${scalarEntries
      .map(([key, entry]) => renderRow(humanizeKey(key), renderMaybe(entry)))
      .join("\n")}</div>`
    : `<div class="kv">${renderRow("Статус", `<span class='muted'>${escapeHtml(section.emptyLabel)}</span>`)}</div>`;

  const nestedHtml = nestedEntries
    .map(([key, entry], index) => renderDisclosure(humanizeKey(key), entry, { open: index === 0 }))
    .join("\n");

  return `${kvHtml}${nestedHtml}`;
}

function renderDisclosure(title: string, value: unknown, options?: { open?: boolean }): string {
  const tone = resolveTone(value);
  const listCount = Array.isArray(value) ? value.length : toRecord(value) ? Object.keys(toRecord(value) ?? {}).length : 0;
  const metaBadge = listCount > 0 ? `<span class="badge">items: ${escapeHtml(String(listCount))}</span>` : "";

  return `
    <details${options?.open ? " open" : ""}>
      <summary>
        <div class="sum-left"><span class="chev"></span><span class="sum-title">${escapeHtml(title)}</span></div>
        <div class="sum-badges">${metaBadge}${tone ? `<span class="badge ${tone}">${tone}</span>` : ""}</div>
      </summary>
      <div class="content">
        ${renderNestedValue(value)}
      </div>
    </details>
  `;
}

function renderNestedValue(value: unknown): string {
  if (isMissing(value)) {
    return `<div class="callout">⚠️ не указано</div>`;
  }

  if (isScalar(value)) {
    return `<div class="box"><h4>Значение</h4><p style="margin:0">${renderText(value)}</p></div>`;
  }

  if (Array.isArray(value)) {
    return `<div class="box"><h4>Список</h4>${renderList(value)}</div>`;
  }

  const objectValue = toRecord(value);
  if (!objectValue) {
    return renderRawJsonDetails("Raw JSON", value);
  }

  const scalarEntries = Object.entries(objectValue).filter(([, entry]) => isScalar(entry));
  const nestedEntries = Object.entries(objectValue).filter(([, entry]) => !isScalar(entry));

  const splitBoxes = scalarEntries.length > 0
    ? `<div class="split">
        <div class="box">
          <h4>Поля</h4>
          <div class="kv">${scalarEntries.map(([key, entry]) => renderRow(humanizeKey(key), renderMaybe(entry))).join("\n")}</div>
        </div>
        <div class="box">
          <h4>Сводка</h4>
          <p style="margin:0">${escapeHtml(`Всего полей: ${scalarEntries.length + nestedEntries.length}`)}</p>
        </div>
      </div>`
    : "";

  const nestedBlocks = nestedEntries
    .map(([key, entry], index) => renderDisclosure(humanizeKey(key), entry, { open: index === 0 && scalarEntries.length === 0 }))
    .join("\n");

  if (!splitBoxes && !nestedBlocks) {
    return renderRawJsonDetails("Raw JSON", value);
  }

  return `${splitBoxes}${nestedBlocks}`;
}

function renderRow(label: string, valueHtml: string): string {
  return `
    <div class="row">
      <div class="k">${escapeHtml(label)}</div>
      <div class="v">${valueHtml}</div>
    </div>
  `;
}

function renderMaybe(value: unknown): string {
  if (isMissing(value)) {
    return `<span class='muted'>не указано</span>`;
  }
  if (Array.isArray(value)) {
    return renderList(value);
  }
  if (toRecord(value)) {
    return renderRawJsonDetails("Raw JSON", value);
  }
  return renderText(value);
}

function renderText(value: unknown): string {
  if (value === null || value === undefined) {
    return `<span class='muted'>не указано</span>`;
  }
  if (typeof value === "boolean") {
    return value ? "да" : "нет";
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? escapeHtml(value.toLocaleString("ru-RU", { maximumFractionDigits: 3 }))
      : `<span class='muted'>не указано</span>`;
  }
  const normalized = String(value).trim();
  if (normalized === "") {
    return `<span class='muted'>не указано</span>`;
  }
  return escapeHtml(normalized);
}

function renderList(items: unknown[]): string {
  if (items.length === 0) {
    return `<span class='muted'>не указано</span>`;
  }

  const scalarOnly = items.every((item) => isScalar(item));
  if (scalarOnly && items.length <= 6) {
    return `<div class="chips">${items.map((item) => `<span class="chip">${renderText(item)}</span>`).join("")}</div>`;
  }

  return `<ul>${items
    .map((item, index) => {
      if (isScalar(item)) {
        return `<li>${renderText(item)}</li>`;
      }
      return `<li>${renderRawJsonDetails(`Пункт ${index + 1}`, item)}</li>`;
    })
    .join("")}</ul>`;
}

function renderRawJsonDetails(title: string, value: unknown): string {
  return `
    <details>
      <summary>
        <div class="sum-left"><span class="chev"></span><span class="sum-title">${escapeHtml(title)}</span></div>
        <div class="sum-badges"><span class="badge warn">collapsed</span></div>
      </summary>
      <div class="content">
        <div class="box"><h4>Raw JSON</h4><pre class="mono" style="margin:0;white-space:pre-wrap;overflow-wrap:anywhere;">${escapeHtml(stringify(value))}</pre></div>
      </div>
    </details>
  `;
}

function buildSectionMeta(
  id: SectionDescriptor["id"],
  value: unknown,
  input: { schemaVersion: string; meta?: RenderReportDocumentInput["meta"] },
): string {
  if (id === "meta") {
    return `schema ${input.schemaVersion}`;
  }

  const objectValue = toRecord(value);
  if (id === "passport" && objectValue) {
    const stage = readPathString(objectValue, [["stage", "value"], ["stage"], ["status", "value"]]);
    if (stage) {
      return `stage: ${stage}`;
    }
  }

  if (id === "pilot" && objectValue) {
    const status = readPathString(objectValue, [["status", "value"], ["status"]]);
    if (status) {
      return `status: ${status}`;
    }
  }

  if (Array.isArray(value)) {
    return `${value.length} items`;
  }
  if (objectValue) {
    return `${Object.keys(objectValue).length} fields`;
  }
  return input.meta?.reportRef ? `ref: ${input.meta.reportRef}` : "данные";
}

function extractMeetingType(metaObj: Record<string, unknown> | null): string {
  if (!metaObj) {
    return "";
  }

  const meetingType = toRecord(metaObj.meeting_type);
  if (!meetingType) {
    return "";
  }

  const primary = toRecord(meetingType.primary);
  if (!primary) {
    return "";
  }

  const label = typeof primary.label === "string" ? primary.label.trim() : "";
  const confidence = typeof primary.confidence === "string" ? primary.confidence.trim() : "";
  if (label && confidence) {
    return `Тип: ${label} • confidence: ${confidence}`;
  }
  if (label) {
    return `Тип: ${label}`;
  }
  return "";
}

function readPathString(record: Record<string, unknown>, paths: string[][]): string {
  for (const path of paths) {
    let cursor: unknown = record;
    for (const part of path) {
      const source = toRecord(cursor);
      if (!source || !(part in source)) {
        cursor = null;
        break;
      }
      cursor = source[part];
    }
    if (typeof cursor === "string" && cursor.trim() !== "") {
      return cursor.trim();
    }
  }
  return "";
}

function pickSection(root: Record<string, unknown> | null, keys: string[]): unknown {
  if (!root) {
    return null;
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(root, key)) {
      return root[key];
    }
  }
  return null;
}

function collectExtraBlocks(
  root: Record<string, unknown> | null,
  knownTopKeys: Set<string>,
): Array<[string, unknown]> {
  if (!root) {
    return [];
  }

  const extra: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(root)) {
    if (!knownTopKeys.has(key)) {
      extra.push([key, value]);
    }
  }
  return extra;
}

function firstString(record: Record<string, unknown> | null, keys: string[]): string {
  if (!record) {
    return "";
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return "";
}

function humanizeKey(key: string): string {
  const normalized = key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!normalized) {
    return "Поле";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function resolveTone(value: unknown): "ok" | "warn" | "risk" | "" {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().toLowerCase();
  if (["ok", "success", "succeeded", "present", "ready", "active", "low"].includes(normalized)) {
    return "ok";
  }
  if (["warn", "warning", "medium", "processing", "uncertain", "pending", "not_discussed"].includes(normalized)) {
    return "warn";
  }
  if (["risk", "error", "failed", "high", "missing", "blocked", "danger"].includes(normalized)) {
    return "risk";
  }
  return "";
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isScalar(value: unknown): boolean {
  return (
    value === null
    || value === undefined
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  );
}

function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  const objectValue = toRecord(value);
  return objectValue ? Object.keys(objectValue).length === 0 : false;
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
