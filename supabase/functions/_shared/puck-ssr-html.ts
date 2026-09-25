/** Server-side HTML renderer for Puck landing layouts (Deno / Edge). */

type PuckBlock = { type?: string; props?: Record<string, unknown> };

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripScripts(html: string): string {
  return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
}

function wrapSection(inner: string, bg?: string, pad = "16px 0"): string {
  const style = `padding:${pad};${bg ? `background:${bg};` : ""}max-width:960px;margin:0 auto;`;
  return `<div style="${style}">${inner}</div>`;
}

const SLOT_TYPES = new Set([
  "ProductImages",
  "OrderForm",
  "ProductDescription",
  "ProductReviews",
  "ProductFaq",
]);

function slotPlaceholder(type: string): string {
  const labels: Record<string, string> = {
    ProductImages: "صور المنتج",
    OrderForm: "نموذج الطلب",
    ProductDescription: "وصف المنتج",
    ProductReviews: "التقييمات",
    ProductFaq: "الأسئلة الشائعة",
  };
  const heights: Record<string, number> = {
    ProductImages: 420,
    OrderForm: 720,
    ProductDescription: 240,
    ProductReviews: 280,
    ProductFaq: 220,
  };
  const label = labels[type] || type;
  const minH = heights[type] ?? 160;
  if (type === "OrderForm") {
    return `<div data-puck-slot="OrderForm" style="min-height:${minH}px;margin:12px 0;padding:16px;background:#fff;border-radius:24px;border:1px solid #e2e8f0;box-shadow:0 20px 50px rgba(0,0,0,.06);font-family:Cairo,sans-serif">
      <div style="height:6px;border-radius:999px;background:linear-gradient(to right,#fbbf24,#f59e0b);margin-bottom:20px"></div>
      <div style="text-align:center;margin-bottom:24px">
        <div style="height:36px;width:55%;margin:0 auto 12px;background:#e2e8f0;border-radius:12px"></div>
        <div style="height:28px;width:70%;margin:0 auto;background:#ecfdf5;border-radius:999px"></div>
      </div>
      <div style="display:grid;gap:12px">
        <div style="height:48px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0"></div>
        <div style="height:48px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0"></div>
        <div style="height:52px;background:#f59e0b;border-radius:16px;opacity:.35"></div>
      </div>
      <p style="text-align:center;color:#94a3b8;font-size:13px;margin:16px 0 0">${escapeHtml(label)}…</p>
    </div>`;
  }
  return `<div data-puck-slot="${escapeHtml(type)}" style="min-height:${minH}px;margin:12px 0;padding:24px;background:#f1f5f9;border-radius:12px;text-align:center;color:#64748b;font-family:Cairo,sans-serif">${escapeHtml(label)}…</div>`;
}

function renderBlock(block: PuckBlock): string {
  const type = block.type || "";
  const p = block.props || {};

  if (SLOT_TYPES.has(type)) return slotPlaceholder(type);

  switch (type) {
    case "Hero": {
      const image = String(p.image || "");
      const title = String(p.title || "");
      const subtitle = String(p.subtitle || "");
      const overlay = Number(p.overlay ?? 0.4);
      const textColor = String(p.text_color || "#ffffff");
      const bg = image
        ? `background-image:url('${escapeHtml(image)}');background-size:cover;background-position:center;`
        : "background:#334155;";
      return `<section style="position:relative;min-height:320px;display:flex;align-items:center;justify-content:center;border-radius:12px;overflow:hidden;${bg}">
        <div style="position:absolute;inset:0;background:rgba(0,0,0,${overlay})"></div>
        <div style="position:relative;z-index:1;text-align:center;padding:32px 16px;color:${escapeHtml(textColor)};font-family:Cairo,sans-serif">
          ${title ? `<h1 style="margin:0 0 8px;font-size:clamp(1.5rem,4vw,2.5rem)">${escapeHtml(title)}</h1>` : ""}
          ${subtitle ? `<p style="margin:0;font-size:1.1rem;opacity:.95">${escapeHtml(subtitle)}</p>` : ""}
        </div>
      </section>`;
    }
    case "Banner": {
      const image = String(p.image || "");
      if (!image) return "";
      const link = String(p.link || "#");
      const alt = String(p.alt || "");
      return `<a href="${escapeHtml(link)}"><img src="${escapeHtml(image)}" alt="${escapeHtml(alt)}" loading="eager" decoding="async" style="width:100%;height:auto;border-radius:12px;display:block" /></a>`;
    }
    case "PromoBar": {
      const text = String(p.text || "");
      const bg = String(p.bg || "#7c3aed");
      const color = String(p.color || "#fff");
      return `<div style="background:${escapeHtml(bg)};color:${escapeHtml(color)};text-align:center;padding:12px 16px;font-weight:600;font-family:Cairo,sans-serif;border-radius:8px">${escapeHtml(text)}</div>`;
    }
    case "RichText": {
      const html = stripScripts(String(p.html || ""));
      const align = String(p.align || "center");
      return `<section class="prose" style="text-align:${escapeHtml(align)};font-family:Cairo,sans-serif;line-height:1.7">${html}</section>`;
    }
    case "Columns": {
      const count = Math.min(4, Math.max(2, Number(p.count) || 2));
      const gap = Number(p.gap) || 24;
      const cols = [p.col1, p.col2, p.col3, p.col4].slice(0, count).map((c) =>
        `<div style="flex:1;min-width:0">${stripScripts(String(c || ""))}</div>`
      );
      return `<div style="display:flex;flex-wrap:wrap;gap:${gap}px;font-family:Cairo,sans-serif">${cols.join("")}</div>`;
    }
    case "Spacer":
      return `<div style="height:${Number(p.height) || 32}px"></div>`;
    case "Divider": {
      const thickness = Number(p.thickness) || 1;
      const color = String(p.color || "#e5e7eb");
      const style = String(p.style || "solid");
      const width = Number(p.width_pct) || 100;
      return `<hr style="border:none;border-top:${thickness}px ${style} ${escapeHtml(color)};width:${width}%;margin:16px auto" />`;
    }
    case "Faq": {
      const title = String(p.title || "");
      const items = Array.isArray(p.items) ? p.items : [];
      const rows = items
        .map((it: { q?: string; a?: string }) =>
          `<details style="margin-bottom:8px;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-family:Cairo,sans-serif">
            <summary style="font-weight:600;cursor:pointer">${escapeHtml(String(it?.q || ""))}</summary>
            <p style="margin:8px 0 0;color:#475569">${escapeHtml(String(it?.a || ""))}</p>
          </details>`
        )
        .join("");
      return `${title ? `<h2 style="text-align:center;font-family:Cairo,sans-serif">${escapeHtml(title)}</h2>` : ""}${rows}`;
    }
    case "Features": {
      const title = String(p.title || "");
      const items = Array.isArray(p.items) ? p.items : [];
      const cards = items
        .map(
          (it: { icon?: string; title?: string; desc?: string }) =>
            `<div style="flex:1;min-width:140px;text-align:center;padding:16px;background:#fff;border-radius:12px;border:1px solid #e2e8f0">
              <div style="font-size:2rem">${escapeHtml(String(it?.icon || "✨"))}</div>
              <h3 style="margin:8px 0 4px;font-family:Cairo,sans-serif">${escapeHtml(String(it?.title || ""))}</h3>
              <p style="margin:0;color:#64748b;font-size:14px">${escapeHtml(String(it?.desc || ""))}</p>
            </div>`
        )
        .join("");
      return `${title ? `<h2 style="text-align:center;margin-bottom:16px;font-family:Cairo,sans-serif">${escapeHtml(title)}</h2>` : ""}
        <div style="display:flex;flex-wrap:wrap;gap:12px">${cards}</div>`;
    }
    case "Reviews": {
      const title = String(p.title || "");
      const items = Array.isArray(p.items) ? p.items : [];
      const cards = items
        .map(
          (it: { name?: string; text?: string; rating?: number }) =>
            `<div style="flex:1;min-width:180px;padding:16px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;font-family:Cairo,sans-serif">
              <p style="font-style:italic;margin:0 0 8px">"${escapeHtml(String(it?.text || ""))}"</p>
              <p style="margin:0;font-weight:600">— ${escapeHtml(String(it?.name || ""))}</p>
            </div>`
        )
        .join("");
      return `${title ? `<h2 style="text-align:center;margin-bottom:16px">${escapeHtml(title)}</h2>` : ""}
        <div style="display:flex;flex-wrap:wrap;gap:12px">${cards}</div>`;
    }
    case "Video": {
      const title = String(p.title || "");
      const url = String(p.url || "");
      const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]+)/);
      const embed = yt ? `https://www.youtube.com/embed/${yt[1]}` : url;
      if (!embed) return "";
      return `${title ? `<h2 style="text-align:center;font-family:Cairo,sans-serif">${escapeHtml(title)}</h2>` : ""}
        <div style="position:relative;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#0f172a">
          <iframe src="${escapeHtml(embed)}" style="position:absolute;inset:0;width:100%;height:100%;border:0" loading="lazy" title="${escapeHtml(title || "video")}"></iframe>
        </div>`;
    }
    case "IconBox": {
      const icon = String(p.icon || "🎯");
      const title = String(p.title || "");
      const desc = String(p.desc || "");
      const color = String(p.color || "#7c3aed");
      const size = Number(p.size) || 56;
      return `<div style="text-align:center;font-family:Cairo,sans-serif">
        <div style="font-size:${size}px;color:${escapeHtml(color)}">${escapeHtml(icon)}</div>
        ${title ? `<h3 style="font-weight:700">${escapeHtml(title)}</h3>` : ""}
        ${desc ? `<p style="color:#64748b">${escapeHtml(desc)}</p>` : ""}
      </div>`;
    }
    default:
      return "";
  }
}

export function puckHasRenderableContent(puckData: unknown): boolean {
  if (!puckData || typeof puckData !== "object") return false;
  const content = (puckData as { content?: unknown[] }).content;
  return Array.isArray(content) && content.length > 0;
}

export function extractPuckHero(puckData: unknown): { title?: string; subtitle?: string; image?: string } | null {
  if (!puckData || typeof puckData !== "object") return null;
  const content = (puckData as { content?: PuckBlock[] }).content;
  if (!Array.isArray(content)) return null;
  const hero = content.find((b) => b?.type === "Hero");
  if (!hero?.props) return null;
  const p = hero.props;
  return {
    title: typeof p.title === "string" ? p.title : undefined,
    subtitle: typeof p.subtitle === "string" ? p.subtitle : undefined,
    image: typeof p.image === "string" ? p.image : undefined,
  };
}

/** Full Puck layout HTML for edge SSR (above-the-fold + marketing blocks). */
export function renderPuckToHtml(puckData: unknown): string {
  if (!puckHasRenderableContent(puckData)) return "";
  const content = (puckData as { content: PuckBlock[] }).content;
  const parts = content.map((b) => renderBlock(b)).filter(Boolean);
  return `<div id="ssr-puck-shell" style="font-family:Cairo,system-ui,sans-serif;direction:rtl;background:#fdfdfd;padding:8px 12px 24px">
    ${parts.map((h) => wrapSection(h)).join("")}
  </div>`;
}
