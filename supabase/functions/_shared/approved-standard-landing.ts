/** Activate only when the fetched frontend shell declares the same design. */
export function hasApprovedStandardDesign(shell: string): boolean {
  const markup = shell.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  const head = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(markup)?.[1] || "";
  return (head.match(/<meta\b[^>]*>/gi) || []).some((tag) => {
    const name = /\sname\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2];
    const content = /\scontent\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2];
    return name === "wasla-standard-design" && content === "standard-approved-v1";
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderHeader(value: unknown): string {
  const header = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const name = typeof header.logo_text === "string" ? header.logo_text : "";
  const logo = typeof header.logo_image === "string" ? header.logo_image : "";
  const tagline = typeof header.tagline === "string" ? header.tagline : "";
  return `<header data-wasla-section="header" dir="rtl">
    <div data-wasla-part="brand-row"><div data-wasla-part="brand-content">
      ${logo ? `<img data-wasla-part="store-logo" src="${escapeHtml(logo)}" alt="${escapeHtml(name)}" width="32" height="32" loading="eager" />` : ""}
      <div data-wasla-part="brand-copy"><p data-wasla-part="store-name">${escapeHtml(name)}</p>${tagline ? `<p data-wasla-part="store-tagline">${escapeHtml(tagline)}</p>` : ""}</div>
    </div></div>
  </header>`;
}

/** Reuse v29's escaped product/price/field markup; only its presentation changes. */
export function renderApprovedStandardLanding(input: {
  heroBlock: string;
  imageBlock: string;
  formCard: string;
  header?: unknown;
}): string {
  const hero = input.heroBlock
    .replace("<section ", '<section data-wasla-section="hero" ')
    .replace("<h1 ", '<h1 data-wasla-part="hero-title" ')
    .replace('<div style="display:inline-flex;', '<div data-wasla-part="offer-badge" style="display:inline-flex;')
    .replace('<div style="display:inline-flex;', '<div data-wasla-part="guarantee-badge" style="display:inline-flex;');
  const image = input.imageBlock
    .replace("<figure ", '<figure data-wasla-part="main-image" ')
    .replace("<span ", '<span data-wasla-part="bestseller-badge" ')
    .replace("<img ", '<img data-wasla-part="product-image" ');
  const form = input.formCard.replace('<div style="width:100%;background:linear-gradient', '<div data-wasla-part="order-cta" style="width:100%;background:linear-gradient');

  return `
<style id="wasla-standard-approved-critical">
.wasla-standard-approved[data-wasla-page="standard"]{font-family:Cairo,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;direction:rtl;background:#07375f!important;min-height:100vh;color:#0f172a;line-height:1.5}
.wasla-standard-approved [data-wasla-section="header"]{background:#09142f!important;color:#fff;margin-bottom:12px!important;border-bottom:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.wasla-standard-approved [data-wasla-part="brand-row"]{max-width:1400px;margin:0 auto;padding:3px 16px!important;min-height:0!important;display:flex;justify-content:center;align-items:center}
.wasla-standard-approved [data-wasla-part="brand-content"]{display:flex;align-items:center;gap:10px;min-width:0;max-width:100%}
.wasla-standard-approved [data-wasla-part="brand-copy"]{min-width:0;text-align:center}
.wasla-standard-approved [data-wasla-part="store-name"]{margin:0;font-size:14px!important;font-weight:600!important;line-height:1.6!important;color:#fff!important;overflow-wrap:break-word}
.wasla-standard-approved [data-wasla-part="store-logo"]{width:32px;height:32px;flex-shrink:0;border-radius:999px;object-fit:cover;border:2px solid rgba(245,158,11,.3)}
.wasla-standard-approved [data-wasla-part="store-tagline"]{margin:4px 0 0;font-size:12px;color:#94a3b8}
.wasla-standard-approved [data-wasla-part="main"]{width:100%;max-width:1152px!important;margin:0 auto;padding:24px 12px!important;box-sizing:border-box}
.wasla-standard-approved [data-wasla-section="images"]{width:100%;max-width:640px;margin:0 auto}
.wasla-standard-approved [data-wasla-part="main-image"]{aspect-ratio:4 / 5!important;border-radius:24px!important}
.wasla-standard-approved [data-wasla-part="product-image"]{padding:0px!important;object-fit:cover!important}
.wasla-standard-approved [data-wasla-section="hero"]{background:#09142f!important;color:#fff!important;padding-block:16px!important}
.wasla-standard-approved [data-wasla-part="hero-title"]{font-size:17px!important;font-weight:600!important;line-height:1.5!important;color:#fff!important;background:none!important}
.wasla-standard-approved [data-wasla-part="offer-badge"],.wasla-standard-approved [data-wasla-part="guarantee-badge"],.wasla-standard-approved [data-wasla-part="bestseller-badge"]{display:none!important}
.wasla-standard-approved [data-wasla-section="order"]{width:100%;max-width:720px;margin:0 auto}
.wasla-standard-approved [data-wasla-section="order"]>div{background:#fff!important;padding:16px!important;border-radius:24px!important}
.wasla-standard-approved [data-wasla-part="order-cta"]{background:#d97706!important;color:#0f172a!important;border-radius:17px!important;min-height:52px!important;padding-block:12px!important;box-shadow:none!important}
@media(min-width:640px){.wasla-standard-approved [data-wasla-part="main"]{padding-inline:24px!important}.wasla-standard-approved [data-wasla-part="brand-row"]{justify-content:flex-start}.wasla-standard-approved [data-wasla-part="brand-copy"]{text-align:right}.wasla-standard-approved [data-wasla-part="store-name"]{font-size:18px!important}.wasla-standard-approved [data-wasla-part="store-logo"]{width:40px;height:40px}.wasla-standard-approved [data-wasla-part="store-tagline"]{font-size:14px}.wasla-standard-approved [data-wasla-part="hero-title"]{font-size:28px!important}}
</style>
<div id="ssr-shell" class="wasla-standard-approved" data-wasla-page="standard" data-wasla-design-version="standard-approved-v1">
  ${renderHeader(input.header)}
  <main data-wasla-layout="ordered">
    <div data-wasla-part="main" data-wasla-row="checkout"><div data-wasla-section="images">${image}</div></div>
    ${hero}
    <div data-wasla-part="main" data-wasla-row="checkout"><div data-wasla-section="order">${form}</div></div>
  </main>
</div>
`;
}
