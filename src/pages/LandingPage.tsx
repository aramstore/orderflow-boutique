import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, ShoppingBag, Phone, MapPin, User, Mail, Ruler, ZoomIn, X, Star, ChevronDown, ShieldCheck, Sparkles, Award, Truck } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { isolateLatin } from "@/lib/bidi";
import StoreHeader from "@/components/StoreHeader";
import { PuckRender } from "@/components/PuckRender";
import StandardLandingLayout from "@/components/landing/StandardLandingLayout";
import { APPROVED_LANDING_DESIGN_VERSION, APPROVED_LANDING_SECTION_ORDER } from "@/lib/approvedLandingDesign";
import "@/components/landing/standard-landing-approved.css";

// Lazy-load DOMPurify only when description is rendered
let DOMPurifyModule: typeof import("dompurify") | null = null;
const loadDOMPurify = async () => {
  if (!DOMPurifyModule) DOMPurifyModule = (await import("dompurify")).default as any;
  return DOMPurifyModule!;
};

interface Product {
  id: string;
  name: string;
  slug: string;
  price: string;
  original_price?: string;
  description: string;
  images: string[];
  product_codes?: string[];
  colors?: string[];
  sizes?: string[];
  upsell_enabled?: boolean;
  upsell_title?: string;
  upsell_offers?: Array<{ quantity: number; price: number; label: string }>;
  order_form_on_top?: boolean;
  show_quantity?: boolean;
  owner_id?: string;
  stock?: number;
  size_chart_url?: string | null;
  reviews?: Array<{ name: string; rating: number; comment: string }>;
  faqs?: Array<{ question: string; answer: string }>;
}

interface SizeChartData {
  enabled: boolean;
  title?: string;
  description?: string;
  columns: string[];
  rows: Array<{ enabled: boolean; values: string[]; note?: string }>;
}

interface PixelSettings {
  facebook_pixel_id: string | null;
  facebook_enabled: boolean;
  tiktok_pixel_id: string | null;
  tiktok_enabled: boolean;
  google_analytics_id: string | null;
  google_enabled: boolean;
  snapchat_pixel_id: string | null;
  snapchat_enabled: boolean;
}

interface FormField {
  id: string;
  field_key: string;
  label: string;
  placeholder: string;
  field_type: string;
  required: boolean;
  enabled: boolean;
  sort_order: number;
}

interface StoreSettings {
  currency_symbol: string;
  currency_code: string;
  button_text?: string;
}

// Declare fbq for TypeScript
declare global {
  interface Window {
    fbq: any;
    _fbq: any;
    ttq: any;
    gtag: any;
    dataLayer: any[];
    snaptr: any;
  }
}

// Map Arabic currency symbols / non-ISO codes to ISO 4217 codes required by Facebook/TikTok/GA
const CURRENCY_ISO_MAP: Record<string, string> = {
  "د.ل": "LYD", "ل.د": "LYD", "دينار": "LYD", "LYD": "LYD",
  "د.إ": "AED", "AED": "AED", "درهم": "AED",
  "ر.س": "SAR", "SAR": "SAR", "ريال": "SAR",
  "د.ك": "KWD", "KWD": "KWD",
  "ج.م": "EGP", "EGP": "EGP", "جنيه": "EGP",
  "د.أ": "JOD", "JOD": "JOD",
  "د.ت": "TND", "TND": "TND",
  "د.ج": "DZD", "DZD": "DZD",
  "د.ب": "BHD", "BHD": "BHD",
  "ر.ع": "OMR", "OMR": "OMR",
  "ر.ق": "QAR", "QAR": "QAR",
  "د.ع": "IQD", "IQD": "IQD",
  "ل.س": "SYP", "SYP": "SYP",
  "ل.ل": "LBP", "LBP": "LBP",
  "د.م": "MAD", "MAD": "MAD",
  "$": "USD", "USD": "USD",
  "€": "EUR", "EUR": "EUR",
  "£": "GBP", "GBP": "GBP",
};
function toISOCurrency(code?: string, symbol?: string): string {
  const c = (code || "").trim();
  if (/^[A-Z]{3}$/.test(c)) return c;
  if (c && CURRENCY_ISO_MAP[c]) return CURRENCY_ISO_MAP[c];
  const s = (symbol || "").trim();
  if (s && CURRENCY_ISO_MAP[s]) return CURRENCY_ISO_MAP[s];
  return "LYD"; // sensible default for this Libya-focused platform
}

// Cache keys
const CACHE_KEYS = {
  STORE_SETTINGS: 'libya_store_settings',
  PIXEL_SETTINGS: 'libya_pixel_settings',
  FORM_FIELDS: 'libya_form_fields',
  PRODUCT: 'libya_product_',
};

// Cache duration: 5 minutes
const CACHE_DURATION = 5 * 60 * 1000;

function getFromCache(key: string): any {
  try {
    const cached = sessionStorage.getItem(key);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_DURATION) {
        return data;
      }
    }
  } catch {}
  return null;
}

function setToCache(key: string, data: any) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {}
}

const LandingPage = () => {
  const { slug, username } = useParams<{ slug: string; username?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [product, setProduct] = useState<Product | null>(null);
  const [sizeChartData, setSizeChartData] = useState<SizeChartData | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ type: string; msg: string } | null>(null);
  const showToast = (title: string, description: string, variant: string = "success") => {
    setToastMessage({ type: variant, msg: `${title}: ${description}` });
    setTimeout(() => setToastMessage(null), 4000);
    try { toast({ title, description, variant: variant === "destructive" ? "destructive" : undefined } as any); } catch {}
  };
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [showSizeChart, setShowSizeChart] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings>({ currency_symbol: "د.ل", currency_code: "LYD", button_text: "اطلب الآن - الدفع عند الاستلام" });
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [selectedProductCode, setSelectedProductCode] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const [selectedUpsellIndex, setSelectedUpsellIndex] = useState<number | null>(null);
  const [sanitizedDescription, setSanitizedDescription] = useState<string>("");

  // The deployed Edge renderer keeps its first paint outside React's root.
  // Replace it when loading settles, including an unavailable-product result.
  useLayoutEffect(() => {
    if (loading) return;
    document.getElementById("ssr-fallback")?.remove();
    document.getElementById("ssr-shell")?.remove();
  }, [loading]);
  
  // Force light mode — landing pages should always look the same regardless of dashboard theme
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    if (wasDark) root.classList.remove("dark");
    return () => {
      if (wasDark) root.classList.add("dark");
    };
  }, []);
  
  // For multiple items with different variants
  interface ItemVariant {
    color: string;
    size: string;
    productCode: string;
  }
  const [itemVariants, setItemVariants] = useState<ItemVariant[]>([{ color: "", size: "", productCode: "" }]);
  
  
  // Get UTM source from URL params
  const getUtmSource = () => {
    const utmSource = searchParams.get("utm_source");
    if (utmSource) return utmSource;
    
    // Try to detect from referrer
    const referrer = document.referrer;
    if (referrer.includes("facebook.com") || referrer.includes("fb.com")) return "facebook";
    if (referrer.includes("instagram.com")) return "instagram";
    if (referrer.includes("tiktok.com")) return "tiktok";
    if (referrer.includes("google.com")) return "google";
    if (referrer.includes("twitter.com") || referrer.includes("x.com")) return "twitter";
    if (referrer.includes("snapchat.com")) return "snapchat";
    
    return "direct";
  };

  // Full UTM + FB attribution captured from URL
  const getAttribution = () => {
    const fbclid = searchParams.get("fbclid") || "";
    const inferredSource = (fbclid && !searchParams.get("utm_source")) ? "facebook" : getUtmSource();
    return {
      utm_source: inferredSource,
      utm_medium: searchParams.get("utm_medium") || (fbclid ? "paid" : null),
      utm_campaign: searchParams.get("utm_campaign") || null,
      utm_content: searchParams.get("utm_content") || null,
      utm_term: searchParams.get("utm_term") || null,
      fb_campaign_id: searchParams.get("fb_campaign_id") || searchParams.get("utm_campaign") || null,
      fb_adset_id: searchParams.get("fb_adset_id") || searchParams.get("utm_term") || null,
      fb_ad_id: searchParams.get("fb_ad_id") || searchParams.get("utm_content") || null,
      fbclid: fbclid || null,
    };
  };

  useEffect(() => {
    const ac = new AbortController();
    const loadData = async () => {
      if (!slug) {
        setLoading(false);
        return;
      }

      try {
        // Owner-scoped caches will be read after we resolve the product owner.
        let loadedCurrency = "AED";

        // Cached product for instant render
        const productCacheKey = CACHE_KEYS.PRODUCT + (username || '_') + slug;
        const cachedProduct = getFromCache(productCacheKey);
        if (cachedProduct) {
          setProduct(cachedProduct.product);
          if (cachedProduct.ownerId) setOwnerId(cachedProduct.ownerId);
          setLoading(false);
        }

        // Run profile + product in parallel
        const profilePromise: any = username
          ? (supabase as any).rpc("get_public_profile_by_username", { _username: username })
              .then((res: any) => ({ data: Array.isArray(res.data) ? res.data[0] : res.data, error: res.error }))
          : Promise.resolve({ data: null, error: null } as any);

        // Two-stage fetch: lightweight fields first (fast), heavy fields (description/images/reviews) second
        const productLightSelect = "id, name, slug, price, original_price, product_codes, colors, sizes, owner_id, store_id, upsell_enabled, upsell_title, upsell_offers, order_form_on_top, is_visible, stock, size_chart_url";

        // أولاً: حاول مطابقة username كرابط متجر (slug) لتحديد store_id
        const storeBySlugPromise = username
          ? supabase.from("stores").select("id, owner_id").eq("slug", username).maybeSingle()
          : Promise.resolve({ data: null } as any);

        // ابحث عن صفحة هبوط بهذا الـ slug، فإن وُجدت نأخذ المنتج المرتبط ونطبّق إعدادات الصفحة
        const landingPromise = supabase
          .from("landing_pages")
          .select("id, product_id, store_id, slug, title, subtitle, images, price, original_price, upsell_enabled, upsell_title, upsell_offers, order_form_on_top, show_quantity, is_visible, faqs, size_chart, puck_data")
          .eq("slug", slug)
          .maybeSingle();

        const [profileRes, landingRes, storeBySlugRes] = await Promise.all([profilePromise, landingPromise, storeBySlugPromise]);
        const landingPage: any = landingRes && (landingRes as any).data ? (landingRes as any).data : null;
        if (landingPage && landingPage.puck_data) setPuckData(landingPage.puck_data);
        const storeBySlug: any = storeBySlugRes && (storeBySlugRes as any).data ? (storeBySlugRes as any).data : null;

        // إن وُجدت صفحة هبوط: نأخذ المنتج بمعرّفه. وإلا نرجع للسلوك القديم (slug في products).
        const productPromise = landingPage
          ? supabase.from("products").select(productLightSelect).eq("id", landingPage.product_id).is("deleted_at", null)
          : supabase
              .from("products")
              .select(productLightSelect)
              .eq("slug", slug)
              .eq("is_visible", true)
              .is("deleted_at", null);

        const productRes = await productPromise;

        if (ac.signal.aborted) return;
        let resolvedOwnerId: string | null = null;
        let resolvedStoreId: string | null = storeBySlug?.id || landingPage?.store_id || null;
        if (storeBySlug) {
          resolvedOwnerId = storeBySlug.owner_id;
          setOwnerId(storeBySlug.owner_id);
        } else if (username) {
          const prof = (profileRes as any).data;
          if (!prof || !prof.is_active) { setLoading(false); return; }
          resolvedOwnerId = prof.user_id;
          setOwnerId(prof.user_id);
        }
        if (resolvedStoreId) setStoreId(resolvedStoreId);

        if (productRes.error) throw productRes.error;
        const rows = (productRes.data as any[]) || [];
        const matched = resolvedOwnerId ? rows.find((r) => r.owner_id === resolvedOwnerId) : rows[0];

        // إذا كانت الصفحة مخفية أو المنتج مخفي، أوقف
        if (landingPage && landingPage.is_visible === false) { setLoading(false); return; }
        if (matched && matched.is_visible === false && !landingPage) { setLoading(false); return; }

        let loadedProduct: Product | null = null;
        if (matched) {
          // طبّق overrides من صفحة الهبوط إن وُجدت
          const lp = landingPage;
          // اضبط مالك المتجر (مهم لتتبع التحليلات وربط الأحداث بالمتجر الصحيح)
          if (!resolvedOwnerId && matched.owner_id) {
            resolvedOwnerId = matched.owner_id;
            setOwnerId(matched.owner_id);
          }
          if (!resolvedStoreId && (matched as any).store_id) {
            resolvedStoreId = (matched as any).store_id;
            setStoreId((matched as any).store_id);
          }
          const lpImages: string[] = Array.isArray(lp?.images) ? lp.images : [];
          const lpHasUpsell = lp ? lp.upsell_enabled : null;
          loadedProduct = {
            id: matched.id,
            name: matched.name,
            slug: lp?.slug || matched.slug,
            price: String(lp?.price ?? matched.price),
            original_price: (lp?.original_price ?? matched.original_price) ? String(lp?.original_price ?? matched.original_price) : undefined,
            description: cachedProduct?.product?.description || "",
            images: lpImages.length ? lpImages : (cachedProduct?.product?.images || []),
            product_codes: matched.product_codes || [],
            colors: matched.colors || [],
            sizes: matched.sizes || [],
            // Upsell is controlled exclusively by the landing page.
            upsell_enabled: !!lp?.upsell_enabled,
            upsell_title: (lp?.upsell_title || "🎁 عروض خاصة"),
            upsell_offers: Array.isArray(lp?.upsell_offers) ? lp.upsell_offers : [],
            order_form_on_top: lp?.order_form_on_top != null ? !!lp.order_form_on_top : !!(matched as any).order_form_on_top,
            show_quantity: lp?.show_quantity != null ? !!lp.show_quantity : true,
            // عنوان مخصص لصفحة الهبوط (إن وُجد)
            ...(lp?.title ? { name: lp.title } : {}),
            stock: typeof (matched as any).stock === "number" ? (matched as any).stock : undefined,
            size_chart_url: (matched as any).size_chart_url || null,
            reviews: cachedProduct?.product?.reviews || [],
            faqs: Array.isArray(lp?.faqs) ? lp.faqs : [],
          };
          setProduct(loadedProduct);

          // جدول المقاسات الخاص بصفحة الهبوط
          const sc = lp?.size_chart;
          if (sc && typeof sc === "object" && sc.enabled && Array.isArray(sc.rows) && sc.rows.length > 0) {
            setSizeChartData({
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
            });
          } else {
            setSizeChartData(null);
          }

          // Fetch heavy fields (images/description/reviews) separately after first paint
          const needProductHeavy = !lpImages.length;
          const heavyProductPromise = needProductHeavy
            ? supabase.from("products").select("images, description, reviews").eq("id", matched.id).maybeSingle()
            : supabase.from("products").select("description, reviews").eq("id", matched.id).maybeSingle();
          const heavyLandingPromise = lp
            ? supabase.from("landing_pages").select("description").eq("id", lp.id).maybeSingle()
            : Promise.resolve({ data: null } as any);

          Promise.all([heavyProductPromise, heavyLandingPromise]).then(([prodHeavy, landingHeavy]: any[]) => {
            const prodData = prodHeavy?.data || {};
            const landingDesc = landingHeavy?.data?.description;
            const finalDesc = (landingDesc ?? prodData.description) || "";
            const finalReviews = Array.isArray(prodData.reviews) ? prodData.reviews : [];
            const finalImages = needProductHeavy && Array.isArray(prodData.images) && prodData.images.length
              ? prodData.images
              : (loadedProduct as Product).images;
            const merged: Product = { ...(loadedProduct as Product), description: finalDesc, reviews: finalReviews, images: finalImages };
            setProduct(merged);
            setToCache(productCacheKey, { product: merged, ownerId: resolvedOwnerId || matched.owner_id });
          });
        }

        setLoading(false);

        // SECONDARY: fetch the rest in the background, prefer cache.
        const ownerForSettings = resolvedOwnerId || matched?.owner_id;
        const storeForSettings = resolvedStoreId || (matched as any)?.store_id || null;
        const productResult = { data: matched } as any;

        // Owner-scoped cache keys so different stores don't pollute each other's
        // form fields, store currency, or pixel settings.
        const ownerSuffix = (ownerForSettings || "_") + "_" + (storeForSettings || "_");
        const storeKey = CACHE_KEYS.STORE_SETTINGS + "_" + ownerSuffix;
        const pixelKey = CACHE_KEYS.PIXEL_SETTINGS + "_" + ownerSuffix;
        const formKey = CACHE_KEYS.FORM_FIELDS + "_" + ownerSuffix;

        const cachedStoreSettings = getFromCache(storeKey);
        const cachedPixelSettings = getFromCache(pixelKey);
        const cachedFormFields = getFromCache(formKey);

        // Apply cache immediately for snappy paint.
        if (cachedStoreSettings) {
          setStoreSettings(cachedStoreSettings);
          loadedCurrency = cachedStoreSettings.currency_code;
        }
        if (cachedFormFields) {
          setFormFields(cachedFormFields);
          const initialFormData: Record<string, string> = {};
          (cachedFormFields as FormField[]).forEach((field) => {
            initialFormData[field.field_key] = "";
          });
          setFormData((prev) => ({ ...initialFormData, ...prev }));
        }

        // Stale-while-revalidate: ALWAYS fetch fresh so admin edits show up.
        const pixelPromise: any = ownerForSettings
          ? (supabase as any)
              .rpc("get_pixel_settings_public", { _owner_id: ownerForSettings, _store_id: storeForSettings || null })
              .then((res: any) => ({ data: Array.isArray(res.data) ? res.data[0] : res.data, error: res.error }))
          : Promise.resolve({ data: null, error: null } as any);

        const formQ = supabase.from("order_form_fields").select("id, field_key, label, placeholder, field_type, required").eq("enabled", true);
        if (ownerForSettings) formQ.eq("owner_id", ownerForSettings);
        if (storeForSettings) formQ.eq("store_id", storeForSettings);
        const formFieldsPromise = formQ.order("sort_order", { ascending: true });

        const storeQ = supabase.from("store_settings").select("currency_symbol, currency_code, button_text");
        if (ownerForSettings) storeQ.eq("owner_id", ownerForSettings);
        const storePromise = storeQ.limit(1).maybeSingle();

        const catalogPromise = supabase.from("form_field_catalog").select("field_key").eq("admin_enabled", true);

        Promise.all([pixelPromise, formFieldsPromise, storePromise, catalogPromise]).then(([pixelResult, formFieldsResult, storeSettingsResult, catalogResult]) => {
          if (formFieldsResult.data) {
            const allowed = new Set((catalogResult.data || []).map((c: any) => c.field_key));
            const filtered = (formFieldsResult.data as FormField[]).filter(f => allowed.size === 0 || allowed.has(f.field_key));
            setFormFields(filtered);
            setToCache(formKey, filtered);
            const initialFormData: Record<string, string> = {};
            filtered.forEach((field: FormField) => {
              initialFormData[field.field_key] = "";
            });
            setFormData((prev) => ({ ...initialFormData, ...prev }));
          }

          if (storeSettingsResult.data) {
            loadedCurrency = storeSettingsResult.data.currency_code;
            setStoreSettings({
              currency_symbol: storeSettingsResult.data.currency_symbol,
              currency_code: storeSettingsResult.data.currency_code,
              button_text: (storeSettingsResult.data as any).button_text || "اطلب الآن - الدفع عند الاستلام",
            });
            setToCache(storeKey, storeSettingsResult.data);
          }

          if (pixelResult.data) {
            setToCache(pixelKey, pixelResult.data);
          }

          // Track page view in background (non-blocking)
          if (loadedProduct) {
            const attr = getAttribution();
            supabase.from("analytics_events").insert({
              event_type: "page_view",
              product_slug: slug,
              owner_id: ownerForSettings || null,
              store_id: storeForSettings || null,
              ...attr,
            } as any).then(() => {});
          }

          // Initialize tracking pixels when browser is idle
          if (pixelResult.data) {
            const runPixels = () => initializePixels(pixelResult.data as PixelSettings, loadedProduct, loadedCurrency);
            if (typeof (window as any).requestIdleCallback === "function") {
              (window as any).requestIdleCallback(runPixels, { timeout: 2000 });
            } else {
              setTimeout(runPixels, 800);
            }
          }
        });
      } catch (error) {
        console.error("Error loading data:", error);
        setLoading(false);
      }
    };

    loadData();
    return () => ac.abort();
  }, [slug]);

  // Sanitize description in background, after main render
  useEffect(() => {
    if (!product?.description) {
      setSanitizedDescription("");
      return;
    }
    let cancelled = false;
    const run = async () => {
      const dp = await loadDOMPurify();
      if (cancelled) return;
      let html = (dp as any).sanitize(product.description) as string;
      // Force lazy-loading + async decoding on every embedded image/iframe
      html = html
        .replace(/<img\b(?![^>]*\bloading=)/gi, '<img loading="lazy" decoding="async"')
        .replace(/<iframe\b(?![^>]*\bloading=)/gi, '<iframe loading="lazy"');
      // Neutralize pasted HTML from other sites that uses fixed widths,
      // floats, absolute positioning, or huge margins that overflow mobile.
      html = html
        // Drop hard-coded width/height attributes on media + tables
        .replace(/\s(width|height)="[^"]*"/gi, "")
        // Strip problematic CSS declarations from inline styles
        .replace(/style="([^"]*)"/gi, (_m, s) => {
          const cleaned = s
            .replace(/(?:^|;)\s*(width|min-width|max-width|height|min-height|max-height|position|top|left|right|bottom|float|margin[^:]*|padding[^:]*|transform)\s*:[^;]*/gi, "")
            .replace(/^;+|;+$/g, "")
            .trim();
          return cleaned ? `style="${cleaned}"` : "";
        });
      setSanitizedDescription(html);
    };
    if (typeof (window as any).requestIdleCallback === "function") {
      (window as any).requestIdleCallback(run, { timeout: 1500 });
    } else {
      setTimeout(run, 300);
    }
    return () => { cancelled = true; };
  }, [product?.description]);

  // Track checkout start when user starts filling the form
  const [checkoutTracked, setCheckoutTracked] = useState(false);
  const [puckData, setPuckData] = useState<any>(null);

  const handleInputChange = (fieldKey: string, value: string) => {
    let cleanedValue = value;
    // Phone field: strip everything except digits and optional leading +
    const isPhoneField = formFields.find(f => f.field_key === fieldKey)?.field_type === "phone";
    if (isPhoneField) {
      cleanedValue = value.replace(/[^0-9+]/g, "");
      if (cleanedValue.startsWith("+")) {
        cleanedValue = "+" + cleanedValue.slice(1).replace(/[^0-9]/g, "");
      } else {
        cleanedValue = cleanedValue.replace(/[^0-9]/g, "");
      }
    }
    setFormData({ ...formData, [fieldKey]: cleanedValue });

    // Track checkout start on first input
    if (!checkoutTracked && value.length > 0) {
      setCheckoutTracked(true);
      
      // Track InitiateCheckout across all enabled pixels
      if (product) {
        const value = parseFloat(product.price);
        const currency = toISOCurrency(storeSettings.currency_code, storeSettings.currency_symbol);
        if (window.fbq) {
          window.fbq('track', 'InitiateCheckout', {
            content_name: product.name,
            content_ids: [product.id],
            content_type: 'product',
            value,
            currency,
            num_items: 1,
          });
        }
        if (window.ttq && typeof window.ttq.track === 'function') {
          window.ttq.track('InitiateCheckout', {
            value,
            currency,
            contents: [{ content_id: product.id, content_name: product.name, quantity: 1 }],
          });
        }
        if (window.gtag) {
          window.gtag('event', 'begin_checkout', {
            value,
            currency,
            items: [{ item_id: product.id, item_name: product.name, quantity: 1 }],
          });
        }
        if (window.snaptr) {
          window.snaptr('track', 'START_CHECKOUT', {
            price: value,
            currency,
            item_ids: [product.id],
          });
        }
      }
      
      // Fire-and-forget so input stays buttery smooth
      const attr = getAttribution();
      supabase.from("analytics_events").insert({
        event_type: "checkout_start",
        product_slug: slug,
          owner_id: ownerId || null,
          store_id: storeId || null,
        ...attr,
      } as any).then(({ error }) => {
        if (error) console.error("Error tracking checkout start:", error);
      });
    }
  };

  const initializePixels = (settings: PixelSettings, productData: Product | null, currencyCode: string) => {
    // Facebook Pixel
    if (settings.facebook_enabled && settings.facebook_pixel_id) {
      initFacebookPixel(settings.facebook_pixel_id, productData, currencyCode);
    }

    // TikTok Pixel
    if (settings.tiktok_enabled && settings.tiktok_pixel_id) {
      initTikTokPixel(settings.tiktok_pixel_id);
    }

    // Google Analytics
    if (settings.google_enabled && settings.google_analytics_id) {
      initGoogleAnalytics(settings.google_analytics_id);
    }

    // Snapchat Pixel
    if (settings.snapchat_enabled && settings.snapchat_pixel_id) {
      initSnapchatPixel(settings.snapchat_pixel_id);
    }
  };

  const initFacebookPixel = (pixelId: string, productData?: Product | null, currencyCode?: string) => {
    // Check if already initialized to prevent duplicate activation
    if (window.fbq && window.fbq.loaded) {
      return;
    }

    // Check if script already exists
    if (document.querySelector('script[src*="fbevents.js"]')) {
      return;
    }

    (function(f: any, b: Document, e: string, v: string, n?: any, t?: any, s?: any) {
      if (f.fbq) return;
      n = f.fbq = function() {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = '2.0';
      n.queue = [];
      t = b.createElement(e) as HTMLScriptElement;
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode?.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

    window.fbq('init', pixelId);
    window.fbq('track', 'PageView');
    
    // Track ViewContent event for product page
    if (productData) {
      window.fbq('track', 'ViewContent', {
        content_name: productData.name,
        content_ids: [productData.id],
        content_type: 'product',
        value: parseFloat(productData.price),
        currency: currencyCode || 'AED',
      });
    }
  };

  const initTikTokPixel = (pixelId: string) => {
    // Check if already initialized
    if (window.ttq && window.ttq._i) {
      return;
    }

    // Check if script already exists
    if (document.querySelector('script[src*="tiktok.com"]')) {
      return;
    }

    (function(w: any, d: Document, t: string) {
      w.TiktokAnalyticsObject = t;
      var ttq = w[t] = w[t] || [];
      ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie"];
      ttq.setAndDefer = function(t: any, e: any) {
        t[e] = function() {
          t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
        };
      };
      for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
      ttq.instance = function(t: any) {
        var e = ttq._i[t] || [];
        for (var n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]);
        return e;
      };
      ttq.load = function(e: any, n: any) {
        var i = "https://analytics.tiktok.com/i18n/pixel/events.js";
        ttq._i = ttq._i || {};
        ttq._i[e] = [];
        ttq._i[e]._u = i;
        ttq._t = ttq._t || {};
        ttq._t[e] = +new Date();
        ttq._o = ttq._o || {};
        ttq._o[e] = n || {};
        var o = d.createElement("script") as HTMLScriptElement;
        o.type = "text/javascript";
        o.async = true;
        o.src = i + "?sdkid=" + e + "&lib=" + t;
        var a = d.getElementsByTagName("script")[0];
        a.parentNode?.insertBefore(o, a);
      };
      ttq.load(pixelId);
      ttq.page();
    })(window, document, 'ttq');
  };

  const initGoogleAnalytics = (measurementId: string) => {
    // Check if already initialized
    if (document.querySelector(`script[src*="googletagmanager.com/gtag/js?id=${measurementId}"]`)) {
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function() {
      window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', measurementId);
  };

  const initSnapchatPixel = (pixelId: string) => {
    // Check if already initialized
    if (window.snaptr && window.snaptr.loaded) {
      return;
    }

    // Check if script already exists
    if (document.querySelector('script[src*="scevent.min.js"]')) {
      return;
    }

    (function(e: any, t: Document, n: string) {
      if (e.snaptr) return;
      var a: any = e.snaptr = function() {
        a.handleRequest ? a.handleRequest.apply(a, arguments) : a.queue.push(arguments);
      };
      a.queue = [];
      a.loaded = true;
      var s = 'script';
      var r = t.createElement(s) as HTMLScriptElement;
      r.async = true;
      r.src = n;
      var u = t.getElementsByTagName(s)[0];
      u.parentNode?.insertBefore(r, u);
    })(window, document, 'https://sc-static.net/scevent.min.js');

    window.snaptr('init', pixelId, {});
    window.snaptr('track', 'PAGE_VIEW');
  };

  const trackPurchaseEvent = () => {
    const currencyCode = toISOCurrency(storeSettings.currency_code, storeSettings.currency_symbol);
    const productValue = parseFloat(product?.price || "0") * quantity;
    const eventID = `purchase_${product?.id || 'p'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // Persist for thank-you page fallback dedup
    try {
      sessionStorage.setItem('last_purchase_event', JSON.stringify({
        eventID,
        value: productValue,
        currency: currencyCode,
        content_name: product?.name,
        content_ids: [product?.id || 'unknown'],
        num_items: quantity,
        ts: Date.now(),
      }));
    } catch {}
    
    // Facebook Purchase Event with full parameters
    if (window.fbq) {
      window.fbq('track', 'Purchase', {
        value: productValue,
        currency: currencyCode,
        content_name: product?.name,
        content_ids: [product?.id || 'unknown'],
        content_type: 'product',
        num_items: quantity,
      }, { eventID });
      console.log('Facebook Purchase event tracked:', {
        value: productValue,
        currency: currencyCode,
        content_name: product?.name,
        content_ids: [product?.id],
        eventID,
      });
    }

    // TikTok Purchase Event
    if (window.ttq) {
      window.ttq.track('PlaceAnOrder', {
        value: productValue,
        currency: currencyCode,
        contents: [{ content_name: product?.name, quantity: quantity }],
      });
    }

    // Google Analytics Purchase Event
    if (window.gtag) {
      window.gtag('event', 'purchase', {
        value: productValue,
        currency: currencyCode,
        items: [{ name: product?.name, quantity: quantity }],
      });
    }

    // Snapchat Purchase Event
    if (window.snaptr) {
      window.snaptr('track', 'PURCHASE', {
        price: productValue,
        currency: currencyCode,
        item_ids: [product?.id],
      });
    }
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    // Ensure we always log a checkout attempt, even if the user pasted data
    // without firing input events (some autofill flows skip onChange).
    if (!checkoutTracked) {
      setCheckoutTracked(true);
      try {
        const attr = getAttribution();
        supabase.from("analytics_events").insert({
          event_type: "checkout_start",
          product_slug: slug,
          owner_id: ownerId || null,
          store_id: storeId || null,
          ...attr,
        } as any).then(({ error }) => {
          if (error) console.error("Error tracking checkout start (submit):", error);
        });
      } catch (err) {
        console.error("checkout_start submit tracking failed", err);
      }
    }

    // Check required fields
    const requiredFields = formFields.filter(f => f.required);
    const missingFields = requiredFields.filter(f => !formData[f.field_key]);
    
    if (missingFields.length > 0) {
      showToast("خطأ", "يرجى ملء جميع الحقول المطلوبة", "destructive");
      return;
    }

    // Validate phone number: 9-10 digits only
    const phoneField = formFields.find(f => f.field_type === "phone");
    if (phoneField) {
      const phoneValue = formData[phoneField.field_key] || "";
      // Strip +218 / 00218 country code if present, then check length
      const digitsOnly = phoneValue.replace(/\D/g, "").replace(/^(00)?218/, "");
      if (digitsOnly.length < 9 || digitsOnly.length > 10) {
        showToast("خطأ", "رقم الهاتف يجب أن يكون بين 9 و 10 أرقام", "destructive");
        return;
      }
    }

    // Extra safety: re-extract phone the same way we send it to the server,
    // and reject if it's empty or invalid (covers forms whose phone field
    // isn't typed as "phone" but is still labeled "هاتف/جوال/tel").
    {
      const findFieldEarly = (...keywords: string[]) => {
        const f = formFields.find((fld) => {
          const hay = `${fld.label || ""} ${fld.field_key || ""}`.toLowerCase();
          return keywords.some((k) => hay.includes(k.toLowerCase()));
        });
        return f ? (formData[f.field_key] || "") : "";
      };
      const phoneCandidate = (formData.phone || findFieldEarly("phone", "tel", "هاتف", "رقم", "جوال", "موبايل") || "").toString();
      const digits = phoneCandidate.replace(/\D/g, "").replace(/^(00)?218/, "");
      if (digits.length < 9 || digits.length > 10) {
        showToast("خطأ", "يرجى إدخال رقم هاتف صحيح (9 إلى 10 أرقام)", "destructive");
        return;
      }
    }

    // Validate per-piece variants: if product has variants, each piece must have its selections
    const hasColors = !!(product?.colors && product.colors.length > 0);
    const hasSizes = !!(product?.sizes && product.sizes.length > 0);
    if (hasColors || hasSizes) {
      for (let i = 0; i < itemVariants.length; i++) {
        const v = itemVariants[i];
        if ((hasColors && !v.color) || (hasSizes && !v.size)) {
          toast({
            title: "خطأ",
            description: `يرجى اختيار ${[hasColors && "اللون", hasSizes && "المقاس"].filter(Boolean).join(" و ")} للقطعة ${i + 1}`,
            variant: "destructive",
          });
          return;
        }
      }
    }

    setIsSubmitting(true);

    try {
      // SKU is hidden from landing page; auto-use the first code if any exist
      const singleCode = product?.product_codes && product.product_codes.length > 0
        ? product.product_codes[0]
        : null;
      // Keep per-piece alignment: do NOT filter, so colors/sizes/codes pair by index
      const colorsArray = itemVariants.map(v => v.color || "");
      const sizesArray = itemVariants.map(v => v.size || "");
      const codesArray = itemVariants.map(v => v.productCode || singleCode || "");
      // Build items array for proper order_items rows on the server.
      // Group consecutive pieces that share the same variant (color/size/code)
      // into a single line with quantity = N instead of N separate rows.
      const itemsPayload: Array<{
        color: string | null;
        size: string | null;
        product_code: string | null;
        quantity: number;
      }> = [];
      for (const v of itemVariants) {
        const color = v.color || null;
        const size = v.size || null;
        const product_code = (v.productCode || singleCode) || null;
        const last = itemsPayload[itemsPayload.length - 1];
        if (
          last &&
          last.color === color &&
          last.size === size &&
          last.product_code === product_code
        ) {
          last.quantity += 1;
        } else {
          itemsPayload.push({ color, size, product_code, quantity: 1 });
        }
      }

      // Map dynamic field_keys (e.g. custom_123) → standard fields by label/key keywords.
      const findField = (...keywords: string[]) => {
        const f = formFields.find((fld) => {
          const hay = `${fld.label || ""} ${fld.field_key || ""}`.toLowerCase();
          return keywords.some((k) => hay.includes(k.toLowerCase()));
        });
        return f ? (formData[f.field_key] || "") : "";
      };
      const customer_name =
        formData.name || findField("name", "اسم");
      const phone =
        formData.phone || findField("phone", "tel", "هاتف", "رقم", "جوال", "موبايل");
      // Normalize Libyan phone: strip +218/00218 country code, ensure leading 0
      const normalizePhone = (raw: string) => {
        let d = (raw || "").toString().replace(/\D/g, "");
        d = d.replace(/^(00)?218/, "");
        if (d.length === 9 && d.startsWith("9")) d = "0" + d;
        return d;
      };
      const normalizedPhone = normalizePhone(phone);
      const city =
        formData.city ||
        findField("city", "مدينة", "محافظة", "محافضة", "ولاية", "منطقة");
      const address =
        formData.address ||
        findField("address", "منطقة", "عنوان", "حي", "شارع");

      // Price is recomputed server-side to prevent client-side tampering
      const { error } = await supabase.functions.invoke("create-order", {
        body: {
          customer_name,
          phone: normalizedPhone,
          address,
          city,
          product_id: product?.id,
          quantity: quantity,
          selected_color: colorsArray.filter(Boolean).join(", ") || null,
          selected_size: sizesArray.filter(Boolean).join(", ") || null,
          selected_product_code: codesArray.filter(Boolean).join(", ") || null,
          items: itemsPayload,
          upsell_index: selectedUpsellIndex,
          landing_slug: slug,
          ...getAttribution(),
        },
      });

      if (error) throw error;

      // Track purchase event
      trackPurchaseEvent();

      // Navigate to thank you page with order data
      navigate("/thank-you", {
        state: {
          orderData: {
            productName: product?.name,
            price: product?.price,
            currencySymbol: storeSettings.currency_symbol,
            currencyCode: toISOCurrency(storeSettings.currency_code, storeSettings.currency_symbol),
            productId: product?.id,
            quantity,
            customerName: customer_name,
            phone: normalizedPhone,
            city,
            address,
            ownerId: product?.owner_id || ownerId || null,
          },
        },
      });
    } catch (error) {
      console.error("Error submitting order:", error);
      showToast("خطأ", "حدث خطأ أثناء إرسال الطلب، يرجى المحاولة مرة أخرى", "destructive");
    } finally {
      setIsSubmitting(false);
    }
  };

  const getFieldIcon = (fieldType: string) => {
    switch (fieldType) {
      case "phone":
        return <Phone className="w-4 h-4" />;
      case "email":
        return <Mail className="w-4 h-4" />;
      default:
        return <User className="w-4 h-4" />;
    }
  };

  if (loading) {
    if (typeof document !== "undefined" && document.getElementById("ssr-fallback")) return null;
    return (
      <div className="min-h-screen w-full bg-slate-50 font-cairo overflow-x-hidden" dir="rtl">
        <header className="bg-white border-b border-slate-100 py-4 px-6 text-center w-full">
          <Skeleton className="h-6 w-32 mx-auto" />
        </header>
        <section className="bg-gradient-to-l from-slate-900 via-emerald-950 to-slate-900 py-16 px-4 text-center w-full">
          <Skeleton className="h-10 w-80 mx-auto mb-3 bg-white/10" />
          <Skeleton className="h-5 w-48 mx-auto bg-white/10" />
        </section>
        <main className="w-full max-w-6xl mx-auto px-4 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Skeleton className="aspect-square rounded-2xl" />
            <div className="space-y-4">
              <Skeleton className="h-40 rounded-xl" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl border max-w-md">
          <div className="bg-red-50 text-red-600 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
            <X className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">عرض غير متاح حالياً</h1>
          <p className="text-slate-500 mb-4">الصفحة المقصودة أو المنتج لم يعد متوفراً في الوقت الحالي.</p>
        </div>
      </div>
    );
  }


  // -------- Section slots (used by both legacy layout and Puck templates) --------
  const puckHasContent = !!(puckData && Array.isArray(puckData?.content) && puckData.content.length > 0);
  const heroSlot = (
      <section data-wasla-section="hero" className={`relative overflow-hidden bg-gradient-to-l from-[#0f172a] via-[#111c30] to-[#0f172a] ${puckHasContent ? "py-8 sm:py-16" : "py-4 sm:py-6"} px-4 text-center text-white w-full border-b border-amber-500/15`}>
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none opacity-40" />
        <div className="max-w-3xl mx-auto relative z-10">
          <div data-wasla-part="offer-badge" className="inline-flex items-center gap-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 px-3.5 py-1.5 rounded-full text-xs font-bold mb-4 tracking-wide shadow-sm animate-bounce">
            <Sparkles className="w-3.5 h-3.5" />
            <span>عرض ملكي متاح لفترة وجيزة</span>
          </div>
          <h1 data-wasla-part="hero-title" className={puckHasContent ? "text-xl sm:text-3xl md:text-5xl font-black mb-3 sm:mb-4 leading-tight bg-clip-text bg-gradient-to-b from-white via-slate-100 to-slate-300" : "text-lg sm:text-2xl md:text-[28px] font-semibold mb-3 leading-relaxed break-words bg-clip-text bg-gradient-to-b from-white via-slate-100 to-slate-300"}>
            {product.name}
          </h1>
          <div data-wasla-part="guarantee-badge" className="flex items-center justify-center gap-3 text-xs sm:text-base text-slate-300">
            <span className="flex items-center gap-1.5 bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl">
              <Award className="w-4 h-4 text-amber-400" />
              ضمان الجودة الفائقة
            </span>
          </div>
        </div>
      </section>
  );
  const productImagesSlot = (
    <>
            <div className="aspect-[4/5] sm:aspect-square rounded-2xl sm:rounded-3xl overflow-hidden bg-white shadow-[0_15px_40px_-15px_rgba(0,0,0,0.12)] mb-4 relative border border-slate-100 group gpu">
              <div data-wasla-part="bestseller-badge" className="absolute top-3 right-3 z-10 bg-[#0f172a]/80 backdrop-blur-md text-amber-400 text-[10px] sm:text-xs font-bold px-3 py-1.5 rounded-full border border-amber-500/20">
                ⭐ الأكثر مبيعاً في ليبيا
              </div>
              {product.images && product.images.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  className="relative w-full h-full flex items-center justify-center cursor-zoom-in"
                  aria-label="تكبير تفاصيل المنتج"
                >
                  <img data-wasla-part="product-image"
                    src={product.images[selectedImage]}
                    alt={product.name}
                    className="w-full h-full object-contain p-4 transition-transform duration-500 group-hover:scale-105"
                    loading="eager"
                  />
                  <div className="absolute bottom-3 left-3 bg-[#0f172a]/70 backdrop-blur-md text-white p-2.5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 border border-white/10">
                    <ZoomIn className="w-4 h-4" />
                  </div>
                </button>
              ) : (
                <Skeleton className="w-full h-full" />
              )}
            </div>

            {/* مؤشرات الصور المصغرة بحدود متفاعلة وراقية */}
            {product.images && product.images.length > 1 && (
              <div className="flex gap-2.5 sm:gap-4 justify-center flex-wrap">
                {product.images.map((image, index) => (
                  <button
                    key={index}
                    onClick={() => setSelectedImage(index)}
                    className={`w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border-2 bg-white transition-all duration-300 transform active:scale-95 ${
                      selectedImage === index
                        ? "border-amber-500 ring-4 ring-amber-500/15 shadow-md scale-105"
                        : "border-slate-200/80 hover:border-slate-300 hover:scale-102 shadow-sm"
                    }`}
                  >
                    <img src={image} alt="" className="w-full h-full object-contain p-1" />
                  </button>
                ))}
              </div>
            )}
    </>
  );
  const orderFormSlot = (
    <>
            <div className="bg-white/80 backdrop-blur-md rounded-2xl sm:rounded-3xl p-4 sm:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.06)] border border-slate-100 relative overflow-hidden">
              {/* تزيين الاستمارة بشريط ذهبي جانبي ناعم */}
              <div className="absolute top-0 right-0 left-0 h-1.5 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600" />

              <div className="text-center mb-6 sm:mb-8">
                {/* عرض الأسعار بشكل بارز مع الخصم الفعلي */}
                <div className="mb-3 flex flex-wrap items-center justify-center gap-3">
                  {product.original_price && Number(product.original_price) > Number(product.price) && (
                    <span className="text-slate-400 line-through text-lg sm:text-xl font-medium">
                      {product.original_price} {storeSettings.currency_symbol}
                    </span>
                  )}
                  <span className="text-3xl sm:text-5xl font-black text-slate-900 bg-clip-text bg-gradient-to-b from-slate-900 to-slate-850">
                    {product.price}{" "}
                    <span className="text-2xl sm:text-3xl font-bold text-amber-500">
                      {storeSettings.currency_symbol}
                    </span>
                  </span>
                </div>

                <div className="inline-flex items-center gap-2 bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 px-4 py-2 rounded-full text-xs sm:text-sm font-bold">
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span>الطلب مضمون ومتوفر بالمخزن الرئيسي</span>
                </div>

                {typeof product.stock === "number" && product.stock > 0 && product.stock <= 20 && (
                  <div className="mt-3 inline-flex items-center gap-1.5 bg-amber-500/10 text-amber-700 border border-amber-500/20 px-4 py-1.5 rounded-full text-xs font-bold animate-pulse">
                    🔥 تبقت {product.stock} قطع فقط في مستودع التوزيع!
                  </div>
                )}

                {(sizeChartData || (product.size_chart_url && product.sizes && product.sizes.length > 0)) && (
                  <button
                    type="button"
                    onClick={() => setShowSizeChart(true)}
                    className="mt-3 inline-flex items-center gap-1.5 text-slate-600 text-xs font-semibold hover:text-amber-600 transition-colors hover:underline"
                  >
                    <Ruler className="w-4 h-4" /> عرض تفاصيل ودليل المقاسات للطلب
                  </button>
                )}

                {/* شريط الأمان والضمانات الفاخرة للعملاء */}
                <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3 text-xs">
                  <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-slate-50 border border-slate-100/80 shadow-sm transition-all hover:shadow-md hover:bg-white">
                    <span className="text-xl">💵</span>
                    <span className="font-bold text-slate-800 leading-none">معاينة قبل الدفع</span>
                  </div>
                  <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-slate-50 border border-slate-100/80 shadow-sm transition-all hover:shadow-md hover:bg-white">
                    <span className="text-xl">🚚</span>
                    <span className="font-bold text-slate-800 leading-none">شحن آمن وفوري</span>
                  </div>
                  <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-slate-50 border border-slate-100/80 shadow-sm transition-all hover:shadow-md hover:bg-white">
                    <span className="text-xl">🔄</span>
                    <span className="font-bold text-slate-800 leading-none">استبدال مرن</span>
                  </div>
                </div>
              </div>

              {/* فورم الطلب */}
              <form id="order-form" onSubmit={handleSubmitOrder} className="space-y-5">
                {/* خيار تعديل الكمية بتصميم راقي وسهل التفاعل */}
                {product.show_quantity !== false && (
                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-800">تعديل كمية طلبك</Label>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          const base = selectedUpsellIndex !== null ? 1 : quantity;
                          const newQty = Math.max(1, base - 1);
                          setQuantity(newQty);
                          setItemVariants((prev) => {
                            const next = [...prev];
                            while (next.length < newQty) next.push({ color: "", size: "", productCode: "" });
                            return next.slice(0, newQty);
                          });
                          const matchIdx =
                            product.upsell_enabled && Array.isArray(product.upsell_offers)
                              ? product.upsell_offers.findIndex((o) => Number(o.quantity) === newQty)
                              : -1;
                          setSelectedUpsellIndex(matchIdx >= 0 ? matchIdx : null);
                        }}
                        className="w-12 h-12 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-xl font-bold hover:bg-slate-50 active:scale-95 transition-all shadow-sm"
                      >
                        -
                      </button>
                      <span className="text-2xl font-black min-w-[50px] text-center text-slate-900">{quantity}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const base = selectedUpsellIndex !== null ? 1 : quantity;
                          const newQty = base + 1;
                          setQuantity(newQty);
                          setItemVariants((prev) => {
                            const next =
                              selectedUpsellIndex !== null ? [{ color: "", size: "", productCode: "" }] : [...prev];
                            while (next.length < newQty) next.push({ color: "", size: "", productCode: "" });
                            return next.slice(0, newQty);
                          });
                          const matchIdx =
                            product.upsell_enabled && Array.isArray(product.upsell_offers)
                              ? product.upsell_offers.findIndex((o) => Number(o.quantity) === newQty)
                              : -1;
                          setSelectedUpsellIndex(matchIdx >= 0 ? matchIdx : null);
                        }}
                        className="w-12 h-12 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-xl font-bold hover:bg-slate-50 active:scale-95 transition-all shadow-sm"
                      >
                        +
                      </button>
                    </div>
                    {(quantity > 1 || selectedUpsellIndex !== null) && (
                      <p className="text-sm font-bold text-primary bg-primary/5 border border-primary/10 px-4 py-2 rounded-xl">
                        💰 الإجمالي المستحق للطلب:{" "}
                        {selectedUpsellIndex !== null && product.upsell_offers?.[selectedUpsellIndex]
                          ? product.upsell_offers[selectedUpsellIndex].price.toFixed(2)
                          : (parseFloat(product.price) * quantity).toFixed(2)}{" "}
                        {storeSettings.currency_symbol}
                      </p>
                    )}
                  </div>
                )}

                {/* باقات العروض الخاصة وتخفيضات الكمية الفخمة */}
                {product.upsell_enabled && product.upsell_offers && product.upsell_offers.length > 0 && (
                  <div className="space-y-3 p-4 rounded-2xl border-2 border-amber-500/20 bg-amber-500/[0.02] shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 left-0 bg-amber-500 text-[#0f172a] text-[9px] font-black px-3 py-1 rounded-br-xl uppercase tracking-wider">
                      موصى به
                    </div>
                    <Label className="text-sm font-black text-amber-700 block mt-1">
                      {product.upsell_title || "🎁 عروض وهدايا حصرية"}
                    </Label>
                    <div className="space-y-2.5">
                      {product.upsell_offers.map((offer, idx) => {
                        const selected = selectedUpsellIndex === idx;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              if (selected) {
                                setSelectedUpsellIndex(null);
                              } else {
                                setSelectedUpsellIndex(idx);
                                setQuantity(offer.quantity);
                                setItemVariants((prev) => {
                                  const next = [...prev];
                                  while (next.length < offer.quantity)
                                    next.push({ color: "", size: "", productCode: "" });
                                  return next.slice(0, offer.quantity);
                                });
                              }
                            }}
                            className={`w-full text-right p-3.5 rounded-xl border-2 transition-all duration-300 flex items-center justify-between gap-3 ${
                              selected
                                ? "border-amber-500 bg-amber-500 text-slate-950 shadow-md transform scale-[1.01]"
                                : "border-slate-200 bg-white hover:border-amber-500/50 hover:bg-amber-500/[0.01]"
                            }`}
                          >
                            <div
                              className={`w-6 h-6 rounded-full flex items-center justify-center border ${
                                selected
                                  ? "bg-[#0f172a] text-amber-400 border-[#0f172a]"
                                  : "border-slate-300 bg-white text-transparent"
                              }`}
                            >
                              {selected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-sm sm:text-base leading-snug">
                                {offer.label || `عرض ${offer.quantity} قطع`}
                              </div>
                              <div
                                className={`text-[11px] font-semibold ${selected ? "text-slate-900/80" : "text-slate-500"}`}
                              >
                                {offer.quantity} قطع تليق بك
                              </div>
                            </div>
                            <div
                              className={`text-base sm:text-xl font-black ${selected ? "text-slate-950" : "text-amber-600"}`}
                            >
                              {offer.price} {storeSettings.currency_symbol}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* خيارات القطع بالتفصيل */}
                {itemVariants.map((item, index) => {
                  const hasVariants =
                    (product.colors && product.colors.length > 0) || (product.sizes && product.sizes.length > 0);

                  if (!hasVariants) return null;

                  return (
                    <div
                      key={index}
                      className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3.5 shadow-sm"
                    >
                      {quantity > 1 && (
                        <div className="text-xs font-black text-amber-600 uppercase tracking-widest">
                          تخصيص القطعة {index + 1}:
                        </div>
                      )}

                      {product.colors && product.colors.length > 0 && (
                        <div className="space-y-1.5">
                          <Label className="text-xs font-bold text-slate-600">اللون المفضل للقطعة:</Label>
                          <div className="flex flex-wrap gap-2">
                            {product.colors.map((color) => (
                              <button
                                key={color}
                                type="button"
                                onClick={() => {
                                  const newVariants = [...itemVariants];
                                  newVariants[index] = { ...newVariants[index], color };
                                  setItemVariants(newVariants);
                                }}
                                className={`px-3.5 py-2 rounded-xl border text-xs font-bold transition-all duration-200 ${
                                  item.color === color
                                    ? "border-amber-500 bg-amber-500/10 text-amber-800 ring-2 ring-amber-500/20"
                                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                                }`}
                              >
                                {color}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {product.sizes && product.sizes.length > 0 && (
                        <div className="space-y-1.5">
                          <Label className="text-xs font-bold text-slate-600">المقاس المناسب للقطعة:</Label>
                          <div className="flex flex-wrap gap-2">
                            {product.sizes.map((size) => (
                              <button
                                key={size}
                                type="button"
                                onClick={() => {
                                  const newVariants = [...itemVariants];
                                  newVariants[index] = { ...newVariants[index], size };
                                  setItemVariants(newVariants);
                                }}
                                className={`px-3.5 py-2 rounded-xl border text-xs font-bold transition-all duration-200 ${
                                  item.size === size
                                    ? "border-amber-500 bg-amber-500/10 text-amber-800 ring-2 ring-amber-500/20"
                                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                                }`}
                              >
                                {size}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* حقول نموذج البيانات للزبون */}
                <div className="space-y-4">
                  {formFields.map((field) => (
                    <div key={field.id} className="space-y-2">
                      <Label className="flex items-center gap-2 text-sm font-bold text-slate-800">
                        {field.field_type === "phone" ? (
                          <Phone className="w-4 h-4 text-amber-500" />
                        ) : field.field_type === "email" ? (
                          <Mail className="w-4 h-4 text-amber-500" />
                        ) : (
                          <User className="w-4 h-4 text-amber-500" />
                        )}
                        <span>{field.label}</span>
                        {field.required && <span className="text-rose-500 font-bold">*</span>}
                      </Label>
                      {field.field_type === "textarea" ? (
                        <Textarea
                          value={formData[field.field_key] || ""}
                          onChange={(e) => handleInputChange(field.field_key, e.target.value)}
                          placeholder={field.placeholder}
                          rows={3}
                          required={field.required}
                          className="text-base shadow-sm focus:shadow-md"
                        />
                      ) : (
                        <Input
                          value={formData[field.field_key] || ""}
                          onChange={(e) => handleInputChange(field.field_key, e.target.value)}
                          placeholder={field.placeholder}
                          type={field.field_type === "phone" ? "tel" : "text"}
                          inputMode={field.field_type === "phone" ? "tel" : "text"}
                          dir={field.field_type === "phone" ? "ltr" : "rtl"}
                          required={field.required}
                          className="text-base h-12 shadow-sm focus:shadow-md"
                        />
                      )}
                    </div>
                  ))}
                </div>

                {/* زر الإرسال الملكي */}
                <Button
                  type="submit"
                  className="w-full bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 hover:from-amber-600 hover:to-amber-800 text-[#0f172a] text-base py-6 sm:py-7 rounded-xl font-black transition-all duration-300 transform active:scale-95 shadow-[0_10px_30px_rgba(245,158,11,0.25)] hover:shadow-[0_12px_35px_rgba(245,158,11,0.35)]"
                  disabled={isSubmitting}
                >
                  {isSubmitting
                    ? "جاري تسجيل طلبك الممتاز..."
                    : storeSettings.button_text || "اطلب الآن - الدفع عند المعاينة"}
                </Button>

                <p className="text-center text-slate-500 text-xs font-bold">
                  ⚡ سنقوم بالاتصال بك هاتفياً لتأكيد موعد الشحن السريع
                </p>
              </form>
            </div>
    </>
  );
  const productDescriptionSlot = (
    <>
        {/* وصف تفاصيل السلعة ومميزاتها */}
        {product.description && sanitizedDescription && (
          <section data-wasla-section="description" className="mt-12 sm:mt-20 overflow-hidden bg-white p-6 sm:p-10 rounded-3xl shadow-[0_15px_45px_rgba(0,0,0,0.03)] border border-slate-100/80">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-amber-500/10 p-2.5 rounded-xl">
                <Sparkles className="w-5 h-5 text-amber-600" />
              </div>
              <h2 className="text-xl sm:text-3xl font-black text-slate-900">أسرار وتفاصيل الفخامة</h2>
            </div>
            <div
              className="prose prose-sm sm:prose-lg max-w-none text-slate-700 leading-relaxed break-words [&_p]:mb-5 [&_strong]:text-slate-900 [&_strong]:font-black [&_ul]:list-disc [&_ul]:mr-5 [&_ul]:mb-5 [&_li]:mb-2 [&_img]:rounded-2xl [&_img]:shadow-lg [&_img]:my-6 [&_img]:object-contain"
              dangerouslySetInnerHTML={{ __html: sanitizedDescription }}
            />
          </section>
        )}
    </>
  );
  const productReviewsSlot = (
    <>
        {/* آراء وتقييمات العملاء الموثوقة */}
        {product.reviews && product.reviews.length > 0 && (
          <section data-wasla-section="reviews" className="mt-12 sm:mt-20">
            <div className="flex items-center gap-3 mb-6 sm:mb-8">
              <div className="bg-amber-500/10 p-2.5 rounded-xl">
                <Star className="w-5 h-5 text-amber-500 fill-amber-500" />
              </div>
              <h2 className="text-xl sm:text-3xl font-black text-slate-900">آراء زبائننا المتميزين</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              {product.reviews.map((rv, i) => (
                <div
                  key={i}
                  className="p-5 sm:p-6 rounded-2xl border border-slate-100 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.02)] flex flex-col justify-between hover:shadow-[0_15px_35px_rgba(0,0,0,0.04)] transition-shadow duration-300"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3 border-b border-slate-50 pb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-600">
                          {rv.name.charAt(0)}
                        </div>
                        <span className="font-bold text-sm text-slate-900">{rv.name}</span>
                      </div>
                      <span className="text-amber-500 text-[10px] bg-amber-500/10 px-2 py-1 rounded-full font-bold">
                        {"⭐".repeat(Math.max(1, Math.min(5, rv.rating || 5)))}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed font-medium">“{rv.comment}”</p>
                  </div>
                  <div className="mt-4 flex items-center gap-1.5 text-[10px] font-bold text-emerald-600">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>مشتري مؤكد وموثق بالمنصة</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
    </>
  );
  const productFaqSlot = (
    <>
        {/* الأسئلة المتكررة الشائعة حول الخدمة والمنتج */}
        {product.faqs && product.faqs.length > 0 && (
          <section data-wasla-section="faq" className="mt-12 sm:mt-20">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-amber-500/10 p-2.5 rounded-xl">
                <Award className="w-5 h-5 text-amber-600" />
              </div>
              <h2 className="text-xl sm:text-3xl font-black text-slate-900">الأسئلة الشائعة</h2>
            </div>
            <div className="space-y-3 sm:space-y-4">
              {product.faqs.map((faq, i) => (
                <div
                  key={i}
                  className="border border-slate-100 rounded-2xl overflow-hidden bg-white shadow-sm transition-all duration-300"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full flex items-center justify-between gap-4 p-5 text-right hover:bg-slate-50/50 transition-colors"
                  >
                    <span className="font-bold text-sm sm:text-base flex-1 text-slate-900">{faq.question}</span>
                    <div
                      className={`p-1 rounded-lg bg-slate-50 transition-transform duration-300 ${openFaq === i ? "rotate-180 bg-amber-500/10 text-amber-600" : "text-slate-400"}`}
                    >
                      <ChevronDown className="w-5 h-5" />
                    </div>
                  </button>
                  {openFaq === i && (
                    <div className="px-5 pb-5 text-sm text-slate-600 leading-relaxed border-t border-slate-50 pt-4">
                      <p className="whitespace-pre-wrap font-medium">{faq.answer}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
    </>
  );
  return (
    <div
      className={`${!puckHasContent ? "wasla-standard-approved " : ""}min-h-screen w-full bg-[#fdfdfd] text-slate-900 font-cairo overflow-x-hidden pb-[calc(7rem+env(safe-area-inset-bottom))]`}
      data-wasla-page={!puckHasContent ? "standard" : undefined}
      data-wasla-design-version={!puckHasContent ? APPROVED_LANDING_DESIGN_VERSION : undefined}
      dir="rtl"
    >
      {/* خلفية تزيينية راقية من الإضاءات الخفيفة والناعمة */}
      <div className="absolute top-0 right-0 left-0 h-[600px] bg-gradient-to-b from-amber-500/5 via-primary/5 to-transparent -z-10 pointer-events-none" />

      {/* ترويسة المتجر الفخمة والثابتة بالقمة */}
      <StoreHeader
        ownerId={puckHasContent ? product?.owner_id : product?.owner_id || ownerId || undefined}
        storeId={!puckHasContent ? storeId || undefined : undefined}
        variant={!puckHasContent ? "landing" : "default"}
      />

      {/* تنبيه منبثق بديل للتوست مصمم على الطراز الفاخر */}
      {toastMessage && (
        <div
          className={`fixed top-20 left-4 right-4 z-50 p-4 rounded-2xl shadow-2xl transition-all duration-300 border backdrop-blur-md flex items-center gap-3 animate-pulse ${
            toastMessage.type === "destructive"
              ? "bg-rose-950/95 text-rose-200 border-rose-800"
              : "bg-emerald-950/95 text-emerald-200 border-emerald-800"
          }`}
        >
          <div className="p-1 rounded-full bg-white/10 shrink-0">
            {toastMessage.type === "destructive" ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
          </div>
          <div className="font-semibold text-sm flex-1 leading-snug">{toastMessage.msg}</div>
          <button onClick={() => setToastMessage(null)} className="text-white/60 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {puckHasContent ? (
        <PuckRender
          data={puckData}
          ctx={{
            ownerId: product?.owner_id || ownerId || undefined,
            storeId: storeId || undefined,
            username,
            currencySymbol: storeSettings.currency_symbol,
          }}
          slots={{
            hero: heroSlot,
            productImages: productImagesSlot,
            orderForm: orderFormSlot,
            productDescription: productDescriptionSlot,
            productReviews: productReviewsSlot,
            productFaq: productFaqSlot,
          }}
        />
      ) : (
        <StandardLandingLayout
          hero={heroSlot}
          images={productImagesSlot}
          order={orderFormSlot}
          description={productDescriptionSlot}
          reviews={productReviewsSlot}
          faq={productFaqSlot}
          sectionOrder={APPROVED_LANDING_SECTION_ORDER}
        />
      )}

      {/* نافذة تكبير وتدقيق الصور (Lightbox) */}
      {lightboxOpen && product.images && product.images.length > 0 && (
        <div
          className="fixed inset-0 z-[100] bg-[#0f172a]/95 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            className="absolute top-4 left-4 bg-white/10 hover:bg-white/20 text-white p-3 rounded-full transition-colors border border-white/10"
            onClick={() => setLightboxOpen(false)}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={product.images[selectedImage]}
            alt={product.name}
            className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl p-2"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* دليل المقاسات ومودال العرض */}
      {showSizeChart && (sizeChartData || product.size_chart_url) && (
        <div
          className="fixed inset-0 z-[100] bg-[#0f172a]/90 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setShowSizeChart(false)}
        >
          <button
            type="button"
            className="absolute top-4 left-4 bg-white/10 hover:bg-white/20 text-white p-3 rounded-full transition-colors border border-white/10"
            onClick={() => setShowSizeChart(false)}
          >
            <X className="w-6 h-6" />
          </button>

          {sizeChartData ? (
            <div
              className="max-w-2xl w-full max-h-[85vh] overflow-auto bg-white rounded-2xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              dir="rtl"
            >
              <div className="px-5 py-4 border-b bg-gradient-to-l from-amber-50 to-white">
                <h3 className="text-lg font-black text-slate-900">{sizeChartData.title || "جدول المقاسات"}</h3>
                {sizeChartData.description && (
                  <p className="text-xs text-slate-500 mt-1">{sizeChartData.description}</p>
                )}
              </div>
              <div className="p-4 overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      {sizeChartData.columns.map((col, i) => (
                        <th key={i} className="px-3 py-2 text-right font-bold text-slate-700 border border-slate-200">
                          {col || `عمود ${i + 1}`}
                        </th>
                      ))}
                      {sizeChartData.rows.some((r) => r.note) && (
                        <th className="px-3 py-2 text-right font-bold text-slate-700 border border-slate-200">ملاحظة</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {sizeChartData.rows.map((row, ri) => (
                      <tr key={ri} className="even:bg-slate-50/50">
                        {sizeChartData.columns.map((_, ci) => (
                          <td key={ci} className="px-3 py-2 text-right text-slate-800 border border-slate-200">
                            {row.values[ci] ?? ""}
                          </td>
                        ))}
                        {sizeChartData.rows.some((r) => r.note) && (
                          <td className="px-3 py-2 text-right text-slate-600 text-xs border border-slate-200">
                            {row.note ?? ""}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <img
              src={product.size_chart_url!}
              alt="جدول المقاسات ودليل العميل"
              className="max-w-full max-h-full object-contain bg-white rounded-2xl p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}

      {/* الزر السفلي العائم لسرعة التنقل والحجز (Sticky CTA) مع لمسات وتأثير زجاج بلوري فخم */}
      <div data-wasla-section="sticky" className="fixed bottom-0 inset-x-0 z-40 bg-white/80 backdrop-blur-lg border-t border-slate-100/80 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-4 max-w-md mx-auto">
          <div className="flex flex-col shrink-0">
            <span className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">
              {product.price} {storeSettings.currency_symbol}
            </span>
            {product.original_price && Number(product.original_price) > Number(product.price) && (
              <span className="text-xs text-slate-400 line-through leading-none">
                {product.original_price} {storeSettings.currency_symbol}
              </span>
            )}
          </div>
          <Button
            type="button"
            onClick={() => {
              const el = document.getElementById("order-form");
              if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                const firstInput = el.querySelector<HTMLInputElement>("input, textarea");
                setTimeout(() => firstInput?.focus({ preventScroll: true }), 500);
              }
            }}
            className="flex-1 min-w-0 bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 text-[#0f172a] font-black text-sm sm:text-base py-5 rounded-xl transition-all duration-300 shadow-[0_8px_25px_rgba(245,158,11,0.2)]"
          >
            اضغط هنا لطلب المنتج الآن
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;
