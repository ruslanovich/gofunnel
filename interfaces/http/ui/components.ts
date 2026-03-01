export type UiTone = "info" | "success" | "warning" | "danger";

export type UiButtonVariant = "primary" | "secondary" | "ghost";
export type UiButtonSize = "sm" | "md" | "lg";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === "string" && part.trim() !== "").join(" ");
}

export function buttonClassName(options?: {
  variant?: UiButtonVariant;
  size?: UiButtonSize;
  block?: boolean;
}): string {
  const variant = options?.variant ?? "primary";
  const size = options?.size ?? "md";
  return cx(
    "gf-btn",
    `gf-btn--${variant}`,
    size === "md" ? "" : `gf-btn--${size}`,
    options?.block ? "gf-btn--block" : "",
  );
}

export function alertClassName(tone: UiTone = "info", className?: string): string {
  return cx("gf-alert", `gf-alert--${tone}`, className);
}

export function badgeClassName(tone: UiTone = "info", className?: string): string {
  return cx("gf-badge", `gf-badge--${tone}`, className);
}

export function renderCard(content: string, className?: string): string {
  return `<section class="${cx("gf-card", className)}">${content}</section>`;
}

export function renderAlert(message: string, tone: UiTone = "info", className?: string): string {
  return `<p class="${alertClassName(tone, className)}">${message}</p>`;
}

export function renderBadge(
  label: string,
  tone: UiTone = "info",
  options?: {
    className?: string;
    attributes?: string;
  },
): string {
  const attributes = options?.attributes ? ` ${options.attributes.trim()}` : "";
  return `<span class="${badgeClassName(tone, options?.className)}"${attributes}>${label}</span>`;
}

export function renderEmptyState(input: {
  title: string;
  description?: string;
  actionHtml?: string;
  className?: string;
}): string {
  return `
    <section class="${cx("gf-empty-state", input.className)}">
      <h2 class="gf-empty-state__title">${input.title}</h2>
      ${input.description ? `<p class="gf-empty-state__description">${input.description}</p>` : ""}
      ${input.actionHtml ? `<div class="gf-empty-state__actions">${input.actionHtml}</div>` : ""}
    </section>
  `;
}
