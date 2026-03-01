import { cx } from "./components.js";

export type RenderPageLayoutInput = {
  title: string;
  description?: string;
  contentHtml: string;
  headerActionsHtml?: string;
  topNavHtml?: string;
  narrow?: boolean;
  pageClassName?: string;
};

export function renderPageLayout(input: RenderPageLayoutInput): string {
  return `
    <div class="gf-shell ${cx(input.pageClassName)}">
      <main class="${cx("gf-container", input.narrow ? "gf-container--narrow" : "")}">
        <div class="gf-stack">
          ${input.topNavHtml ? `<nav class="gf-nav">${input.topNavHtml}</nav>` : ""}
          <header class="gf-page-header">
            <div>
              <h1 class="gf-page-header__title">${input.title}</h1>
              ${input.description ? `<p class="gf-page-header__description">${input.description}</p>` : ""}
            </div>
            ${input.headerActionsHtml ? `<div class="gf-page-header__actions">${input.headerActionsHtml}</div>` : ""}
          </header>
          ${input.contentHtml}
        </div>
      </main>
    </div>
  `;
}

export function renderDocument(contentHtml: string, styles: string): string {
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${styles}</style>
  </head>
  <body>${contentHtml}</body>
</html>`;
}
