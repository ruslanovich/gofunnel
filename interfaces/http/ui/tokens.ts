export const BASE_UI_CSS = String.raw`
:root {
  --gf-bg: #f4f6fb;
  --gf-surface: #ffffff;
  --gf-surface-muted: #f9fafc;
  --gf-text: #1f2937;
  --gf-text-muted: #5b6475;
  --gf-border: #dde3ee;
  --gf-border-strong: #c8d2e3;
  --gf-shadow: 0 10px 26px rgba(20, 36, 72, 0.08);
  --gf-primary: #2a67f5;
  --gf-primary-hover: #2358d1;
  --gf-primary-contrast: #ffffff;
  --gf-success-bg: #eaf8ef;
  --gf-success-text: #186a3b;
  --gf-warning-bg: #fff6e8;
  --gf-warning-text: #8b5d10;
  --gf-danger-bg: #fcebec;
  --gf-danger-text: #9b1c1c;
  --gf-radius-sm: 10px;
  --gf-radius-md: 14px;
  --gf-radius-lg: 18px;
  --gf-space-1: 4px;
  --gf-space-2: 8px;
  --gf-space-3: 12px;
  --gf-space-4: 16px;
  --gf-space-5: 20px;
  --gf-space-6: 24px;
  --gf-space-8: 32px;
  --gf-space-10: 40px;
  --gf-text-h1: 2rem;
  --gf-text-h2: 1.25rem;
  --gf-text-body: 1rem;
  --gf-text-caption: 0.875rem;
  --gf-btn-h-sm: 34px;
  --gf-btn-h-md: 40px;
  --gf-btn-h-lg: 46px;
  --gf-container: 1080px;
  --gf-container-narrow: 560px;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
}

body {
  font-family: "IBM Plex Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  font-size: var(--gf-text-body);
  color: var(--gf-text);
  background: radial-gradient(circle at top right, #ffffff 0, #f6f8fe 30%, #f0f3fa 100%);
  line-height: 1.5;
}

a {
  color: var(--gf-primary);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

pre,
code,
kbd,
samp {
  font-family: "JetBrains Mono", "SFMono-Regular", Menlo, monospace;
}

.gf-shell {
  min-height: 100vh;
  padding: var(--gf-space-8) var(--gf-space-4);
}

.gf-container {
  max-width: var(--gf-container);
  margin: 0 auto;
}

.gf-container--narrow {
  max-width: var(--gf-container-narrow);
}

.gf-stack {
  display: grid;
  gap: var(--gf-space-6);
}

.gf-page-header {
  display: flex;
  gap: var(--gf-space-4);
  align-items: flex-start;
  justify-content: space-between;
}

.gf-page-header__title {
  margin: 0;
  font-size: clamp(1.55rem, 1.15rem + 1.5vw, var(--gf-text-h1));
  line-height: 1.1;
  letter-spacing: -0.01em;
}

.gf-page-header__description {
  margin: var(--gf-space-2) 0 0;
  color: var(--gf-text-muted);
  font-size: var(--gf-text-caption);
  max-width: 68ch;
}

.gf-page-header__actions {
  display: flex;
  gap: var(--gf-space-2);
  align-items: center;
  flex-wrap: wrap;
}

.gf-card {
  background: var(--gf-surface);
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius-lg);
  padding: var(--gf-space-6);
  box-shadow: var(--gf-shadow);
}

.gf-card--muted {
  background: var(--gf-surface-muted);
}

.gf-grid {
  display: grid;
  gap: var(--gf-space-4);
}

.gf-grid--two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.gf-field {
  display: grid;
  gap: var(--gf-space-2);
}

.gf-label {
  font-size: var(--gf-text-caption);
  color: var(--gf-text-muted);
  font-weight: 500;
}

.gf-field__hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--gf-text-muted);
}

input[type="text"],
input[type="email"],
input[type="password"],
select,
textarea {
  width: 100%;
  min-height: 40px;
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius-sm);
  padding: 8px 12px;
  font: inherit;
  color: var(--gf-text);
  background: var(--gf-surface);
}

textarea {
  min-height: 112px;
  resize: vertical;
}

input:focus,
select:focus,
textarea:focus,
button:focus-visible,
a:focus-visible {
  outline: 2px solid rgba(42, 103, 245, 0.35);
  outline-offset: 2px;
}

.gf-btn {
  appearance: none;
  border: 1px solid transparent;
  border-radius: var(--gf-radius-sm);
  padding: 0 14px;
  height: var(--gf-btn-h-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  white-space: nowrap;
  font: inherit;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}

.gf-btn:disabled {
  cursor: not-allowed;
  opacity: 0.58;
  filter: saturate(0.9);
}

.gf-btn--sm {
  height: var(--gf-btn-h-sm);
}

.gf-btn--lg {
  height: var(--gf-btn-h-lg);
}

.gf-btn--primary {
  background: var(--gf-primary);
  color: var(--gf-primary-contrast);
}

.gf-btn--primary:hover:enabled {
  background: var(--gf-primary-hover);
}

.gf-btn--secondary {
  background: var(--gf-surface);
  border-color: var(--gf-border-strong);
  color: var(--gf-text);
}

.gf-btn--secondary:hover:enabled,
.gf-btn--ghost:hover:enabled {
  border-color: var(--gf-primary);
  color: var(--gf-primary);
}

.gf-btn--ghost {
  background: transparent;
  border-color: var(--gf-border);
  color: var(--gf-text-muted);
}

.gf-status,
.gf-alert {
  border-radius: var(--gf-radius-sm);
  border: 1px solid transparent;
  padding: 9px 12px;
  min-height: 38px;
  font-size: var(--gf-text-caption);
}

.gf-status:empty,
.gf-alert:empty {
  display: none;
}

.gf-alert--info {
  background: #edf3ff;
  color: #1e4db5;
  border-color: #c9dafc;
}

.gf-alert--success {
  background: var(--gf-success-bg);
  color: var(--gf-success-text);
  border-color: #c6ebd4;
}

.gf-alert--warning {
  background: var(--gf-warning-bg);
  color: var(--gf-warning-text);
  border-color: #f2d9af;
}

.gf-alert--danger {
  background: var(--gf-danger-bg);
  color: var(--gf-danger-text);
  border-color: #f3c0c0;
}

.gf-table-wrap {
  width: 100%;
  overflow-x: auto;
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius-md);
  background: var(--gf-surface);
}

.gf-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 720px;
  font-size: 0.95rem;
}

.gf-table th,
.gf-table td {
  border-bottom: 1px solid var(--gf-border);
  padding: 12px 14px;
  text-align: left;
  vertical-align: top;
}

.gf-table th {
  color: var(--gf-text-muted);
  font-size: var(--gf-text-caption);
  font-weight: 600;
  background: #f8fafe;
}

.gf-table tr:last-child td {
  border-bottom: none;
}

.gf-table tbody tr:hover {
  background: #f9fbff;
}

.gf-table-row--clickable {
  cursor: pointer;
}

.gf-table-row--clickable:hover {
  background: #f7faff;
}

.gf-table-row--selected {
  background: #edf3ff;
}

.gf-table-row--selected:hover {
  background: #e5efff;
}

.gf-table--compact th,
.gf-table--compact td {
  padding: 12px 14px;
}

.gf-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid transparent;
  padding: 3px 10px;
  font-size: 0.78rem;
  font-weight: 600;
  line-height: 1.3;
}

.gf-badge--info {
  background: #edf3ff;
  color: #1e4db5;
  border-color: #c9dafc;
}

.gf-badge--success {
  background: var(--gf-success-bg);
  color: var(--gf-success-text);
  border-color: #c6ebd4;
}

.gf-badge--warning {
  background: var(--gf-warning-bg);
  color: var(--gf-warning-text);
  border-color: #f2d9af;
}

.gf-badge--danger {
  background: var(--gf-danger-bg);
  color: var(--gf-danger-text);
  border-color: #f3c0c0;
}

.gf-toolbar {
  display: flex;
  gap: var(--gf-space-2);
  align-items: center;
  flex-wrap: wrap;
}

.gf-toolbar--space {
  justify-content: space-between;
}

.gf-nav {
  display: flex;
  gap: var(--gf-space-2);
  flex-wrap: wrap;
}

.gf-nav-link {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--gf-border);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: var(--gf-text-caption);
  color: var(--gf-text-muted);
}

.gf-nav-link[aria-current="page"] {
  border-color: var(--gf-primary);
  color: var(--gf-primary);
  background: #eef3ff;
}

.gf-empty-state {
  border: 1px dashed var(--gf-border-strong);
  border-radius: var(--gf-radius-md);
  background: var(--gf-surface-muted);
  padding: var(--gf-space-6);
  text-align: center;
}

.gf-empty-state__title {
  margin: 0;
  font-size: var(--gf-text-h2);
}

.gf-empty-state__description {
  margin: 8px auto 0;
  max-width: 56ch;
  color: var(--gf-text-muted);
}

.gf-empty-state__actions {
  margin-top: var(--gf-space-3);
  display: flex;
  gap: var(--gf-space-2);
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}

.gf-meta {
  display: flex;
  gap: var(--gf-space-3);
  flex-wrap: wrap;
  font-size: var(--gf-text-caption);
  color: var(--gf-text-muted);
}

.gf-app-cta {
  gap: var(--gf-space-4);
  align-items: flex-start;
}

.gf-section-title {
  margin: 0;
  font-size: var(--gf-text-h2);
}

.gf-section-description {
  margin: 8px 0 0;
  color: var(--gf-text-muted);
  max-width: 70ch;
  font-size: var(--gf-text-caption);
}

.gf-stats-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--gf-space-3);
}

.gf-stat-card {
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius-md);
  background: var(--gf-surface);
  padding: var(--gf-space-3);
}

.gf-stat-card__label {
  margin: 0;
  color: var(--gf-text-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.gf-stat-card__value {
  margin: 6px 0 0;
  font-size: 1.35rem;
  line-height: 1.1;
  font-weight: 700;
}

.gf-control-row {
  display: grid;
  grid-template-columns: minmax(240px, 1.6fr) repeat(2, minmax(160px, 1fr));
  gap: var(--gf-space-3);
  align-items: end;
  width: 100%;
}

.gf-control {
  margin: 0;
}

.gf-field--compact {
  gap: 6px;
}

.gf-col-hint {
  display: inline-block;
  margin-left: 6px;
  font-size: 0.72rem;
  color: var(--gf-text-muted);
  font-weight: 500;
}

.gf-cell-muted {
  margin-top: 2px;
  color: var(--gf-text-muted);
  font-size: 0.75rem;
}

.gf-empty-inline {
  text-align: center;
  padding: 20px 12px;
}

.gf-empty-inline__title {
  margin: 0;
  font-weight: 600;
}

.gf-empty-inline__hint {
  margin: 6px 0 0;
  color: var(--gf-text-muted);
  font-size: var(--gf-text-caption);
}

.gf-skeleton {
  display: inline-block;
  width: 100%;
  min-height: 14px;
  border-radius: 999px;
  background: linear-gradient(90deg, #edf2fb 25%, #e2eaf8 45%, #edf2fb 65%);
  background-size: 200% 100%;
  animation: gf-skeleton-shimmer 1.1s ease-in-out infinite;
}

@keyframes gf-skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.gf-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  border: 1px solid var(--gf-border);
  padding: 4px 10px;
  background: var(--gf-surface);
}

.gf-honeypot {
  position: absolute;
  left: -10000px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

.gf-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  padding: 24px;
  background: rgba(15, 24, 45, 0.45);
  overflow-y: auto;
}

.gf-overlay__panel {
  max-width: 820px;
  margin: 0 auto;
  background: var(--gf-surface);
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius-lg);
  box-shadow: var(--gf-shadow);
  padding: var(--gf-space-6);
}

.gf-pre {
  margin: 0;
  white-space: pre-wrap;
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius-md);
  background: var(--gf-surface-muted);
  padding: var(--gf-space-4);
  min-height: 140px;
}

.gf-pre--compact {
  min-height: 90px;
  font-size: 0.88rem;
}

.gf-pre--placeholder {
  color: var(--gf-text-muted);
  background: linear-gradient(90deg, #f2f5fb 25%, #e8eef9 45%, #f2f5fb 65%);
  background-size: 200% 100%;
  animation: gf-skeleton-shimmer 1.1s ease-in-out infinite;
}

.gf-report-view {
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius-md);
  background:
    radial-gradient(circle at 10% 0, rgba(42, 103, 245, 0.12) 0, rgba(42, 103, 245, 0) 40%),
    radial-gradient(circle at 100% 10%, rgba(30, 143, 90, 0.07) 0, rgba(30, 143, 90, 0) 50%),
    var(--gf-surface-muted);
  padding: var(--gf-space-4);
  max-height: 56vh;
  overflow: auto;
}

.gf-report-doc {
  display: grid;
  gap: var(--gf-space-4);
}

.gf-report-summary {
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius-md);
  background: var(--gf-surface);
  padding: var(--gf-space-4);
  box-shadow: 0 6px 16px rgba(20, 36, 72, 0.06);
}

.gf-report-summary__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gf-space-3);
  flex-wrap: wrap;
}

.gf-report-summary__heading {
  min-width: min(100%, 430px);
}

.gf-report-summary__title {
  margin: 0;
  font-size: 1.08rem;
}

.gf-report-summary__subtitle {
  margin: 8px 0 0;
  color: var(--gf-text-muted);
  font-size: var(--gf-text-caption);
}

.gf-report-toolbar {
  display: flex;
  align-items: center;
  gap: var(--gf-space-2);
  flex-wrap: wrap;
}

.gf-report-toolbar__button {
  appearance: none;
  border: 1px solid #c8d4eb;
  background: #f6f9ff;
  border-radius: 999px;
  padding: 7px 12px;
  font: inherit;
  font-size: 0.77rem;
  color: #3c4d72;
  cursor: pointer;
  transition: border-color 110ms ease, background-color 110ms ease;
}

.gf-report-toolbar__button:hover {
  border-color: #aabddd;
  background: #eef4ff;
}

.gf-report-pills {
  margin-top: var(--gf-space-3);
  display: flex;
  flex-wrap: wrap;
  gap: var(--gf-space-2);
}

.gf-report-pill {
  display: inline-flex;
  align-items: center;
  border: 1px solid #cad6f1;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 0.78rem;
  color: #3f4f73;
  background: #f6f9ff;
}

.gf-report-pill--link {
  text-decoration: none;
}

.gf-report-pill--link:hover {
  text-decoration: none;
  border-color: #a7bce2;
  background: #edf4ff;
}

.gf-report-card {
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius-md);
  background: var(--gf-surface);
  overflow: hidden;
  box-shadow: 0 4px 14px rgba(22, 37, 70, 0.05);
}

.gf-report-card__head {
  display: flex;
  gap: var(--gf-space-2);
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1px solid var(--gf-border);
  background: #f4f8ff;
  padding: 12px var(--gf-space-4);
}

.gf-report-card__title {
  margin: 0;
  font-size: 0.94rem;
}

.gf-report-card__meta {
  margin: 0;
  font-size: 0.76rem;
  color: var(--gf-text-muted);
}

.gf-report-card__body {
  padding: var(--gf-space-4);
}

.gf-report-stack {
  display: grid;
  gap: var(--gf-space-3);
}

.gf-report-kv {
  display: grid;
  gap: var(--gf-space-2);
}

.gf-report-kv-row {
  display: grid;
  grid-template-columns: minmax(150px, 220px) 1fr;
  gap: var(--gf-space-3);
  align-items: start;
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius-sm);
  background: #fbfcff;
  padding: 11px 12px;
}

.gf-report-kv-key {
  margin: 0;
  font-size: 0.78rem;
  color: var(--gf-text-muted);
}

.gf-report-kv-value {
  min-width: 0;
}

.gf-report-scalar {
  min-height: 20px;
}

.gf-report-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.gf-report-subsection {
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius-sm);
  background: #fafdff;
  padding: var(--gf-space-3);
}

.gf-report-subsection__title {
  margin: 0 0 var(--gf-space-2);
  font-size: 0.83rem;
  color: var(--gf-text-muted);
}

.gf-report-disclosure {
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius-sm);
  background: #fbfcff;
  overflow: hidden;
}

.gf-report-disclosure__summary {
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gf-space-2);
  cursor: pointer;
  padding: 10px 12px;
  font-weight: 600;
  background: #f8fbff;
}

.gf-report-disclosure__summary::-webkit-details-marker {
  display: none;
}

.gf-report-disclosure__lead {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 9px;
}

.gf-report-disclosure__chev {
  width: 9px;
  height: 9px;
  border-right: 2px solid #7c8da7;
  border-bottom: 2px solid #7c8da7;
  transform: rotate(-45deg);
  transition: transform 110ms ease;
  flex: 0 0 auto;
}

.gf-report-disclosure[open] .gf-report-disclosure__chev {
  transform: rotate(45deg);
}

.gf-report-disclosure__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gf-report-disclosure__meta {
  font-size: 0.72rem;
  color: #536482;
  border: 1px solid #cad7ee;
  background: #f0f6ff;
  border-radius: 999px;
  padding: 3px 8px;
}

.gf-report-disclosure__content {
  border-top: 1px solid var(--gf-border);
  padding: var(--gf-space-3);
  background: #fcfdff;
}

.gf-report-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gf-space-2);
}

.gf-report-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid #cdd8ee;
  background: #f4f8ff;
  color: #3c4d74;
  font-size: 0.77rem;
  padding: 4px 9px;
}

@media (max-width: 760px) {
  .gf-report-summary__top {
    flex-direction: column;
    align-items: stretch;
  }

  .gf-report-kv-row {
    grid-template-columns: 1fr;
  }
}

.gf-file-overlay {
  padding: var(--gf-space-5);
}

.gf-file-overlay__header {
  display: flex;
  gap: var(--gf-space-4);
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--gf-space-4);
}

.gf-file-overlay__eyebrow {
  margin: 0;
  color: var(--gf-text-muted);
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.gf-file-overlay__title {
  margin: 6px 0 0;
  font-size: clamp(1.2rem, 1.1rem + 0.5vw, 1.45rem);
  line-height: 1.15;
}

.gf-file-overlay__close-icon {
  min-width: var(--gf-btn-h-sm);
  padding: 0;
  font-size: 1.25rem;
  line-height: 1;
}

.gf-file-overlay__body {
  display: grid;
  gap: var(--gf-space-3);
}

.gf-file-overlay__section {
  border: 1px solid var(--gf-border);
  border-radius: var(--gf-radius-md);
  background: var(--gf-surface-muted);
  padding: var(--gf-space-4);
}

.gf-file-overlay__section-title {
  margin: 0 0 var(--gf-space-3);
  font-size: 0.98rem;
}

.gf-file-overlay__meta-list {
  margin: 0;
  display: grid;
  gap: var(--gf-space-2);
}

.gf-file-overlay__meta-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: var(--gf-space-3);
  align-items: baseline;
}

.gf-file-overlay__meta-row dt {
  color: var(--gf-text-muted);
  font-size: var(--gf-text-caption);
}

.gf-file-overlay__meta-row dd {
  margin: 0;
  font-weight: 600;
}

.gf-file-overlay__hint {
  margin: 8px 0 0;
  color: var(--gf-text-muted);
  font-size: var(--gf-text-caption);
}

.gf-file-overlay__error-line {
  margin: 0;
  font-size: var(--gf-text-caption);
}

.gf-file-overlay__error-line + .gf-file-overlay__error-line {
  margin-top: 6px;
}

.gf-file-overlay__error-label {
  color: var(--gf-text-muted);
}

.gf-file-overlay__footer {
  margin-top: var(--gf-space-4);
  padding-top: var(--gf-space-3);
  border-top: 1px solid var(--gf-border);
  display: flex;
  gap: var(--gf-space-3);
  align-items: center;
  justify-content: space-between;
}

.gf-file-overlay__footer-note {
  margin: 0;
  color: var(--gf-text-muted);
  font-size: var(--gf-text-caption);
}

.gf-auth-links {
  margin: 0;
  font-size: var(--gf-text-caption);
  color: var(--gf-text-muted);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

@media (max-width: 900px) {
  .gf-shell {
    padding: var(--gf-space-6) var(--gf-space-3);
  }

  .gf-page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .gf-grid--two {
    grid-template-columns: 1fr;
  }

  .gf-stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .gf-control-row {
    grid-template-columns: 1fr;
  }

  .gf-table {
    min-width: 640px;
  }

  .gf-overlay {
    padding: var(--gf-space-3);
  }

  .gf-overlay__panel {
    padding: var(--gf-space-4);
  }

  .gf-file-overlay__header {
    flex-direction: column;
    align-items: stretch;
  }

  .gf-file-overlay__meta-row {
    grid-template-columns: 1fr;
    gap: 2px;
  }

  .gf-file-overlay__footer {
    flex-direction: column;
    align-items: stretch;
  }
}
`;
