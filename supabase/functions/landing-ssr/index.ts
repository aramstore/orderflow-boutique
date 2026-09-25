// Edge SSR for landing pages — returns pre-rendered HTML so LCP paints
// before React hydrates. Designed to be invoked by a Cloudflare Worker
// on the custom domain (e.g. was-la.com) that routes /p/* here and
// proxies everything else to the deployed SPA origin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  extractPuckHero,
  puckHasRenderableContent,
  renderPuckToHtml,
} from "../_shared/puck-ssr-html.ts";
import {
  LANDING_HERO_SIZES,
  landingHeroPreloadHref,
  landingHeroSrcSet,
  optimizeLandingImageUrl,
  wrapLandingCdnUrl,
} from "../_shared/landing-image-url.ts";
import { parseThemeTokens, themeTokensToSsrCssFromTokens } from "../_shared/theme-ssr.ts";
import { hasApprovedStandardDesign, renderApprovedStandardLanding } from "../_shared/approved-standard-landing.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_ORIGIN = (Deno.env.get("APP_ORIGIN") || Deno.env.get("SITE_URL") || "").replace(/\/$/, "");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let shellCache: { html: string; ts: number } | null = null;
const SHELL_TTL = 60_000;

function minimalShell(): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><link rel="icon" href="/favicon.ico" /></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`;
}

async function getShell(): Promise<string> {
  if (shellCache && Date.now() - shellCache.ts < SHELL_TTL) return shellCache.html;
  if (!APP_ORIGIN) {
    shellCache = { html: minimalShell(), ts: Date.now() };
    return shellCache.html;
  }
  const r = await fetch(APP_ORIGIN + "/landing.html", {
    headers: { "user-agent": "landing-ssr" },
  });
  let html = r.ok ? await r.text() : "";
  if (!html) {
    const fallback = await fetch(APP_ORIGIN + "/index.html", {
      headers: { "user-agent": "landing-ssr" },
    });
    html = fallback.ok ? await fallback.text() : minimalShell();
  }
  shellCache = { html, ts: Date.now() };
  return html;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripTags(s: string): string {
  return String(s ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Keep asset URLs relative so the browser fetches them from the
// custom domain. The Cloudflare Worker proxies non-/p/* routes to SPA_ORIGIN.
function absolutizeAssets(html: string): string {
  return html;
}

function buildHead(product: any, currency: string, pageUrl: string, platformName: string, publicHost: string): string {
  const title = escapeHtml(`${product.name} | ${platformName}`);
  const desc = escapeHtml(stripTags(product.description || product.name).slice(0, 160));
  const img = product.images?.[0] || "";
  const price = product.price;
  const lcpImg = img ? landingHeroPreloadHref(img, publicHost) : "";
  const lcpSrcSet = img ? landingHeroSrcSet(img, publicHost) : "";
  const ogImg = img ? wrapLandingCdnUrl(img, publicHost) : "";

  const preloadImg = lcpImg
    ? `<link rel="preload" as="image" href="${escapeHtml(lcpImg)}" ${
        lcpSrcSet
          ? `imagesrcset="${escapeHtml(lcpSrcSet)}" imagesizes="${escapeHtml(LANDING_HERO_SIZES)}" `
          : ""
      }fetchpriority="high" />`
    : "";

  const productJsonLd = JSON.stringify({
    "@context": "https://schema.org/",
    "@type": "Product",
    name: product.name,
    image: product.images || [],
    description: stripTags(product.description || ""),
    offers: {
      "@type": "Offer",
      price: price,
      priceCurrency: currency || "LYD",
      availability: "https://schema.org/InStock",
    },
  });

  return `
<title>${title}</title>
<meta name="description" content="${desc}" />
<link rel="canonical" href="${escapeHtml(pageUrl)}" />
<link rel="preconnect" href="${SUPABASE_URL}" crossorigin />
<link rel="dns-prefetch" href="${SUPABASE_URL}" />
<link rel="dns-prefetch" href="https://connect.facebook.net" />
<link rel="dns-prefetch" href="https://analytics.tiktok.com" />
<link rel="dns-prefetch" href="https://www.googletagmanager.com" />
<meta property="og:type" content="product" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:url" content="${escapeHtml(pageUrl)}" />
${ogImg ? `<meta property="og:image" content="${escapeHtml(ogImg)}" />` : ""}
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
${ogImg ? `<meta name="twitter:image" content="${escapeHtml(ogImg)}" />` : ""}
${preloadImg}
<script type="application/ld+json">${productJsonLd.replace(/</g, "\\u003c")}</script>
`;
}

// Static field row matching the React order-form input (label + 48px box).
function ssrFieldRow(field: any): string {
  const label = escapeHtml(field?.label || "");
  const required = field?.required
    ? `<span style="color:#f43f5e;font-weight:700">*</span>`
    : "";
  const ftype = String(field?.field_type || "");
  const fkey = String(field?.field_key || "");
  const isDelivery = ftype === "delivery_select" || fkey === "delivery_city";
  const icon = ftype === "phone" ? "📞" : ftype === "email" ? "✉️" : isDelivery ? "🚚" : "👤";
  const box = ftype === "textarea"
    ? `<div style="height:84px;border-radius:12px;border:1px solid #e2e8f0;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04)"></div>`
    : isDelivery
      ? `<div style="height:48px;border-radius:12px;border:1px solid #e2e8f0;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04);display:flex;align-items:center;justify-content:space-between;padding:0 12px;color:#64748b;font-size:14px"><span>${escapeHtml(field?.placeholder || "اختر المدينة")}</span><span>▾</span></div>`
      : `<div style="height:48px;border-radius:12px;border:1px solid #e2e8f0;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04)"></div>`;
  return `<div style="margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:#1e293b;margin-bottom:8px"><span>${icon}</span><span>${label}</span>${required}</div>
    ${box}
  </div>`;
}

// Edge-rendered above-the-fold that MIRRORS the React first paint (dark hero +
// 4/5 product image + white order-form card with price, trust badges, real
// field rows and CTA). Because the placeholder matches the hydrated layout,
// the shell → React swap is visually seamless — visitors perceive a single
// fast load instead of "blue shell → loading form → full page".
function buildAboveFold(
  product: any,
  currency: string,
  buttonText: string,
  formFields: any[],
  puckHero?: { title?: string; subtitle?: string; image?: string } | null,
  publicHost?: string,
  approvedDesign = false,
  header?: unknown,
): string {
  const name = puckHero?.title || product.name;
  const img = puckHero?.image || product.images?.[0] || "";
  const heroSrc = img
    ? optimizeLandingImageUrl(img, { width: 800, height: 800, format: "webp" }, publicHost)
    : "";
  const heroSrcSet = img ? landingHeroSrcSet(img, publicHost) : "";
  const cur = escapeHtml(currency);
  const hasDiscount =
    product.original_price && Number(product.original_price) > Number(product.price);

  const heroBlock = `
  <section style="position:relative;overflow:hidden;background:linear-gradient(to left,#0f172a,#111c30,#0f172a);padding:32px 16px;text-align:center;color:#fff;border-bottom:1px solid rgba(245,158,11,.15)">
    <div style="max-width:768px;margin:0 auto">
      <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(245,158,11,.1);color:#fbbf24;border:1px solid rgba(245,158,11,.3);padding:6px 14px;border-radius:999px;font-size:12px;font-weight:700;margin-bottom:16px">✨ عرض ملكي متاح لفترة وجيزة</div>
      <h1 style="font-size:clamp(20px,5.5vw,40px);font-weight:900;margin:0 0 12px;line-height:1.2;color:#fff">${escapeHtml(name)}</h1>
      <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);padding:6px 12px;border-radius:12px;font-size:13px;color:#cbd5e1">🏅 ضمان الجودة الفائقة</div>
    </div>
  </section>`;

  const imageBlock = heroSrc
    ? `<figure style="position:relative;aspect-ratio:4/5;border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 15px 40px -15px rgba(0,0,0,.12);border:1px solid #f1f5f9;margin:0 0 16px">
        <span style="position:absolute;top:12px;right:12px;z-index:10;background:rgba(15,23,42,.8);color:#fbbf24;font-size:11px;font-weight:700;padding:6px 12px;border-radius:999px;border:1px solid rgba(245,158,11,.2)">⭐ الأكثر مبيعاً في ليبيا</span>
        <img src="${escapeHtml(heroSrc)}" ${heroSrcSet ? `srcset="${escapeHtml(heroSrcSet)}" sizes="${escapeHtml(LANDING_HERO_SIZES)}" ` : ""}alt="${escapeHtml(name)}" width="800" height="800" fetchpriority="high" decoding="async" style="width:100%;height:100%;object-fit:contain;padding:16px;box-sizing:border-box" />
      </figure>`
    : "";

  const trustBadge = (icon: string, text: string) =>
    `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px;border-radius:12px;background:#f8fafc;border:1px solid rgba(241,245,249,.8)"><span style="font-size:20px">${icon}</span><span style="font-weight:700;color:#1e293b;line-height:1.1">${text}</span></div>`;

  const fields = Array.isArray(formFields) ? formFields.filter((f) => f && f.enabled !== false) : [];
  const fieldsHtml = fields.length
    ? fields.map(ssrFieldRow).join("")
    : [ssrFieldRow({ label: "الاسم الكامل", field_type: "text", required: true }),
       ssrFieldRow({ label: "رقم الهاتف", field_type: "phone", required: true }),
       ssrFieldRow({ label: "العنوان", field_type: "text", required: true })].join("");

  const formCard = `
  <div style="background:rgba(255,255,255,.8);border-radius:24px;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.06);border:1px solid #f1f5f9;position:relative;overflow:hidden">
    <div style="position:absolute;top:0;right:0;left:0;height:6px;background:linear-gradient(to right,#fbbf24,#f59e0b,#d97706)"></div>
    <div style="text-align:center;margin-bottom:24px">
      <div style="margin-bottom:12px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:12px">
        ${hasDiscount ? `<span style="color:#94a3b8;text-decoration:line-through;font-size:18px;font-weight:500">${product.original_price} ${cur}</span>` : ""}
        <span style="font-size:clamp(28px,8vw,48px);font-weight:900;color:#0f172a">${product.price} <span style="font-size:.6em;font-weight:700;color:#f59e0b">${cur}</span></span>
      </div>
      <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(16,185,129,.1);color:#047857;border:1px solid rgba(16,185,129,.2);padding:8px 16px;border-radius:999px;font-size:13px;font-weight:700">✅ الطلب مضمون ومتوفر بالمخزن الرئيسي</div>
      <div style="margin-top:24px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:12px">
        ${trustBadge("💵", "معاينة قبل الدفع")}
        ${trustBadge("🚚", "شحن آمن وفوري")}
        ${trustBadge("🔄", "استبدال مرن")}
      </div>
    </div>
    <div>
      ${fieldsHtml}
      <div style="width:100%;background:linear-gradient(to right,#f59e0b,#d97706,#b45309);color:#0f172a;text-align:center;padding:22px 16px;border-radius:12px;font-weight:900;font-size:16px;box-shadow:0 10px 30px rgba(245,158,11,.25);box-sizing:border-box">${escapeHtml(buttonText)}</div>
      <p style="text-align:center;color:#64748b;font-size:12px;font-weight:700;margin-top:12px">⚡ سنقوم بالاتصال بك هاتفياً لتأكيد موعد الشحن السريع</p>
    </div>
  </div>`;

  if (approvedDesign) {
    return renderApprovedStandardLanding({ heroBlock, imageBlock, formCard, header });
  }

  const formOnTop = !!product.order_form_on_top;
  const first = formOnTop ? formCard : imageBlock;
  const second = formOnTop ? imageBlock : formCard;

  return `
<div id="ssr-shell" style="font-family:Cairo,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;direction:rtl;background:#fafaf7;min-height:100vh;color:#0f172a">
  <header style="background:#fff;border-bottom:1px solid #f1f5f9;height:56px"></header>
  ${heroBlock}
  <main style="max-width:1152px;margin:0 auto;padding:24px 12px">
    ${first}
    <div style="height:24px"></div>
    ${second}
  </main>
</div>
`;
}

// Build the client hydration seed. Shape mirrors the `loadedProduct` the
// LandingPage builds on the client, so React renders identical content with no
// flash. JSON is embedded in a <script type="application/json"> tag; we only
// need to neutralize "<" so the tag can't be terminated early.
function buildSeedJson(input: {
  slug: string;
  username: string | null;
  ownerId: string | null;
  storeId: string | null;
  product: any;
  store: StoreExtras;
  formFields: unknown[];
  deliveryPrices?: unknown[];
  pixelSettings: unknown;
  header: unknown;
  platformName: string;
  strictStock: boolean;
  puckData: unknown;
  orderFormPresetId?: string | null;
}): string {
  const p = input.product || {};
  const sc = p.size_chart;
  const seed = {
    v: 2,
    slug: input.slug,
    username: input.username,
    ownerId: input.ownerId,
    storeId: input.storeId,
    orderFormPresetId: input.orderFormPresetId ?? null,
    // Seeded read data so the client renders the COMPLETE page with ZERO read
    // queries — only a single live stock check + the page_view write remain.
    pixelSettings: input.pixelSettings ?? null,
    header: input.header ?? null,
    platformName: input.platformName || "",
    strictStock: !!input.strictStock,
    puckData: input.puckData ?? null,
    product: {
      id: p.id,
      owner_id: p.owner_id ?? input.ownerId,
      name: p.name,
      // Use the URL slug (landing slug for landing pages) to mirror the client.
      slug: input.slug,
      price: p.price != null ? String(p.price) : "",
      original_price: p.original_price != null ? String(p.original_price) : undefined,
      description: typeof p.description === "string" ? p.description : "",
      images: Array.isArray(p.images) ? p.images : [],
      product_codes: Array.isArray(p.product_codes) ? p.product_codes : [],
      colors: Array.isArray(p.colors) ? p.colors : [],
      sizes: Array.isArray(p.sizes) ? p.sizes : [],
      upsell_enabled: !!p.upsell_enabled,
      upsell_title: p.upsell_title || "🎁 عروض خاصة",
      upsell_offers: Array.isArray(p.upsell_offers) ? p.upsell_offers : [],
      order_form_on_top: !!p.order_form_on_top,
      show_quantity: p.show_quantity != null ? !!p.show_quantity : true,
      stock: typeof p.stock === "number" ? p.stock : undefined,
      variant_stock:
        p.variant_stock && typeof p.variant_stock === "object" ? p.variant_stock : {},
      size_chart_url: p.size_chart_url ?? null,
      reviews: Array.isArray(p.reviews) ? p.reviews : [],
      faqs: Array.isArray(p.faqs) ? p.faqs : [],
    },
    store: input.store,
    formFields: Array.isArray(input.formFields) ? input.formFields : [],
    deliveryPrices: Array.isArray(input.deliveryPrices) ? input.deliveryPrices : [],
    sizeChart:
      sc && typeof sc === "object" && sc.enabled && Array.isArray(sc.rows) && sc.rows.length
        ? {
            enabled: true,
            title: String(sc.title ?? "جدول المقاسات"),
            description: String(sc.description ?? ""),
            columns: Array.isArray(sc.columns) ? sc.columns.map((c: any) => String(c ?? "")) : [],
            rows: sc.rows
              .filter((r: any) => r?.enabled !== false)
              .map((r: any) => ({
                enabled: true,
                values: Array.isArray(r?.values) ? r.values.map((v: any) => String(v ?? "")) : [],
                note: String(r?.note ?? ""),
              })),
          }
        : null,
  };
  return JSON.stringify(seed).replace(/</g, "\\u003c");
}

const DEFAULT_PLATFORM_NAME = "منصة وصلة";

async function getPlatformName(): Promise<string> {
  const { data } = await supabase.from("app_settings").select("system_name").limit(1).maybeSingle();
  const name = String(data?.system_name ?? "").trim();
  return name || DEFAULT_PLATFORM_NAME;
}

async function getStoreCurrency(ownerId: string | null): Promise<string> {
  if (!ownerId) return "د.ل";
  const { data } = await supabase
    .from("store_settings")
    .select("currency_symbol")
    .eq("owner_id", ownerId)
    .limit(1)
    .maybeSingle();
  return data?.currency_symbol || "د.ل";
}

// Store currency + button text + theme used to seed the client so the first
// React paint shows the correct price, CTA and colors without a round-trip.
// Theme tokens are returned RAW so the client can hydrate StoreThemeScope and
// skip its own store_settings fetch entirely.
interface StoreExtras {
  currency_symbol: string;
  currency_code: string;
  button_text: string;
  confirmation_enabled: boolean;
  confirmation_message: string;
  theme_tokens: unknown;
  theme_custom_css: string | null;
}
async function getStoreExtras(
  ownerId: string | null,
  storeId: string | null,
): Promise<StoreExtras> {
  const fallback: StoreExtras = {
    currency_symbol: "د.ل",
    currency_code: "LYD",
    button_text: "اطلب الآن - الدفع عند الاستلام",
    confirmation_enabled: false,
    confirmation_message: "",
    theme_tokens: null,
    theme_custom_css: null,
  };
  if (!ownerId) return fallback;
  let q = supabase
    .from("store_settings")
    .select("currency_symbol, currency_code, button_text, confirmation_enabled, confirmation_message, theme_tokens, theme_custom_css")
    .eq("owner_id", ownerId);
  if (storeId) q = q.eq("store_id", storeId);
  const { data } = await q.limit(1).maybeSingle();
  return {
    currency_symbol: data?.currency_symbol || fallback.currency_symbol,
    currency_code: (data as { currency_code?: string })?.currency_code || fallback.currency_code,
    button_text: (data as { button_text?: string })?.button_text || fallback.button_text,
    confirmation_enabled: !!(data as { confirmation_enabled?: boolean })?.confirmation_enabled,
    confirmation_message: (data as { confirmation_message?: string })?.confirmation_message || "",
    theme_tokens: (data as { theme_tokens?: unknown })?.theme_tokens ?? null,
    theme_custom_css: (data as { theme_custom_css?: string })?.theme_custom_css ?? null,
  };
}

// Marketing pixel settings — seeded so the client never queries the DB to set
// up tracking (pixels still load lazily on first interaction).
async function getPixelSettings(ownerId: string | null, storeId: string | null): Promise<unknown> {
  if (!ownerId) return null;
  try {
    const { data } = await supabase.rpc("get_pixel_settings_public", {
      _owner_id: ownerId,
      _store_id: storeId || null,
    });
    return Array.isArray(data) ? data[0] ?? null : data ?? null;
  } catch (_e) {
    return null;
  }
}

// Strict-stock flag — seeded so the client knows the policy without a query.
async function getStockPolicy(ownerId: string | null): Promise<boolean> {
  if (!ownerId) return false;
  try {
    const { data } = await supabase.rpc("get_owner_stock_policy", { _owner_id: ownerId });
    const row = Array.isArray(data) ? data[0] : data;
    return !!(row as { strict_stock_enabled?: boolean })?.strict_stock_enabled;
  } catch (_e) {
    return false;
  }
}

// Store header (logo/contact/social) — seeded so the public header renders
// without its own header_settings round-trip on every visit.
async function getHeaderSettings(ownerId: string | null, storeId: string | null): Promise<unknown> {
  if (!ownerId) return null;
  let q = supabase
    .from("header_settings")
    .select(
      "logo_text, logo_image, tagline, phone, email, instagram_url, facebook_url, whatsapp_url, tiktok_url",
    )
    .eq("owner_id", ownerId);
  if (storeId) q = q.eq("store_id", storeId);
  const { data } = await q.limit(1).maybeSingle();
  return data ?? null;
}

// Enabled public order-form fields — seeded so the form renders instantly
// (no "loading form" gap) instead of after a client-side fetch.
async function getFormConfig(
  ownerId: string | null,
  storeId: string | null,
  presetId: string | null,
): Promise<{
  fields: unknown[];
  button_text: string;
  confirmation_enabled: boolean;
  confirmation_message: string;
}> {
  const fallback = {
    fields: [] as unknown[],
    button_text: "اطلب الآن - الدفع عند الاستلام",
    confirmation_enabled: false,
    confirmation_message: "",
  };
  if (!ownerId) return fallback;
  try {
    const { data, error } = await supabase.rpc("get_public_order_form_config", {
      _owner_id: ownerId,
      _store_id: storeId,
      _preset_id: presetId,
    });
    if (!error && Array.isArray(data) && data.length) {
      const meta = data[0] as Record<string, unknown>;
      const fields = data
        .filter((r: any) => r?.field_key)
        .map((r: any) => ({
          id: r.field_id || r.field_key,
          field_key: r.field_key,
          label: r.label,
          placeholder: r.placeholder,
          field_type: r.field_type,
          required: !!r.required,
          enabled: true,
        }));
      return {
        fields,
        button_text: String(meta.button_text || fallback.button_text),
        confirmation_enabled: !!meta.confirmation_enabled,
        confirmation_message: String(meta.confirmation_message || ""),
      };
    }
  } catch (_e) {
    // ignore — client will fetch as fallback
  }
  try {
    const { data, error } = await supabase.rpc("get_public_order_form_fields", {
      _owner_id: ownerId,
      _store_id: storeId,
    });
    if (!error && Array.isArray(data)) return { ...fallback, fields: data };
  } catch (_e) {
    // ignore
  }
  return fallback;
}

async function getDeliveryPrices(storeId: string | null): Promise<unknown[]> {
  if (!storeId) return [];
  try {
    const { data, error } = await supabase.rpc("get_public_delivery_prices", { _store_id: storeId });
    if (!error && Array.isArray(data)) return data;
  } catch (_e) {
    // ignore — client will fetch as fallback
  }
  return [];
}

function notFoundHtml(): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>المنتج غير متوفر</title></head><body style="font-family:Cairo,sans-serif;text-align:center;padding:48px"><h1>المنتج غير موجود</h1><p>عذراً، لم نتمكن من العثور على هذا المنتج.</p></body></html>`;
}

function parsePath(pathname: string): { slug: string | null; username: string | null } {
  // Supports:
  //   /p/:slug
  //   /p/:username/:slug
  //   /landing-ssr/p/:slug  (when invoked directly through the function URL)
  const m = pathname.replace(/^\/landing-ssr/, "").match(/^\/p\/([^\/?#]+)(?:\/([^\/?#]+))?\/?$/);
  if (!m) return { slug: null, username: null };
  const a = decodeURIComponent(m[1]);
  const b = m[2] ? decodeURIComponent(m[2]) : null;
  return b ? { username: a, slug: b } : { username: null, slug: a };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    // Allow CF Worker to override the path it wants us to render.
    const targetPath = url.searchParams.get("path") || url.pathname;
    const publicHost = url.searchParams.get("host") || url.host;
    const { slug, username } = parsePath(targetPath);

    if (!slug) {
      return new Response(notFoundHtml(), {
        status: 404,
        headers: { ...corsHeaders, "content-type": "text/html; charset=utf-8" },
      });
    }

    // Resolve owner if username scoped.
    let ownerId: string | null = null;
    if (username) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("user_id, is_active")
        .eq("username", username)
        .maybeSingle();
      if (!prof || !prof.is_active) {
        return new Response(notFoundHtml(), {
          status: 404,
          headers: { ...corsHeaders, "content-type": "text/html; charset=utf-8" },
        });
      }
      ownerId = prof.user_id;
    }

    // First, try a landing_page with this slug (custom landing pages).
    const landingQuery = supabase
      .from("landing_pages")
      .select(
        "id, product_id, store_id, title, subtitle, slug, description, images, price, original_price, owner_id, is_visible, puck_data, upsell_enabled, upsell_title, upsell_offers, order_form_on_top, show_quantity, faqs, size_chart, order_form_preset_id",
      )
      .eq("slug", slug)
      .eq("is_visible", true);
    if (ownerId) landingQuery.eq("owner_id", ownerId);
    const { data: landingRows } = await landingQuery.limit(5);
    const landing = landingRows?.[0];

    let product: any = null;
    let puckData: unknown = null;
    let puckHero: ReturnType<typeof extractPuckHero> = null;

    if (landing) {
      puckData = landing.puck_data;
      puckHero = extractPuckHero(puckData);
      const { data: prod } = await supabase
        .from("products")
        .select(
          "id, name, slug, price, original_price, description, reviews, images, owner_id, store_id, product_codes, colors, sizes, stock, variant_stock, size_chart_url, order_form_on_top",
        )
        .eq("id", landing.product_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (prod) {
        const lpImages = Array.isArray(landing.images) ? landing.images : [];
        product = {
          ...prod,
          name: landing.title || prod.name,
          description: landing.description || prod.description,
          reviews: Array.isArray((prod as { reviews?: unknown }).reviews) ? (prod as { reviews?: unknown[] }).reviews : [],
          price: landing.price ?? prod.price,
          original_price: landing.original_price ?? prod.original_price,
          images: lpImages.length ? lpImages : prod.images,
          owner_id: landing.owner_id || prod.owner_id,
          store_id: landing.store_id ?? prod.store_id,
          // Landing-page controlled fields (mirror client precedence)
          upsell_enabled: !!landing.upsell_enabled,
          upsell_title: landing.upsell_title || "🎁 عروض خاصة",
          upsell_offers: Array.isArray(landing.upsell_offers) ? landing.upsell_offers : [],
          order_form_on_top:
            landing.order_form_on_top != null ? !!landing.order_form_on_top : !!prod.order_form_on_top,
          show_quantity: landing.show_quantity != null ? !!landing.show_quantity : true,
          faqs: Array.isArray(landing.faqs) ? landing.faqs : [],
          size_chart: landing.size_chart ?? null,
        };
      }
    } else {
      const productQuery = supabase
        .from("products")
        .select(
          "id, name, slug, price, original_price, description, reviews, images, owner_id, store_id, product_codes, colors, sizes, stock, variant_stock, size_chart_url, order_form_on_top",
        )
        .eq("slug", slug)
        .eq("is_visible", true)
        .limit(1);
      if (ownerId) productQuery.eq("owner_id", ownerId);
      const { data: products } = await productQuery;
      product = products?.[0];
    }

    if (!product) {
      return new Response(notFoundHtml(), {
        status: 404,
        headers: { ...corsHeaders, "content-type": "text/html; charset=utf-8" },
      });
    }

    const productStoreId = (product as { store_id?: string }).store_id ?? null;
    const orderFormPresetId =
      (landing as { order_form_preset_id?: string | null } | null)?.order_form_preset_id ?? null;
    const [storeExtras, platformName, formConfig, deliveryPrices, pixelSettings, strictStock, header] =
      await Promise.all([
        getStoreExtras(product.owner_id, productStoreId),
        getPlatformName(),
        getFormConfig(product.owner_id, productStoreId, orderFormPresetId),
        getDeliveryPrices(productStoreId),
        getPixelSettings(product.owner_id, productStoreId),
        getStockPolicy(product.owner_id),
        getHeaderSettings(product.owner_id, productStoreId),
      ]);
    const formFields = formConfig.fields;
    storeExtras.button_text = formConfig.button_text || storeExtras.button_text;
    storeExtras.confirmation_enabled = formConfig.confirmation_enabled;
    storeExtras.confirmation_message = formConfig.confirmation_message;
    const currency = storeExtras.currency_symbol;
    const themeTokens = parseThemeTokens(storeExtras.theme_tokens);
    const themeCustomCss = storeExtras.theme_custom_css;

    const pageUrl = `https://${publicHost}${targetPath}`;
    const shell = absolutizeAssets(await getShell());
    const themeCss = themeTokensToSsrCssFromTokens(themeTokens, "#root", themeCustomCss);
    const headInjection = buildHead(product, currency, pageUrl, platformName, publicHost) + `<style id="ssr-theme">${themeCss}</style>`;
    const bodyInjection = puckHasRenderableContent(puckData)
      ? renderPuckToHtml(puckData)
      : buildAboveFold(product, currency, storeExtras.button_text, formFields as any[], puckHero, publicHost, hasApprovedStandardDesign(shell), header);

    // Data seed: lets the client render the COMPLETE page (incl. order form) on
    // its first paint, with no extra round-trips — so visitors see a single fast
    // load instead of "shell → loading form → full page". The client revalidates
    // in the background.
    const seedJson = buildSeedJson({
      slug,
      username,
      ownerId: product.owner_id ?? ownerId ?? null,
      storeId: productStoreId,
      product,
      store: storeExtras,
      formFields,
      deliveryPrices,
      pixelSettings,
      header,
      platformName,
      strictStock,
      puckData,
      orderFormPresetId,
    });

    let html = shell.replace(/<title>[\s\S]*?<\/title>/i, "");
    // Strip any static OG tags from the shell so ours win for crawlers.
    html = html.replace(/<meta\s+(?:property|name)="(?:og:[^"]+|twitter:[^"]+|description)"[^>]*>\s*/gi, "");
    html = html.replace("</head>", `${headInjection}\n</head>`);
    html = html.replace(
      /<div id="root">\s*<\/div>/,
      `<div id="ssr-fallback">${bodyInjection}</div>\n<script type="application/json" id="landing-ssr-data">${seedJson}</script>\n<div id="root"></div>`,
    );

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "text/html; charset=utf-8",
        // Keep CDN cache short so new deploys (rotated asset hashes) are
        // picked up quickly. Browsers should always revalidate.
        "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("landing-ssr error", err);
    return new Response(notFoundHtml(), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "text/html; charset=utf-8" },
    });
  }
});
