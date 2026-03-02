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

type SectionId = "meta" | "passport" | "deal" | "pilot" | "product";
type Tone = "ok" | "warn" | "risk";
type AtomicStatus = "present" | "missing" | "not_discussed" | "uncertain";
type AtomicConfidence = "high" | "medium" | "low";

type SectionDescriptor = {
  id: SectionId;
  title: string;
  keys: string[];
  emptyLabel: string;
};

const SECTIONS: SectionDescriptor[] = [
  { id: "meta", title: "Метаданные", keys: ["meta"], emptyLabel: "⚠️ не указано" },
  { id: "passport", title: "Паспорт сделки", keys: ["passport"], emptyLabel: "⚠️ не указано" },
  { id: "deal", title: "Коммерческий трек", keys: ["deal_track", "deal"], emptyLabel: "не зафиксировано" },
  { id: "pilot", title: "Пилотирование", keys: ["pilot_poc", "pilot"], emptyLabel: "не зафиксировано" },
  { id: "product", title: "Продуктовый трек", keys: ["product_track", "product"], emptyLabel: "не зафиксировано" },
];

const SECTION_BY_ID: Record<SectionId, SectionDescriptor> = {
  meta: SECTIONS[0],
  passport: SECTIONS[1],
  deal: SECTIONS[2],
  pilot: SECTIONS[3],
  product: SECTIONS[4],
};

const STATUS_SET = new Set<AtomicStatus>(["present", "missing", "not_discussed", "uncertain"]);
const CONFIDENCE_SET = new Set<AtomicConfidence>(["high", "medium", "low"]);

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
  --bg:#f4f6fb; --text:#1f2937; --muted:#5b6475; --muted2:#6f7b8f;
  --line:#dde3ee; --shadow:0 10px 26px rgba(20, 36, 72, .08); --radius:18px;
  --ok-bg:#eaf8ef; --ok:#186a3b;
  --warn-bg:#fff6e8; --warn:#8b5d10;
  --risk-bg:#fcebec; --risk:#9b1c1c;
  --accent:#2a67f5; --accent2:#4f7df0;
  --mono:"JetBrains Mono","SFMono-Regular",Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;
  --sans:"IBM Plex Sans","Segoe UI","Helvetica Neue",Arial,sans-serif;
}
*{ box-sizing:border-box; }
html,body{ height:100%; }
body{
  margin:0; font-family:var(--sans); color:var(--text); line-height:1.55; letter-spacing:.2px;
  background:radial-gradient(circle at top right, #ffffff 0, #f6f8fe 30%, #f0f3fa 100%);
}
a{ color:var(--accent); text-decoration:none; } a:hover{ text-decoration:underline; }
.wrap{ max-width:1100px; margin:0 auto; padding:28px 18px 64px; }
header{ display:grid; gap:14px; padding:18px 18px 0; }
.topbar{ display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.title{ display:flex; gap:12px; align-items:baseline; flex-wrap:wrap; }
h1{ margin:0; font-size:clamp(22px,2.3vw,32px); letter-spacing:.2px; }
.subtitle{ color:var(--muted); font-size:14px; }
.card{
  background:var(--bg);
  border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); overflow:hidden;
}
.pad{ padding:16px; }
.toc{ display:flex; gap:10px; flex-wrap:wrap; padding:10px 18px 18px; }
.pill{
  display:inline-flex; align-items:center; gap:8px; padding:8px 10px; border-radius:999px;
  border:1px solid var(--line); background:#ffffff; font-size:13px; color:var(--text);
}
.dot{ width:8px; height:8px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 4px rgba(42,103,245,.14); }
main{ display:grid; gap:14px; margin-top:14px; }
section{ scroll-margin-top:90px; }
.section-h{
  display:flex; align-items:flex-end; justify-content:space-between; gap:12px; padding:16px 16px 12px;
  border-bottom:1px solid var(--line); background:#f9fafc;
}
.section-h h2{ margin:0; font-size:18px; }
.section-h .meta{ color:var(--muted2); font-size:13px; white-space:nowrap; }
.section-h--summary{ cursor:pointer; user-select:none; border-bottom:0; }
.section-h--summary:hover{ background:#f3f6fb; }
.section-h--summary .sum-left h2{ margin:0; }
.card > details{ border-top:0; background:transparent; }
.card > details[open] > .section-h--summary{ border-bottom:1px solid var(--line); }
.grid-2{ display:grid; gap:12px; grid-template-columns:repeat(2, minmax(0,1fr)); }
@media (max-width:860px){ .grid-2{ grid-template-columns:1fr; } }
.kv{ display:grid; gap:10px; }
.kv .row{
  display:grid; grid-template-columns:240px 1fr; gap:12px; padding:10px 12px;
  border:1px solid var(--line); border-radius:14px; background:#f9fafc;
}
@media (max-width:650px){ .kv .row{ grid-template-columns:1fr; } }
.k{ color:var(--muted2); font-size:13px; }
.v{ color:var(--text); font-size:14px; }
.muted{ color:var(--muted); }
.mono{ font-family:var(--mono); font-size:13px; color:var(--muted); }
details{ border-top:1px solid var(--line); background:#fbfcff; }
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
  border:1px solid var(--line); font-size:12px; color:var(--muted); background:#f5f7fb; white-space:nowrap;
}
.badge.ok{ background:var(--ok-bg); color:var(--ok); border-color:rgba(46,204,113,.25); }
.badge.warn{ background:var(--warn-bg); color:var(--warn); border-color:rgba(241,196,15,.25); }
.badge.risk{ background:var(--risk-bg); color:var(--risk); border-color:rgba(231,76,60,.25); }
.content{ padding:0 16px 16px; display:grid; gap:12px; }
.split{ display:grid; gap:12px; grid-template-columns:1fr 1fr; }
@media (max-width:860px){ .split{ grid-template-columns:1fr; } }
.box{ border:1px solid var(--line); border-radius:16px; background:#ffffff; padding:12px; }
.box h4{ margin:0 0 8px 0; font-size:13px; letter-spacing:.2px; }
.box.ok h4{ color:var(--ok); } .box.warn h4{ color:var(--warn); } .box.risk h4{ color:var(--risk); }
ul{ margin:0; padding-left:18px; } li{ margin:6px 0; }
.chips{ display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
.chip{ font-size:12px; padding:6px 10px; border-radius:999px; border:1px solid var(--line); background:#f7f9fd; color:var(--muted); }
.cards-3{ display:grid; gap:12px; grid-template-columns:repeat(3, minmax(0,1fr)); }
@media (max-width:980px){ .cards-3{ grid-template-columns:1fr; } }
.mini{ border:1px solid var(--line); border-radius:18px; background:#ffffff; padding:14px; }
.mini h3{ margin:0 0 8px 0; font-size:14px; }
.mini p{ margin:0; color:var(--muted); font-size:13px; }
.callout{ border:1px dashed #c8d2e3; background:#f9fafc; border-radius:16px; padding:12px; color:var(--muted); font-size:13px; }
footer{ margin-top:18px; color:var(--muted2); font-size:12px; padding:0 6px; text-align:center; }
@media print{
  body{ background:white; color:#111; } .card{ box-shadow:none; }
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
      </div>
      <nav class="toc">
        <a class="pill" href="#meta"><span class="dot"></span> Метаданные</a>
        <a class="pill" href="#passport"><span class="dot"></span> Паспорт сделки</a>
        <a class="pill" href="#deal"><span class="dot"></span> Коммерческий трек</a>
        <a class="pill" href="#pilot"><span class="dot"></span> Пилотирование</a>
        <a class="pill" href="#product"><span class="dot"></span> Продуктовый трек</a>
      </nav>
    </header>

    <main>
      ${renderedSections}
      ${extraSection}

      <footer>
        Перевёрстано как standalone-отчёт: отдельная страница без overlay.
      </footer>
    </main>
  </div>

</body>
</html>`;
}

function renderSectionCard(
  section: SectionDescriptor,
  value: unknown,
  input: { schemaVersion: string; meta?: RenderReportDocumentInput["meta"] },
): string {
  const sectionMeta = buildSectionMeta(section.id, value, input);
  const body = renderSectionBodyKnown(section.id, value, input.schemaVersion);
  const collapsedByDefault = isSectionCollapsedByDefault(section.id);

  if (collapsedByDefault) {
    return `
      <section class="card" id="${section.id}">
        <details>
          <summary class="section-h section-h--summary">
            <div class="sum-left"><span class="chev"></span><h2>${escapeHtml(section.title)}</h2></div>
            <div class="meta">${escapeHtml(sectionMeta)}</div>
          </summary>
          <div class="pad">${body}</div>
        </details>
      </section>
    `;
  }

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

function renderSectionBodyKnown(sectionId: SectionId, value: unknown, schemaVersion: string): string {
  switch (sectionId) {
    case "meta":
      return renderMetaSection(value, schemaVersion);
    case "passport":
      return renderPassportSection(value);
    case "deal":
      return renderDealTrackSection(value);
    case "pilot":
      return renderPilotSection(value);
    case "product":
      return renderProductSection(value);
    default:
      return renderSectionBody(SECTION_BY_ID[sectionId], value);
  }
}

function renderMetaSection(value: unknown, schemaVersion: string): string {
  const record = toRecord(value);
  if (!record) {
    return renderSectionBody(SECTION_BY_ID.meta, value);
  }

  const meetingType = toRecord(record.meeting_type);
  const primary = toRecord(meetingType?.primary);
  const secondary = asArray(meetingType?.secondary)
    .map((entry) => toRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const signals = asArray(meetingType?.signals)
    .map((entry) => toRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => firstString(entry, ["text"]))
    .filter((entry) => entry !== "");

  const primaryLabel = primary ? firstString(primary, ["label"]) : "";
  const primaryConfidence = primary ? firstString(primary, ["confidence"]) : "";
  const secondaryLabels = secondary
    .map((entry) => {
      const label = firstString(entry, ["label"]);
      const confidence = firstString(entry, ["confidence"]);
      if (label && confidence) {
        return `${label} (${confidence})`;
      }
      return label;
    })
    .filter((entry) => entry !== "");

  const meetingTypeHtml = primaryLabel
    ? `${escapeHtml(primaryLabel)}${
      primaryConfidence ? ` <span class="muted">(confidence: ${escapeHtml(primaryConfidence)})</span>` : ""
    }${secondaryLabels.length > 0 ? `<div class="muted">secondary: ${escapeHtml(secondaryLabels.join(", "))}</div>` : ""}`
    : `<span class='muted'>не указано</span>`;

  const focusWeights = toRecord(record.focus_weights);
  const focusEntries = focusWeights
    ? Object.entries(focusWeights).filter(([, item]) => typeof item === "number" && Number.isFinite(item))
    : [];
  const focusHtml = focusEntries.length > 0
    ? `<div class="chips">${focusEntries
      .map(([key, item]) => `<span class="chip">${escapeHtml(key)}: ${escapeHtml(formatWeight(item as number))}</span>`)
      .join("")}</div>`
    : `<span class='muted'>не указано</span>`;

  const source = toRecord(record.source);
  const sourceChunks = source
    ? [
      ["transcript_id", source.transcript_id],
      ["format", source.transcript_format],
      ["language", source.language],
    ]
      .map(([label, item]) => `${escapeHtml(String(label))}: <span class="mono">${escapeHtml(toInlineText(item))}</span>`)
      .join(", ")
    : "";
  const sourceHtml = sourceChunks || `<span class='muted'>не указано</span>`;

  const extra = renderUnknownFields(record, new Set(["schema_version", "source", "meeting_type", "focus_weights"]));

  return `
    <div class="grid-2">
      <div class="kv">
        ${renderRow("Тип встречи", meetingTypeHtml)}
        ${renderRow("Signals", signals.length > 0 ? renderStringList(signals) : `<span class='muted'>не указано</span>`)}
      </div>
      <div class="kv">
        ${renderRow("Focus weights", focusHtml)}
        ${renderRow("Source", sourceHtml)}
        ${renderRow("Schema", `<span class="mono">${escapeHtml(schemaVersion)}</span>`)}
      </div>
    </div>
    ${extra}
  `;
}

function renderPassportSection(value: unknown): string {
  const record = toRecord(value);
  if (!record) {
    return renderSectionBody(SECTION_BY_ID.passport, value);
  }

  const company = toRecord(record.company);
  const offering = toRecord(record.offering);
  const stage = toRecord(record.stage);

  const stageValue = extractAtomicValue(stage);
  const stageConfidence = extractAtomicConfidence(stage);
  const stageMode = firstString(stage, ["mode"]);
  const stageHtml = stageValue
    ? `<strong>${escapeHtml(stageValue)}</strong>${
      stageConfidence || stageMode
        ? ` <span class="muted">(${escapeHtml([
          stageConfidence ? `confidence: ${stageConfidence}` : "",
          stageMode,
        ].filter((part) => part !== "").join(" • "))})</span>`
        : ""
    }`
    : `<span class='muted'>⚠️ не указано</span>`;

  const extra = renderUnknownFields(record, new Set(["company", "offering", "stage"]));

  return `
    <div class="grid-2">
      <div class="kv">
        ${renderRow("Компания", renderAtomicValue(company?.name, "⚠️ не указана"))}
        ${renderRow("Группа", renderAtomicValue(company?.group))}
        ${renderRow("Индустрия", renderAtomicValue(company?.industry))}
        ${renderRow("Контакты", renderContactsList(company?.contacts))}
      </div>
      <div class="kv">
        ${renderRow("Тема", renderAtomicValue(offering?.primary_theme))}
        ${renderRow("Solution candidates", renderAtomicArrayList(offering?.solution_candidates))}
        ${renderRow("Stage", stageHtml)}
      </div>
    </div>
    ${extra}
  `;
}

function renderDealTrackSection(value: unknown): string {
  const record = toRecord(value);
  if (!record) {
    return renderSectionBody(SECTION_BY_ID.deal, value);
  }

  const parts: string[] = [];

  const problemImpact = toRecord(record.problem_impact);
  parts.push(
    renderSemanticDisclosure({
      title: "Потребности клиента",
      open: true,
      badges: buildItemsMissingBadges(problemImpact),
      content: renderItemsAndMissingSplit(problemImpact, {
        itemsTitle: "✅ Что болит",
        missingTitle: "⚠️ Не зафиксировано",
        itemsTone: "ok",
        missingTone: "warn",
      }),
    }),
  );

  const valueHypothesis = toRecord(record.value_hypothesis);
  const hypotheses = extractAtomicArray(valueHypothesis?.items);
  const alternatives = extractAtomicArray(valueHypothesis?.alternatives);
  parts.push(
    renderSemanticDisclosure({
      title: "Ценностное предложение",
      badges: [
        renderSummaryBadge("✅ hypothesis", hypotheses.length > 0 ? "ok" : "warn"),
        alternatives.length > 0 ? renderSummaryBadge("alternatives", "warn") : "",
      ].filter((badge) => badge !== ""),
      content: `
        <div class="split">
          <div class="box ok">
            <h4>✅ Гипотеза ценности</h4>
            ${renderAtomicArrayList(hypotheses)}
          </div>
          <div class="box">
            <h4>Альтернативы</h4>
            ${renderAtomicArrayList(alternatives)}
          </div>
        </div>
      `,
    }),
  );

  const decisionPeople = toRecord(record.decision_people);
  const roles = toRecord(decisionPeople?.roles);
  const process = extractAtomicArray(decisionPeople?.process);
  parts.push(
    renderSemanticDisclosure({
      title: "Принятие решений",
      badges: [renderSummaryBadge("⚠️ roles", "warn"), renderSummaryBadge("✅ process", "ok")],
      content: `
        <div class="split">
          <div class="box warn">
            <h4>⚠️ Roles</h4>
            <ul>
              <li>Decision maker: ${renderAtomicValueInline(roles?.decision_maker)}</li>
              <li>Champion: ${renderAtomicValueInline(roles?.champion)}</li>
              <li>Owner: ${renderAtomicValueInline(roles?.owner)}</li>
              <li>Blocker: ${renderAtomicValueInline(roles?.blocker)}</li>
            </ul>
          </div>
          <div class="box ok">
            <h4>✅ Процесс</h4>
            ${renderAtomicArrayList(process)}
          </div>
        </div>
      `,
    }),
  );

  const timing = toRecord(record.timing_trigger);
  const timingItems = extractAtomicArray(timing?.items);
  const cadence = toRecord(timing?.cadence);
  const cadenceChips = [
    ["next_contact", cadence?.next_contact],
    ["deliverable", cadence?.deliverable],
  ]
    .map(([label, item]) => {
      const atomicValue = extractAtomicValue(item);
      if (!atomicValue) {
        return "";
      }
      return `<span class="chip">${escapeHtml(String(label))}: ${escapeHtml(atomicValue)}</span>`;
    })
    .filter((chip) => chip !== "")
    .join("");

  parts.push(
    renderSemanticDisclosure({
      title: "Шаги и сроки",
      badges: [renderSummaryBadge("✅ trigger", "ok"), renderSummaryBadge("⚠️ dates", "warn")],
      content: `
        <div class="box ok">
          <h4>✅ Триггер/якорь</h4>
          ${renderAtomicArrayList(timingItems)}
          ${cadenceChips ? `<div class="chips">${cadenceChips}</div>` : ""}
        </div>
      `,
    }),
  );

  const money = toRecord(record.money_procurement);
  const budget = money?.budget;
  const unitEconomics = extractAtomicArray(money?.unit_economics);
  const procurement = extractAtomicArray(money?.procurement);
  const priceSensitivity = extractAtomicArray(money?.price_sensitivity);
  parts.push(
    renderSemanticDisclosure({
      title: "Бюджет и закупка",
      badges: [
        renderSummaryBadge(`budget: ${extractAtomicValue(budget) ?? "не указан"}`, atomicStatusToTone(extractAtomicStatus(budget))),
        renderSummaryBadge("✅ models", "ok"),
      ],
      content: `
        <div class="split">
          <div class="box ${atomicStatusToTone(extractAtomicStatus(budget)) || "warn"}">
            <h4>⚠️ Бюджет</h4>
            <ul><li>${renderAtomicValueInline(budget)}</li></ul>
          </div>
          <div class="box ok">
            <h4>✅ Тарификация/модель</h4>
            ${renderAtomicArrayList([...unitEconomics, ...procurement])}
            ${priceSensitivity.length > 0
              ? `<div class="callout" style="margin-top:12px;"><strong>Price sensitivity:</strong>${renderAtomicArrayList(priceSensitivity)}</div>`
              : ""}
          </div>
        </div>
      `,
    }),
  );

  const momentum = toRecord(record.momentum_next_step);
  const commitments = asArray(momentum?.commitments);
  const nextStep = toRecord(momentum?.next_step);
  parts.push(
    renderSemanticDisclosure({
      title: "Договоренности",
      badges: [renderSummaryBadge("✅ commitments", "ok"), renderSummaryBadge("⚠️ when", "warn")],
      content: `
        <div class="box ok">
          <h4>✅ Commitments</h4>
          ${renderCommitmentsList(commitments)}
        </div>
        <div class="split">
          <div class="box">
            <h4>Next — что</h4>
            <p style="margin:0">${renderAtomicValueInline(nextStep?.what)}</p>
          </div>
          <div class="box warn">
            <h4>⚠️ Next — когда</h4>
            <p style="margin:0">${renderAtomicValueInline(nextStep?.when)}</p>
          </div>
        </div>
        <div class="box ok">
          <h4>Goal</h4>
          <p style="margin:0">${renderAtomicValueInline(nextStep?.goal)}</p>
        </div>
      `,
    }),
  );

  const security = toRecord(record.security_compliance_data);
  parts.push(
    renderSemanticDisclosure({
      title: "Безопасность",
      badges: [
        renderSummaryBadge("security", dominantToneForAtomicArray(extractAtomicArray(security?.items))),
        renderSummaryBadge("⚠️ missing", "warn"),
      ],
      content: renderItemsAndMissingSplit(security, {
        itemsTitle: "🔒 Обсуждалось",
        missingTitle: "⚠️ Нужно уточнить",
        itemsTone: dominantToneForAtomicArray(extractAtomicArray(security?.items)) || "risk",
        missingTone: "warn",
      }),
    }),
  );

  parts.push(
    renderUnknownFields(record, new Set([
      "problem_impact",
      "value_hypothesis",
      "decision_people",
      "timing_trigger",
      "money_procurement",
      "momentum_next_step",
      "security_compliance_data",
    ])),
  );

  return parts.join("\n");
}

function renderPilotSection(value: unknown): string {
  const record = toRecord(value);
  if (!record) {
    return renderSectionBody(SECTION_BY_ID.pilot, value);
  }

  const owners = toRecord(record.owners);

  const extra = renderUnknownFields(record, new Set([
    "status",
    "goal",
    "scope",
    "inputs_from_client",
    "outputs_from_vendor",
    "success_criteria",
    "timeline_checkpoints",
    "owners",
  ]));

  return `
    <div class="grid-2">
      <div class="kv">
        ${renderRow("Цель", renderAtomicValue(record.goal))}
        ${renderRow("Scope", renderAtomicArrayList(extractAtomicArray(record.scope)))}
        ${renderRow("Timeline", renderAtomicArrayList(extractAtomicArray(record.timeline_checkpoints)))}
      </div>
      <div class="kv">
        ${renderRow("Inputs", renderAtomicArrayList(extractAtomicArray(record.inputs_from_client)))}
        ${renderRow("Outputs", renderAtomicArrayList(extractAtomicArray(record.outputs_from_vendor)))}
        ${renderRow("Success criteria", renderAtomicArrayList(extractAtomicArray(record.success_criteria)))}
      </div>
    </div>
    <div style="height:12px"></div>
    <div class="cards-3">
      ${renderMiniCard("Owner (client)", renderAtomicValueInline(owners?.client_owner))}
      ${renderMiniCard("Owner (vendor)", renderAtomicValueInline(owners?.vendor_owner))}
      ${renderMiniCard("Статус", renderAtomicValueInline(record.status))}
    </div>
    ${extra}
  `;
}

function renderProductSection(value: unknown): string {
  const record = toRecord(value);
  if (!record) {
    return renderSectionBody(SECTION_BY_ID.product, value);
  }

  const requirements = toRecord(record.requirements);

  const extra = renderUnknownFields(record, new Set([
    "use_case",
    "requirements",
    "constraints",
    "implementation",
    "success_criteria",
    "open_questions_risks",
  ]));

  return `
    <div style="display:grid; gap:12px;">
      <div class="mini">
        <h3>Юзкейсы</h3>
        ${renderAtomicArrayList(extractAtomicArray(record.use_case))}
      </div>

      <div class="mini">
        <h3>Требования</h3>
        <div class="split">
          <div class="box">
            <h4>Функциональные</h4>
            ${renderAtomicArrayList(extractAtomicArray(requirements?.functional))}
          </div>
          <div class="box">
            <h4>Нефункциональные</h4>
            ${renderAtomicArrayList(extractAtomicArray(requirements?.non_functional))}
          </div>
        </div>
        <div class="box" style="margin-top:12px;">
          <h4>Данные и интеграцияя</h4>
          ${renderAtomicArrayList(extractAtomicArray(requirements?.data_integrations))}
        </div>
      </div>

      <div class="mini"><h3>Ограничители</h3>${renderAtomicArrayList(extractAtomicArray(record.constraints))}</div>
      <div class="mini"><h3>Имплементация</h3>${renderAtomicArrayList(extractAtomicArray(record.implementation))}</div>
      <div class="mini"><h3>Критерии успеха</h3>${renderAtomicArrayList(extractAtomicArray(record.success_criteria))}</div>
      <div class="mini"><h3>Открытые вопросы / риски</h3>${renderAtomicArrayList(extractAtomicArray(record.open_questions_risks))}</div>
    </div>
    ${extra}
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
  const badges = deriveDisclosureBadges(value);
  const badgesHtml = badges.length > 0 ? badges.join("") : "";

  return `
    <details${options?.open ? " open" : ""}>
      <summary>
        <div class="sum-left"><span class="chev"></span><span class="sum-title">${escapeHtml(title)}</span></div>
        <div class="sum-badges">${badgesHtml}</div>
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

  if (isAtomicField(value)) {
    return `<div class="box ${atomicStatusToTone(extractAtomicStatus(value)) || ""}"><h4>Значение</h4><p style="margin:0">${renderAtomicValueInline(value)}</p></div>`;
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

  const scalarEntries = Object.entries(objectValue).filter(([, entry]) => isScalar(entry) || isAtomicField(entry));
  const nestedEntries = Object.entries(objectValue).filter(([, entry]) => !(isScalar(entry) || isAtomicField(entry)));

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
  if (isAtomicField(value)) {
    return renderAtomicValueInline(value);
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
      if (isAtomicField(item)) {
        return `<li>${renderAtomicValueInline(item)}</li>`;
      }
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
  id: SectionId,
  value: unknown,
  input: { schemaVersion: string; meta?: RenderReportDocumentInput["meta"] },
): string {
  if (id === "meta") {
    return `schema ${input.schemaVersion}`;
  }

  const objectValue = toRecord(value);
  if (id === "passport" && objectValue) {
    const stageValue = extractAtomicValue(objectValue.stage);
    const stageMode = firstString(toRecord(objectValue.stage), ["mode"]);
    if (stageValue && stageMode) {
      return `stage: ${stageValue} (${stageMode})`;
    }
    if (stageValue) {
      return `stage: ${stageValue}`;
    }
  }

  if (id === "pilot" && objectValue) {
    const statusValue = extractAtomicValue(objectValue.status);
    if (statusValue) {
      return `status: ${statusValue}`;
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

function firstString(record: Record<string, unknown> | null | undefined, keys: string[]): string {
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

function resolveTone(value: unknown): Tone | "" {
  if (isAtomicField(value)) {
    return atomicStatusToTone(extractAtomicStatus(value));
  }

  const fromObject = toRecord(value);
  if (fromObject && typeof fromObject.status === "string") {
    return atomicStatusToTone(normalizeAtomicStatus(fromObject.status));
  }

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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isAtomicField(value: unknown): value is Record<string, unknown> {
  const record = toRecord(value);
  if (!record) {
    return false;
  }

  if (!("value" in record)) {
    return false;
  }

  const status = normalizeAtomicStatus(record.status);
  const confidence = normalizeAtomicConfidence(record.confidence);
  return status !== null && confidence !== null;
}

function extractAtomicValue(value: unknown): string | null {
  if (isAtomicField(value)) {
    const raw = value.value;
    if (raw === null || raw === undefined) {
      return null;
    }
    const normalized = String(raw).trim();
    return normalized === "" ? null : normalized;
  }

  if (isScalar(value)) {
    const normalized = toInlineText(value);
    return normalized === "не указано" ? null : normalized;
  }

  const record = toRecord(value);
  if (!record) {
    return null;
  }

  if (isScalar(record.value)) {
    const normalized = toInlineText(record.value);
    return normalized === "не указано" ? null : normalized;
  }

  return null;
}

function extractAtomicStatus(value: unknown): AtomicStatus | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  return normalizeAtomicStatus(record.status);
}

function extractAtomicConfidence(value: unknown): AtomicConfidence | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  return normalizeAtomicConfidence(record.confidence);
}

function normalizeAtomicStatus(value: unknown): AtomicStatus | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase() as AtomicStatus;
  return STATUS_SET.has(normalized) ? normalized : null;
}

function normalizeAtomicConfidence(value: unknown): AtomicConfidence | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase() as AtomicConfidence;
  return CONFIDENCE_SET.has(normalized) ? normalized : null;
}

function atomicStatusToTone(status: AtomicStatus | null): Tone | "" {
  if (!status) {
    return "";
  }
  if (status === "present") {
    return "ok";
  }
  if (status === "uncertain" || status === "not_discussed") {
    return "warn";
  }
  return "risk";
}

function dominantToneForAtomicArray(values: unknown[]): Tone | "" {
  const tones = values
    .map((value) => atomicStatusToTone(extractAtomicStatus(value)))
    .filter((tone): tone is Tone => tone === "ok" || tone === "warn" || tone === "risk");

  if (tones.includes("risk")) {
    return "risk";
  }
  if (tones.includes("warn")) {
    return "warn";
  }
  if (tones.includes("ok")) {
    return "ok";
  }
  return "";
}

function extractAtomicArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  const record = toRecord(value);
  if (!record) {
    return [];
  }

  return Array.isArray(record.items) ? record.items : [];
}

function renderAtomicValue(value: unknown, emptyLabel = "не указано"): string {
  const atomicValue = extractAtomicValue(value);
  return atomicValue ? escapeHtml(atomicValue) : `<span class='muted'>${escapeHtml(emptyLabel)}</span>`;
}

function renderAtomicValueInline(value: unknown): string {
  const atomicValue = extractAtomicValue(value);
  if (!atomicValue) {
    return `<span class='muted'>не указано</span>`;
  }

  const details: string[] = [];
  const status = extractAtomicStatus(value);
  const confidence = extractAtomicConfidence(value);

  if (status) {
    details.push(`status: ${status}`);
  }
  if (confidence) {
    details.push(`confidence: ${confidence}`);
  }

  return `${escapeHtml(atomicValue)}${
    details.length > 0 ? ` <span class="muted">(${escapeHtml(details.join(" • "))})</span>` : ""
  }`;
}

function renderAtomicArrayList(value: unknown): string {
  const items = Array.isArray(value) ? value : extractAtomicArray(value);
  if (items.length === 0) {
    return `<span class='muted'>не указано</span>`;
  }

  return `<ul>${items.map((item) => `<li>${renderAtomicListItem(item)}</li>`).join("")}</ul>`;
}

function renderAtomicListItem(value: unknown): string {
  if (isAtomicField(value)) {
    return renderAtomicValueInline(value);
  }

  if (isScalar(value)) {
    return renderText(value);
  }

  const record = toRecord(value);
  if (record) {
    if (typeof record.text === "string") {
      return renderText(record.text);
    }
    if (isScalar(record.value)) {
      return renderText(record.value);
    }
  }

  return `<span class="mono">${escapeHtml(stringify(value))}</span>`;
}

function renderStringList(items: string[]): string {
  if (items.length === 0) {
    return `<span class='muted'>не указано</span>`;
  }
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderContactsList(value: unknown): string {
  const contacts = asArray(value)
    .map((item) => toRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  if (contacts.length === 0) {
    return `<span class='muted'>не указано</span>`;
  }

  return `<ul>${contacts
    .map((contact) => {
      const person = extractAtomicValue(contact.person) ?? "не указано";
      const role = extractAtomicValue(contact.role) ?? "не указано";
      return `<li><strong>${escapeHtml(person)}</strong> — ${escapeHtml(role)}</li>`;
    })
    .join("")}</ul>`;
}

function renderCommitmentsList(value: unknown[]): string {
  const commitments = value
    .map((entry) => toRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));

  if (commitments.length === 0) {
    return `<span class='muted'>не указано</span>`;
  }

  return `<ul>${commitments
    .map((entry) => {
      const actor = extractAtomicValue(entry.actor) ?? "unknown";
      const action = extractAtomicValue(entry.action) ?? "не указано";
      const when = extractAtomicValue(entry.when) ?? "не указано";
      return `<li><span class='mono'>${escapeHtml(actor)}</span>: ${escapeHtml(action)} <span class='muted'>(когда: ${escapeHtml(when)})</span></li>`;
    })
    .join("")}</ul>`;
}

function isItemsAndMissingQuestions(value: unknown): value is { items: unknown[]; missing_questions: unknown[] } {
  const record = toRecord(value);
  if (!record) {
    return false;
  }
  return Array.isArray(record.items) && Array.isArray(record.missing_questions);
}

function renderItemsAndMissingSplit(
  value: unknown,
  options: {
    itemsTitle: string;
    missingTitle: string;
    itemsTone: Tone;
    missingTone: Tone;
  },
): string {
  if (!isItemsAndMissingQuestions(value)) {
    return `<div class="box">${renderMaybe(value)}</div>`;
  }

  return `
    <div class="split">
      <div class="box ${options.itemsTone}">
        <h4>${escapeHtml(options.itemsTitle)}</h4>
        ${renderAtomicArrayList(value.items)}
      </div>
      <div class="box ${options.missingTone}">
        <h4>${escapeHtml(options.missingTitle)}</h4>
        ${renderAtomicArrayList(value.missing_questions)}
      </div>
    </div>
  `;
}

function deriveDisclosureBadges(value: unknown): string[] {
  if (isItemsAndMissingQuestions(value)) {
    return buildItemsMissingBadges(value);
  }

  const tone = resolveTone(value);
  const listCount = Array.isArray(value) ? value.length : toRecord(value) ? Object.keys(toRecord(value) ?? {}).length : 0;
  const badges: string[] = [];

  if (listCount > 0) {
    badges.push(renderSummaryBadge(`items: ${listCount}`));
  }
  if (tone) {
    badges.push(renderSummaryBadge(tone, tone));
  }

  return badges;
}

function buildItemsMissingBadges(value: unknown): string[] {
  if (!isItemsAndMissingQuestions(value)) {
    return [];
  }

  const itemsCount = value.items.length;
  const missingCount = value.missing_questions.length;
  return [
    renderSummaryBadge(`✅ items: ${itemsCount}`, itemsCount > 0 ? "ok" : "warn"),
    renderSummaryBadge(`⚠️ missing: ${missingCount}`, missingCount > 0 ? "warn" : "ok"),
  ];
}

function renderSummaryBadge(label: string, tone?: Tone | ""): string {
  if (!tone) {
    return `<span class="badge">${escapeHtml(label)}</span>`;
  }
  return `<span class="badge ${tone}">${escapeHtml(label)}</span>`;
}

function renderSemanticDisclosure(input: {
  title: string;
  content: string;
  badges?: string[];
  open?: boolean;
}): string {
  const badgesHtml = (input.badges ?? []).join("");

  return `
    <details${input.open ? " open" : ""}>
      <summary>
        <div class="sum-left"><span class="chev"></span><span class="sum-title">${escapeHtml(input.title)}</span></div>
        <div class="sum-badges">${badgesHtml}</div>
      </summary>
      <div class="content">
        ${input.content}
      </div>
    </details>
  `;
}

function renderMiniCard(title: string, content: string): string {
  return `<div class="mini"><h3>${escapeHtml(title)}</h3><p>${content}</p></div>`;
}

function renderUnknownFields(record: Record<string, unknown>, knownKeys: Set<string>): string {
  const unknownEntries = Object.entries(record).filter(([key]) => !knownKeys.has(key));
  if (unknownEntries.length === 0) {
    return "";
  }

  return `
    <div style="margin-top:12px; display:grid; gap:8px;">
      ${unknownEntries.map(([key, value]) => renderDisclosure(`Дополнительно: ${humanizeKey(key)}`, value)).join("\n")}
    </div>
  `;
}

function isSectionCollapsedByDefault(sectionId: SectionId): boolean {
  return sectionId === "meta" || sectionId === "pilot";
}

function toInlineText(value: unknown): string {
  if (value === null || value === undefined) {
    return "не указано";
  }

  if (typeof value === "boolean") {
    return value ? "да" : "нет";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return "не указано";
    }
    return value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
  }

  const normalized = String(value).trim();
  return normalized === "" ? "не указано" : normalized;
}

function formatWeight(value: number): string {
  return value.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
