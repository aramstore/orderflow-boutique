import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Phone, MapPin, Calendar, Loader2, Clock, Truck, CheckCircle, XCircle, Download, Trash2, Send, ImagePlus, Search, Eye, Plus, RefreshCw, PackageOpen, PhoneCall, PhoneOff, CalendarClock, MessageCircle, BarChart3, ShieldCheck, ShieldAlert, Hash, EyeOff, Undo2, Archive, RotateCcw, Printer, ShoppingCart, Bot, Globe } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { printStickers, DEFAULT_STICKER_SETTINGS, type StickerSettings, type StickerOrder } from "@/lib/printSticker";
import { OrderDetailsDialog } from "@/components/OrderDetailsDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";
import { EditMatchedCity } from "@/components/EditMatchedCity";
import { isolateLatin } from "@/lib/bidi";
import { useShippingErrorAliases, matchShippingError } from "@/hooks/useShippingErrorAliases";
import { useStoreContext } from "@/hooks/useStoreContext";
import { ShippingOptionsDialog, getShippingOptionsDefaults, type ShippingOptionsValue } from "@/components/ShippingOptionsDialog";

interface Order {
  id: string;
  customer_name: string;
  phone: string;
  address: string;
  city: string;
  product_name: string;
  product_id?: string | null;
  price: number;
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled" | "settled" | "returned_received" | "unpacked";
  created_at: string;
  selected_color?: string;
  selected_size?: string;
  selected_product_code?: string;
  quantity?: number;
  shipping_included?: boolean;
  shipping_reference?: string | null;
  order_code?: string | null;
  matched_zone_name?: string | null;
  matched_area_name?: string | null;
  shipping_error?: string | null;
  link_error?: string | null;
  carrier_status?: string | null;
  carrier_status_updated_at?: string | null;
  carrier_status_raw?: any;
  carrier_cancellation_reason_id?: string | null;
  carrier_notes?: string | null;
  confirmation_status?: "unconfirmed" | "confirmed" | "no_answer" | "postponed" | "cancelled" | null;
  prep_status?: "pending" | "preparing" | "prepared" | null;
  confirmation_notes?: string | null;
  confirmation_attempts?: number | null;
  postponed_until?: string | null;
  confirmed_at?: string | null;
  is_deleted?: boolean;
  locked_insufficient_balance?: boolean;
  insufficient_stock?: boolean;
  upsell_offers?: any[] | null;
  country_code?: string | null;
}

type ConfirmationStatus = "unconfirmed" | "confirmed" | "no_answer" | "postponed" | "cancelled";

const CONFIRMATION_LABELS: Record<ConfirmationStatus, string> = {
  unconfirmed: "بانتظار التأكيد",
  confirmed: "مؤكد",
  no_answer: "لم يرد",
  postponed: "مؤجل",
  cancelled: "ألغى الطلب",
};

const CONFIRMATION_BADGE_CLASS: Record<ConfirmationStatus, string> = {
  unconfirmed: "bg-muted text-muted-foreground",
  confirmed: "bg-success text-success-foreground",
  no_answer: "bg-warning text-warning-foreground",
  postponed: "bg-accent text-accent-foreground",
  cancelled: "bg-destructive text-destructive-foreground",
};

const ORDER_SELECT_COLS = "id, customer_name, phone, address, city, product_name, product_id, price, status, created_at, selected_color, selected_size, selected_product_code, quantity, shipping_included, shipping_reference, order_code, matched_zone_name, matched_area_name, shipping_error, link_error, carrier_status, carrier_status_updated_at, carrier_status_raw, carrier_cancellation_reason_id, carrier_notes, confirmation_status, confirmation_notes, confirmation_attempts, postponed_until, confirmed_at, is_deleted, locked_insufficient_balance, insufficient_stock, prep_status, upsell_offers, country_code";

// Supabase caps a single query at 1000 rows. Stores can easily exceed that, and
// truncated results made tabs/dropdown counters under-report (e.g. "تم التسليم"
// dropdown only showed orders from the most recent 1000 rows). Paginate to load
// every order for the active store.
const ORDERS_PAGE_SIZE = 1000;
async function fetchAllOrdersForStore(storeId: string) {
  const all: any[] = [];
  for (let from = 0; ; from += ORDERS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("orders")
      .select(ORDER_SELECT_COLS)
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .range(from, from + ORDERS_PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < ORDERS_PAGE_SIZE) break;
  }
  return all;
}

const PREP_LABELS: Record<string, string> = {
  pending: "قيد الانتظار",
  preparing: "جاري التجهيز",
  prepared: "تم التجهيز",
};
const PREP_BADGE_CLASS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  preparing: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30",
  prepared: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30",
};

const statusLabels: Record<Order["status"], string> = {
  pending: "قيد الانتظار",
  processing: "قيد المعالجة",
  shipped: "جاري التوصيل",
  delivered: "تم الاستلام",
  cancelled: "ملغي",
  settled: "تم استلام القيمة المالية",
  returned_received: "تم استلام المرتجع",
  unpacked: "تم التفريغ",
};

const statusColors: Record<Order["status"], string> = {
  pending: "bg-warning text-warning-foreground",
  processing: "bg-primary text-primary-foreground",
  shipped: "bg-accent text-accent-foreground",
  delivered: "bg-success text-success-foreground",
  cancelled: "bg-destructive text-destructive-foreground",
  settled: "bg-success text-success-foreground",
  returned_received: "bg-muted text-muted-foreground",
  unpacked: "bg-secondary text-secondary-foreground",
};

const Orders = () => {
  const { activeStoreId } = useStoreContext();
  const queryClient = useQueryClient();
  const [orders, setOrders] = useState<Order[]>([]);
  // Server-side counts (authoritative — independent of how many rows are loaded).
  const [serverStatusCounts, setServerStatusCounts] = useState<Record<string, number>>({});
  const [serverCarrierCounts, setServerCarrierCounts] = useState<Record<string, number>>({});
  const errorAliases = useShippingErrorAliases();
  const [productsMap, setProductsMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<Order["status"] | "">("");
  const [currencySymbol, setCurrencySymbol] = useState("د.إ");
  const [shipping, setShipping] = useState(false);
  const [shipProgress, setShipProgress] = useState<{ done: number; total: number } | null>(null);
  const [productFilter, setProductFilter] = useState<string>("all");
  const [shippingMode, setShippingMode] = useState<"included" | "excluded">("excluded");
  const [openableMode, setOpenableMode] = useState<"yes" | "no">("yes");
  const [shippingOptionsOpen, setShippingOptionsOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [shippedSearch, setShippedSearch] = useState("");
  const [shippedCarrierFilter, setShippedCarrierFilter] = useState<string>("all");
  const [shippedProductFilter, setShippedProductFilter] = useState<string>("all");
  const [syncingCarrier, setSyncingCarrier] = useState(false);
  const [carrierSyncResult, setCarrierSyncResult] = useState<null | {
    total: number; updated: number; failed: number;
    codes: Array<{ code: string; count: number; label: string; mapped: boolean }>;
  }>(null);
  const [pendingDateFrom, setPendingDateFrom] = useState<string>("");
  const [pendingDateTo, setPendingDateTo] = useState<string>("");
  const [unpackedDateFrom, setUnpackedDateFrom] = useState<string>("");
  const [unpackedDateTo, setUnpackedDateTo] = useState<string>("");
  const [unpackedSearch, setUnpackedSearch] = useState("");
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  const [labelOrderMap, setLabelOrderMap] = useState<Record<string, number>>({});
  const [statusColorMap, setStatusColorMap] = useState<Record<string, string>>({});
  const [statusCategoryMap, setStatusCategoryMap] = useState<Record<string, string>>({});
  const [labelCategoryMap, setLabelCategoryMap] = useState<Record<string, string>>({});
  const [confirmationFilter, setConfirmationFilter] = useState<"all" | ConfirmationStatus>("all");
  const [prepFilter, setPrepFilter] = useState<"all" | "pending" | "preparing" | "prepared">("all");
  const [confirmNoteOpen, setConfirmNoteOpen] = useState<string | null>(null);
  const [confirmNoteValue, setConfirmNoteValue] = useState("");
  const [confirmNoteAction, setConfirmNoteAction] = useState<ConfirmationStatus>("no_answer");
  const [confirmActionLoading, setConfirmActionLoading] = useState<string | null>(null);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<Order | null>(null);
  const [carrierRateProductFilter, setCarrierRateProductFilter] = useState<string>("all");
  const [showDeliveryStats, setShowDeliveryStats] = useState<boolean>(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [stickerSettings, setStickerSettings] = useState<StickerSettings>(DEFAULT_STICKER_SETTINGS);
  const [storeName, setStoreName] = useState<string>("");
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const PAGE_SIZE = 50;
  const [pageMap, setPageMap] = useState<Record<string, number>>({});
  const getPage = (key: string) => pageMap[key] || 1;
  const setPage = (key: string, p: number) => setPageMap((prev) => ({ ...prev, [key]: p }));
  const paginate = <T,>(arr: T[], key: string) => {
    const total = arr.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    let page = getPage(key);
    if (page > totalPages) page = totalPages;
    const start = (page - 1) * PAGE_SIZE;
    return { items: arr.slice(start, start + PAGE_SIZE), page, totalPages, total, key };
  };
  const Pager = ({ p }: { p: { page: number; totalPages: number; total: number; key: string } }) => {
    if (p.total <= PAGE_SIZE) return null;
    return (
      <div className="flex items-center justify-between gap-2 mt-3 px-1 text-xs text-muted-foreground" dir="rtl">
        <span>عرض {(p.page - 1) * PAGE_SIZE + 1}–{Math.min(p.page * PAGE_SIZE, p.total)} من {p.total}</span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" disabled={p.page <= 1} onClick={() => setPage(p.key, p.page - 1)}>السابق</Button>
          <span className="px-2">{p.page} / {p.totalPages}</span>
          <Button size="sm" variant="outline" disabled={p.page >= p.totalPages} onClick={() => setPage(p.key, p.page + 1)}>التالي</Button>
        </div>
      </div>
    );
  };

  const COLOR_CLASSES: Record<string, string> = {
    default: "bg-accent text-accent-foreground",
    blue: "bg-blue-500 text-white",
    sky: "bg-sky-400 text-sky-950",
    indigo: "bg-indigo-600 text-white",
    cyan: "bg-cyan-500 text-white",
    teal: "bg-teal-500 text-white",
    green: "bg-green-600 text-white",
    lime: "bg-lime-500 text-lime-950",
    emerald: "bg-emerald-600 text-white",
    yellow: "bg-yellow-400 text-yellow-950",
    amber: "bg-amber-500 text-amber-950",
    red: "bg-red-600 text-white",
    rose: "bg-rose-600 text-white",
    fuchsia: "bg-fuchsia-600 text-white",
    purple: "bg-purple-600 text-white",
    violet: "bg-violet-600 text-white",
    orange: "bg-orange-500 text-white",
    pink: "bg-pink-500 text-white",
    brown: "bg-amber-800 text-white",
    stone: "bg-stone-500 text-white",
    slate: "bg-slate-600 text-white",
    zinc: "bg-zinc-600 text-white",
    black: "bg-black text-white",
    gray: "bg-gray-500 text-white",
  };

  const carrierStatusClass = (order: Order): string => {
    if (!order.carrier_status) return "bg-muted text-muted-foreground";
    const code = extractStatusCode(order);
    const color = code ? statusColorMap[code] : undefined;
    return COLOR_CLASSES[color || "default"] || COLOR_CLASSES.default;
  };

  const extractStatusCode = (order: Order): string | null => {
    const raw = order.carrier_status_raw;
    if (raw && typeof raw === "object") {
      // Base status code can come from webhook payload (shipmentStatusCode)
      // or from sync-carrier-statuses (status.code)
      let base: any = raw.shipmentStatusCode ?? raw.shipment_status_code;
      if (base == null || base === "") {
        const st = raw.status;
        if (typeof st === "string") base = st;
        else if (st && typeof st === "object") base = st.code ?? st.name;
      }
      if (base != null && base !== "") {
        const baseStr = String(base).trim();
        if (baseStr.toUpperCase() === "DTR") return "DTR";
        const suffix = raw.deliveryTypeCode ?? raw.delivery_type_code
          ?? raw.returnTypeCode ?? raw.return_type_code;
        if (suffix != null && String(suffix).trim() !== "") {
          return baseStr + String(suffix).trim();
        }
        return baseStr;
      }
    }
    // Fallback: parse trailing "(<code>)" from existing carrier_status text
    if (order.carrier_status) {
      const m = order.carrier_status.match(/\(([^)]+)\)\s*$/);
      if (m) return m[1].trim();
      // If it's just a code like "rits" with no parentheses
      if (statusMap[order.carrier_status.trim()]) return order.carrier_status.trim();
    }
    return null;
  };

  const displayCarrierStatus = (order: Order): string => {
    const code = extractStatusCode(order);
    if (code && statusMap[code]) return statusMap[code];
    return order.carrier_status || "في انتظار تحديث من شركة الشحن";
  };

  const getCarrierFilterLabel = (order: Order): string => {
    const code = extractStatusCode(order);
    if (code && statusMap[code]) return statusMap[code];
    return order.carrier_status?.trim() || "";
  };

  const getCarrierStatusCategory = (order: Order): string | undefined => {
    const code = extractStatusCode(order);
    if (code && statusCategoryMap[code]) return statusCategoryMap[code];

    const label = getCarrierFilterLabel(order);
    if (labelCategoryMap[label]) return labelCategoryMap[label];

    const raw = order.carrier_status?.trim() || "";
    const m = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const base = m?.[1]?.trim();
    if (base && labelCategoryMap[base]) return labelCategoryMap[base];

    return undefined;
  };

  const handleCreateManualOrder = async () => {
    setCreating(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) {
        toast({ title: "خطأ", description: "يجب تسجيل الدخول", variant: "destructive" });
        return;
      }
      const { data, error } = await supabase
        .from("orders")
        .insert({
          owner_id: uid,
          store_id: activeStoreId,
          customer_name: "بدون اسم",
          phone: "",
          address: "",
          city: "",
          product_name: "",
          price: 0,
          quantity: 1,
          status: "pending",
        })
        .select(ORDER_SELECT_COLS)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setOrders((prev) => [data as Order, ...prev]);
        setDetailsId(data.id);
      }
    } catch (e: any) {
      toast({ title: "خطأ", description: e?.message || "تعذر إنشاء الطلب", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) {
      toast({ title: "خطأ", description: "يجب أن تكون الملفات صوراً", variant: "destructive" });
      return;
    }
    setExtracting(true);
    let success = 0;
    let failed = 0;
    const corrections: string[] = [];
    try {
      for (const file of images) {
        try {
          const dataUrl: string = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result as string);
            r.onerror = reject;
            r.readAsDataURL(file);
          });
          const { data, error } = await supabase.functions.invoke("extract-order-from-image", {
            body: { image: dataUrl, store_id: activeStoreId },
          });
          if (error) throw error;
          success++;
          const ord = (data as any)?.order;
          const ext = (data as any)?.extracted;
          if (ord) {
            const origCity = ext?.city || "—";
            const origAddr = ext?.address || "—";
            const newCity = ord.matched_zone_name || ord.city || "—";
            const newArea = ord.matched_area_name || "—";
            const changed = newCity !== origCity || newArea !== origAddr;
            corrections.push(
              `• ${ord.customer_name || "بدون اسم"}: ${origCity} / ${origAddr} ← ${newCity} / ${newArea}${changed ? " ✓" : ""}`
            );
          }
        } catch (err: any) {
          console.error("Extract failed for", file.name, err);
          failed++;
        }
      }
      toast({
        title: `تم إنشاء ${success} طلب${failed ? ` — فشل ${failed}` : ""}`,
        description: corrections.length
          ? ((<div className="text-xs space-y-1 mt-1 max-h-48 overflow-y-auto" dir="rtl">
              <div className="font-semibold">المعلومات بعد التصحيح:</div>
              {corrections.map((c, i) => <div key={i}>{c}</div>)}
            </div>) as any)
          : undefined,
        variant: failed && !success ? "destructive" : "default",
      });
      fetchOrders();
    } finally {
      setExtracting(false);
    }
  };

  const handleShipToCompany = async (opts: ShippingOptionsValue) => {
    if (selectedOrders.length === 0) {
      toast({ title: "تنبيه", description: "حدد طلبات أولاً", variant: "destructive" });
      return;
    }
    setShipping(true);
    const lockedIds = selectedOrders.filter((id) => orders.find((o) => o.id === id)?.locked_insufficient_balance);
    const ids = selectedOrders.filter((id) => !orders.find((o) => o.id === id)?.locked_insufficient_balance);
    if (lockedIds.length > 0) {
      toast({ title: "تنبيه", description: `تم تجاهل ${lockedIds.length} طلب مقفل بسبب نفاد الرصيد`, variant: "destructive" });
    }
    if (ids.length === 0) { setShipping(false); return; }
    setShipProgress({ done: 0, total: ids.length });
    let sent = 0;
    let lastError: string | null = null;
    try {
      for (let i = 0; i < ids.length; i++) {
        try {
          const { data, error } = await supabase.functions.invoke("ship-orders", {
            body: {
              order_ids: [ids[i]],
              shipping_included: opts.price_type_code === "INCLD",
              openable: opts.openable_code === "Y",
              type_code: opts.type_code,
              price_type_code: opts.price_type_code,
              payment_type_code: opts.payment_type_code,
              openable_code: opts.openable_code,
            },
          });
          if (error) throw error;
          sent += (data as any)?.sent ?? 0;
        } catch (e: any) {
          lastError = e?.context?.error || e?.message || "حدث خطأ";
        }
        setShipProgress({ done: i + 1, total: ids.length });
      }
      toast({
        title: "تم الإرسال",
        description: `تم إرسال ${sent} من ${ids.length} طلب لشركة الشحن${lastError ? ` (آخر خطأ: ${lastError})` : ""}`,
        variant: lastError && sent === 0 ? "destructive" : "default",
      });
      setSelectedOrders([]);
      fetchOrders();
    } finally {
      setShipping(false);
      setShipProgress(null);
    }
  };

  const ordersQuery = useQuery({
    queryKey: ["orders-page", activeStoreId],
    enabled: !!activeStoreId,
    queryFn: async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      const [ordersRes, currencyRes, mapRes, productsRes, stickerRes, headerRes, walletRes, statusCountsRes, carrierCountsRes] = await Promise.all([
        fetchAllOrdersForStore(activeStoreId!).then((data) => ({ data, error: null as any })).catch((error) => ({ data: null, error })),
        (uid
          ? supabase.from("store_settings").select("currency_symbol").eq("owner_id", uid).maybeSingle()
          : supabase.from("store_settings").select("currency_symbol").limit(1).maybeSingle()),
        supabase.from("carrier_status_mappings").select("status_code, custom_label, color, sort_order, category"),
        supabase.from("products").select("id, name").eq("store_id", activeStoreId!),
        uid
          ? supabase.from("sticker_settings").select("*").eq("owner_id", uid).maybeSingle()
          : Promise.resolve({ data: null } as any),
        supabase.from("header_settings").select("logo_text").eq("store_id", activeStoreId!).maybeSingle(),
        uid
          ? supabase.from("wallets").select("balance").eq("user_id", uid).maybeSingle()
          : Promise.resolve({ data: null } as any),
        supabase.rpc("orders_status_counts", { _store_id: activeStoreId! }),
        supabase.rpc("orders_shipped_carrier_counts", { _store_id: activeStoreId! }),
      ]);
      if (ordersRes.error) throw ordersRes.error;
      return { ordersRes, currencyRes, mapRes, productsRes, stickerRes, headerRes, walletRes, statusCountsRes, carrierCountsRes, uid };
    },
  });

  // Hydrate local state from query result so existing mutation logic keeps working
  useEffect(() => {
    if (!activeStoreId) { setOrders([]); setLoading(false); return; }
    if (ordersQuery.isLoading) { setLoading(true); return; }
    if (ordersQuery.error) {
      console.error("Error fetching orders:", ordersQuery.error);
      toast({ title: "خطأ", description: "حدث خطأ أثناء تحميل الطلبات", variant: "destructive" });
      setLoading(false);
      return;
    }
    const d = ordersQuery.data;
    if (!d) return;
    setOrders((d.ordersRes.data || []) as Order[]);
    if (d.statusCountsRes?.data) {
      const sc: Record<string, number> = {};
      (d.statusCountsRes.data as any[]).forEach((r) => { sc[String(r.status)] = Number(r.cnt) || 0; });
      setServerStatusCounts(sc);
    }
    if (d.productsRes.data) {
      const pm: Record<string, string> = {};
      (d.productsRes.data as any[]).forEach((p) => { if (p?.id && p?.name) pm[p.id] = p.name; });
      setProductsMap(pm);
    }
    if (d.currencyRes.data) setCurrencySymbol(d.currencyRes.data.currency_symbol);
    if (d.stickerRes?.data) {
      const s: any = d.stickerRes.data;
      setStickerSettings({
        page_width_mm: s.page_width_mm ?? 100,
        page_height_mm: s.page_height_mm ?? 150,
        font_size: s.font_size ?? 12,
        header_text: s.header_text ?? "",
        footer_text: s.footer_text ?? "",
        show_barcode: s.show_barcode ?? true,
        show_logo: s.show_logo ?? false,
        fields: Array.isArray(s.fields) && s.fields.length > 0 ? s.fields : DEFAULT_STICKER_SETTINGS.fields,
      });
    }
    if (d.headerRes?.data?.logo_text) setStoreName(d.headerRes.data.logo_text);
    if (d.walletRes?.data) setWalletBalance(Number(d.walletRes.data.balance) || 0);
    else if (d.uid) setWalletBalance(0);
    if (d.mapRes.data) {
      const m: Record<string, string> = {};
      const cm: Record<string, string> = {};
      const lo: Record<string, number> = {};
      const catm: Record<string, string> = {};
      const lcm: Record<string, string> = {};
      (d.mapRes.data as any[]).forEach((r) => {
        m[String(r.status_code)] = r.custom_label;
        if (r.color) cm[String(r.status_code)] = r.color;
        if (r.category) catm[String(r.status_code)] = r.category;
        if (r.custom_label && r.category && !lcm[String(r.custom_label)]) lcm[String(r.custom_label)] = r.category;
        const so = Number(r.sort_order ?? 0);
        if (so > 0) {
          const key = String(r.custom_label);
          if (lo[key] === undefined || so < lo[key]) lo[key] = so;
        }
      });
      setStatusMap(m);
      setStatusColorMap(cm);
      setLabelOrderMap(lo);
      setStatusCategoryMap(catm);
      setLabelCategoryMap(lcm);
    }
    if (d.carrierCountsRes?.data) {
      // RPC returns raw `carrier_status` text like "تم التسليم (DTR)".
      // Re-key by custom_label (via statusMap) so dropdown lookups by label match,
      // and aggregate codes that share the same custom_label.
      const localMap: Record<string, string> = {};
      if (d.mapRes.data) {
        (d.mapRes.data as any[]).forEach((r) => { localMap[String(r.status_code)] = r.custom_label; });
      }
      const cc: Record<string, number> = {};
      (d.carrierCountsRes.data as any[]).forEach((r) => {
        const raw = String(r.label ?? "");
        const n = Number(r.cnt) || 0;
        // Always index by raw label (back-compat for "بدون حالة" etc.)
        cc[raw] = (cc[raw] || 0) + n;
        // Parse trailing "(CODE)" and re-key by custom_label if mapped
        const m = raw.match(/\(([^)]+)\)\s*$/);
        const code = m ? m[1].trim() : raw.trim();
        const customLabel = localMap[code];
        if (customLabel) {
          cc[customLabel] = (cc[customLabel] || 0) + n;
        } else if (m) {
          // Also index by the part before "(CODE)" as a fallback label
          const base = raw.slice(0, m.index).trim();
          if (base) cc[base] = (cc[base] || 0) + n;
        }
      });
      setServerCarrierCounts(cc);
    }
    setLoading(false);
  }, [activeStoreId, ordersQuery.data, ordersQuery.isLoading, ordersQuery.error]);

  useEffect(() => {
    const openId = searchParams.get("open");
    if (openId) {
      setDetailsId(openId);
      const next = new URLSearchParams(searchParams);
      next.delete("open");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);


  const fetchCurrencySettings = async () => {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      const q = supabase.from("store_settings").select("currency_symbol");
      const { data, error } = await (uid ? q.eq("owner_id", uid).maybeSingle() : q.limit(1).maybeSingle());
      if (error) throw error;
      if (data) setCurrencySymbol(data.currency_symbol);
    } catch (error) {
      console.error("Error fetching currency settings:", error);
    }
  };

  const fetchOrders = async () => {
    if (!activeStoreId) { setOrders([]); setLoading(false); return; }
    // Invalidate cached query → triggers refetch and hydration via the effect above
    await queryClient.invalidateQueries({ queryKey: ["orders-page", activeStoreId] });
  };

  const handleSyncCarrierStatuses = async () => {
    if (!activeStoreId) {
      toast({ title: "فشل المزامنة", description: "لم يتم تحديد المتجر الحالي", variant: "destructive" });
      return;
    }
    setSyncingCarrier(true);
    setCarrierSyncResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("sync-carrier-statuses", {
        body: { store_id: activeStoreId },
      });
      if (error) {
        // Edge function non-2xx (e.g. 429 cooldown) — try to surface the server message
        const ctx: any = (error as any)?.context;
        let msg = error.message;
        try {
          const txt = await ctx?.text?.();
          if (txt) {
            try {
              const j = JSON.parse(txt);
              if (j?.message) msg = j.message;
              else if (j?.error) msg = j.error;
            } catch {
              msg = txt;
            }
          }
        } catch {}
        throw new Error(msg);
      }
      if (!data?.ok) throw new Error(data?.message || data?.error || "فشل المزامنة");
      setCarrierSyncResult({
        total: data.total ?? 0,
        updated: data.updated ?? 0,
        failed: data.failed ?? 0,
        codes: data.codes ?? [],
      });
      toast({
        title: "تمت المزامنة",
        description: `تم تحديث ${data.updated} طلب من أصل ${data.total}`,
      });
      await fetchOrders();
    } catch (e: any) {
      toast({ title: "فشل المزامنة", description: e.message, variant: "destructive" });
    } finally {
      setSyncingCarrier(false);
    }
  };

  const handleStatusChange = async (orderId: string, newStatus: Order["status"]) => {
    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: newStatus })
        .eq("id", orderId);

      if (error) throw error;

      setOrders(orders.map((order) =>
        order.id === orderId ? { ...order, status: newStatus } : order
      ));
      
      toast({
        title: "تم التحديث",
        description: "تم تحديث حالة الطلب بنجاح",
      });
    } catch (error) {
      console.error("Error updating order:", error);
      toast({
        title: "خطأ",
        description: "حدث خطأ أثناء تحديث الحالة",
        variant: "destructive",
      });
    }
  };

  const handleConfirmationAction = async (
    order: Order,
    action: ConfirmationStatus,
    notes?: string,
  ) => {
    setConfirmActionLoading(order.id);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      const now = new Date().toISOString();
      const update: any = {
        confirmation_status: action,
        confirmation_attempts: (order.confirmation_attempts || 0) + 1,
      };
      if (action === "confirmed") {
        update.confirmed_at = now;
        update.confirmed_by = uid;
      }
      if (notes !== undefined) update.confirmation_notes = notes || null;
      if (action !== "postponed") update.postponed_until = null;

      const { error } = await supabase.from("orders").update(update).eq("id", order.id);
      if (error) throw error;

      if (uid) {
        await supabase.from("order_confirmation_attempts").insert({
          order_id: order.id,
          owner_id: uid,
          result: action,
          notes: notes || null,
          created_by: uid,
        });
      }

      // If marked cancelled in confirmation flow → cancel the order itself
      if (action === "cancelled") {
        await supabase.from("orders").update({ status: "cancelled" }).eq("id", order.id);
      }

      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id
            ? {
                ...o,
                ...update,
                status: action === "cancelled" ? "cancelled" : o.status,
              }
            : o,
        ),
      );
      toast({ title: "تم", description: `تم تحديث حالة التأكيد: ${CONFIRMATION_LABELS[action]}` });
    } catch (e: any) {
      toast({ title: "خطأ", description: e?.message || "تعذر التحديث", variant: "destructive" });
    } finally {
      setConfirmActionLoading(null);
      setConfirmNoteOpen(null);
      setConfirmNoteValue("");
    }
  };

  const openWhatsApp = (phone: string, customerName: string, productName: string) => {
    const digits = (phone || "").replace(/\D/g, "");
    if (!digits) return;
    const text = encodeURIComponent(
      `السلام عليكم ${customerName || ""}، نتواصل معك لتأكيد طلبك (${productName || ""}). هل التوصيل والمواصفات لا تزال صحيحة؟`,
    );
    window.open(`https://wa.me/${digits}?text=${text}`, "_blank");
  };

  const handleBulkStatusChange = async () => {
    if (selectedOrders.length === 0 || !bulkStatus) {
      toast({
        title: "تنبيه",
        description: "الرجاء تحديد الطلبات والحالة الجديدة",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: bulkStatus })
        .in("id", selectedOrders);

      if (error) throw error;

      setOrders(orders.map((order) =>
        selectedOrders.includes(order.id) ? { ...order, status: bulkStatus } : order
      ));
      
      setSelectedOrders([]);
      setBulkStatus("");
      
      toast({
        title: "تم التحديث",
        description: `تم تحديث ${selectedOrders.length} طلب بنجاح`,
      });
    } catch (error) {
      console.error("Error updating orders:", error);
      toast({
        title: "خطأ",
        description: "حدث خطأ أثناء تحديث الطلبات",
        variant: "destructive",
      });
    }
  };

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrders((prev) =>
      prev.includes(orderId)
        ? prev.filter((id) => id !== orderId)
        : [...prev, orderId]
    );
  };

  const toggleSelectAll = (orderIds: string[]) => {
    if (orderIds.every((id) => selectedOrders.includes(id))) {
      setSelectedOrders((prev) => prev.filter((id) => !orderIds.includes(id)));
    } else {
      setSelectedOrders((prev) => [...new Set([...prev, ...orderIds])]);
    }
  };

  const handleBulkDelete = async (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    try {
      const { error } = await supabase.from("orders").update({ is_deleted: true }).in("id", orderIds);
      if (error) throw error;
      setOrders((prev) => prev.map((o) => orderIds.includes(o.id) ? { ...o, is_deleted: true } : o));
      setSelectedOrders((prev) => prev.filter((id) => !orderIds.includes(id)));
      toast({ title: "تم النقل للمحذوفة", description: `تم نقل ${orderIds.length} طلب لقائمة المحذوفة. يمكنك استرجاعها لاحقًا.` });
    } catch (e) {
      console.error(e);
      toast({ title: "خطأ", description: "حدث خطأ أثناء الحذف", variant: "destructive" });
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      const { error } = await supabase
        .from("orders")
        .update({ is_deleted: true })
        .eq("id", orderId);

      if (error) throw error;

      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, is_deleted: true } : o));
      setSelectedOrders((prev) => prev.filter((id) => id !== orderId));
      
      toast({
        title: "تم النقل للمحذوفة",
        description: "نُقل الطلب لقائمة المحذوفة. يمكنك استرجاعه لاحقًا.",
      });
    } catch (error) {
      console.error("Error deleting order:", error);
      toast({
        title: "خطأ",
        description: "حدث خطأ أثناء حذف الطلب",
        variant: "destructive",
      });
    }
  };

  const handleRestoreOrder = async (orderId: string) => {
    try {
      const { error } = await supabase
        .from("orders")
        .update({ is_deleted: false, status: "pending" })
        .eq("id", orderId);
      if (error) throw error;
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, is_deleted: false, status: "pending" } : o));
      toast({ title: "تم الاسترجاع", description: "أُعيد الطلب إلى قيد الانتظار." });
    } catch (e: any) {
      toast({ title: "خطأ", description: e?.message || "تعذر الاسترجاع", variant: "destructive" });
    }
  };
  const handlePermanentDelete = async (orderId: string) => {
    try {
      const { error: itemsError } = await supabase
        .from("order_items")
        .delete()
        .eq("order_id", orderId);
      if (itemsError) throw itemsError;

      const { error } = await supabase
        .from("orders")
        .delete()
        .eq("id", orderId);
      if (error) throw error;

      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      setSelectedOrders((prev) => prev.filter((id) => id !== orderId));
      setPermanentDeleteTarget(null);
      toast({
        title: "تم الحذف نهائياً",
        description: "تم حذف الطلب من النظام بشكل نهائي ولا يمكن استرجاعه.",
      });
    } catch (e: any) {
      console.error("Error permanently deleting order:", e);
      toast({
        title: "خطأ",
        description: e?.message || "حدث خطأ أثناء الحذف النهائي",
        variant: "destructive",
      });
    }
  };

  const handleBulkPermanentDelete = async (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    try {
      const { error: itemsError } = await supabase
        .from("order_items")
        .delete()
        .in("order_id", orderIds);
      if (itemsError) throw itemsError;

      const { error } = await supabase
        .from("orders")
        .delete()
        .in("id", orderIds);
      if (error) throw error;

      setOrders((prev) => prev.filter((o) => !orderIds.includes(o.id)));
      setSelectedOrders((prev) => prev.filter((id) => !orderIds.includes(id)));
      toast({
        title: "تم الحذف نهائياً",
        description: `تم حذف ${orderIds.length} طلب من النظام بشكل نهائي ولا يمكن استرجاعهم.`,
      });
    } catch (e: any) {
      console.error("Error bulk permanently deleting orders:", e);
      toast({
        title: "خطأ",
        description: e?.message || "حدث خطأ أثناء الحذف النهائي الجماعي",
        variant: "destructive",
      });
    }
  };
  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    const date = d.toLocaleDateString("ar-AE", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const time = d.toLocaleTimeString("ar-AE", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    return `${date} • ${time}`;
  };

  const exportPendingOrders = () => {
    if (pendingOrders.length === 0) {
      toast({
        title: "تنبيه",
        description: "لا توجد طلبات قيد الانتظار للتصدير",
        variant: "destructive",
      });
      return;
    }
    const lockedCount = pendingOrders.filter((o) => o.locked_insufficient_balance).length;
    if (lockedCount > 0 || (walletBalance !== null && walletBalance < 0)) {
      toast({
        title: "تنبيه",
        description: "لا يمكن التصدير — رصيد المحفظة غير كافٍ أو توجد طلبات مقفلة.",
        variant: "destructive",
      });
      return;
    }

    // تنسيق ملف الإكسل المطلوب من شركة الشحن
    const excelData = pendingOrders.map((order, index) => {
      const cityCorrected = (order as any).matched_zone_name || order.city;
      const areaCorrected = (order as any).matched_area_name || (order as any).matched_zone_name || order.city;
      const productName = isolateLatin(order.product_name);
      const notes = isolateLatin(order.selected_size || order.selected_color || "");
      const address = isolateLatin(order.address);
      const customerName = isolateLatin(order.customer_name);
      return {
        "رقم السطر": index + 1,
        "الخدمة": "شحن عادي",
        "نوع الطلب": "FDP",
        "اسم المرسل اليه": customerName,
        "المحافظه": cityCorrected,
        "اسم المنطقه": areaCorrected,
        "رقم الموبايل": order.phone,
        "رقم الهاتف": order.phone,
        "الرمز البريدي للمرسل اليه": "",
        "العنوان": address,
        "خط الطول": "",
        "خط العرض": "",
        "وصف الطرد": productName,
        "عدد القطع": order.quantity || 1,
        "الوزن": 1,
        "السعر": Number(order.price) || 0,
        "نوع السعر": shippingMode === "included" ? "INCLD" : "EXCLD",
        "نوع التحصيل": "COLC",
        "رقم المرجع": order.id.slice(0, 12).toUpperCase(),
        "ملاحظات": notes,
        "رقم البولويصة": "",
        "الراسل الفرعي": "",
        "المحافظة": cityCorrected,
        "المنطقة": areaCorrected,
        "رقم الموبايل ": order.phone,
        "رقم الهاتف ": order.phone,
        "الرمز البريدي للراسل": "",
        "العنوان ": address,
        "فتح الطرد": openableMode === "yes" ? "Y" : "N",
        "فئة العملات": "ANY",
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    ws["!cols"] = Array(30).fill({ wch: 16 });

    XLSX.utils.book_append_sheet(wb, ws, "Orders");

    // Generate filename with date
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, "");
    const filename = `orders_${dateStr}_${timeStr}.xlsx`;

    // Save file
    XLSX.writeFile(wb, filename);

    toast({
      title: "تم التصدير",
      description: `تم تصدير ${pendingOrders.length} طلب بنجاح`,
    });
  };

  const exportShippedOrders = () => {
    if (shippedOrders.length === 0) {
      toast({
        title: "تنبيه",
        description: "لا توجد طلبات للتصدير",
        variant: "destructive",
      });
      return;
    }
    const rows = shippedOrders.map((o, i) => {
      const updated = o.carrier_status_updated_at
        ? new Date(o.carrier_status_updated_at).toLocaleString("ar-LY")
        : "";
      return {
        "#": i + 1,
        "رقم الطلب": o.order_code || o.id.slice(0, 8),
        "التاريخ": new Date(o.created_at).toLocaleString("ar-LY"),
        "اسم العميل": o.customer_name || "",
        "رقم الهاتف": o.phone || "",
        "العنوان": o.address || "",
        "المحافظة": (o as any).matched_zone_name || o.city || "",
        "المنطقة": (o as any).matched_area_name || "",
        "اسم المنتج": o.product_name || "",
        "اللون": o.selected_color || "",
        "المقاس": o.selected_size || "",
        "كود المنتج": o.selected_product_code || "",
        "عدد القطع": o.quantity || 1,
        "السعر الإجمالي": Number(o.price) || 0,
        "شامل الشحن": o.shipping_included ? "نعم" : "لا",
        "رقم البوليصة (كود شركة التوصيل)": o.shipping_reference || "",
        "حالة النظام المحلي": statusLabels[o.status] || o.status,
        "حالة شركة التوصيل": o.carrier_status || "",
        "آخر تحديث من الشركة": updated,
        "ملاحظات الشركة": (o as any).carrier_notes || "",
        "سبب الإلغاء من الشركة": (o as any).carrier_cancellation_reason_id || "",
      };
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Array(21).fill({ wch: 18 });
    XLSX.utils.book_append_sheet(wb, ws, "Shipped");
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, "");
    XLSX.writeFile(wb, `shipped_orders_${dateStr}_${timeStr}.xlsx`);
    toast({
      title: "تم التصدير",
      description: `تم تصدير ${shippedOrders.length} طلب`,
    });
  };

  const displayProductName = (o: Order): string =>
    (o.product_id && productsMap[o.product_id]) || o.product_name || "";
  // Local sequential code per order: assigned in creation order (oldest = 01)
  const localCodeMap: Record<string, string> = (() => {
    const sorted = [...orders].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const map: Record<string, string> = {};
    sorted.forEach((o, i) => {
      map[o.id] = String(i + 1).padStart(2, "0");
    });
    return map;
  })();
  const productNames = Array.from(
    new Set(orders.map(displayProductName).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "ar"));
  // Foreign orders (country_code present and not LY) get their own tab so
  // the user can review them before shipping. Anything without a code or
  // explicitly LY stays in the regular Pending flow.
  const isForeign = (o: any) => {
    const cc = (o.country_code || "").toUpperCase();
    return cc && cc !== "LY";
  };
  const allPending = orders.filter(
    (o) => o.status === "pending" && !o.is_deleted && !isForeign(o)
  );
  const foreignOrders = orders.filter(
    (o) => !o.is_deleted && isForeign(o)
  );
  const pendingOrders = allPending.filter((o) => {
    if (productFilter !== "all" && displayProductName(o) !== productFilter) return false;
    if (confirmationFilter !== "all") {
      const cs = (o.confirmation_status as ConfirmationStatus | null) || "unconfirmed";
      if (cs !== confirmationFilter) return false;
    }
    if (prepFilter !== "all") {
      const ps = (o.prep_status as any) || "pending";
      if (ps !== prepFilter) return false;
    }
    if (pendingDateFrom) {
      const from = new Date(pendingDateFrom);
      from.setHours(0, 0, 0, 0);
      if (new Date(o.created_at) < from) return false;
    }
    if (pendingDateTo) {
      const to = new Date(pendingDateTo);
      to.setHours(23, 59, 59, 999);
      if (new Date(o.created_at) > to) return false;
    }
    return true;
  });
  const confirmationCounts = (() => {
    const c: Record<ConfirmationStatus, number> = {
      unconfirmed: 0, confirmed: 0, no_answer: 0, postponed: 0, cancelled: 0,
    };
    allPending.forEach((o) => {
      const k = ((o.confirmation_status as ConfirmationStatus | null) || "unconfirmed");
      c[k] = (c[k] || 0) + 1;
    });
    return c;
  })();
  const allShipped = orders.filter((o) => o.status === "shipped" && !o.is_deleted);
  const shippedSearchNorm = shippedSearch.trim().toLowerCase();
  // Group by displayed label so codes that share the same custom_label
  // (merged in shipping settings) appear as a single filter option.
  const shippedCarrierOptions = (() => {
    const byLabel = new Map<string, string>(); // label -> first code seen
    let hasNone = false;
    for (const o of allShipped) {
      const code = extractStatusCode(o);
      const label = getCarrierFilterLabel(o);
      if (label) {
        if (!byLabel.has(label)) byLabel.set(label, code || `label:${label}`);
      } else {
        hasNone = true;
      }
    }
    const opts = Array.from(byLabel.entries()).map(([label, code]) => ({
      code: `label:${label}`,
      label,
      matchCode: code,
    }));
    opts.sort((a, b) => {
      const ao = labelOrderMap[a.label];
      const bo = labelOrderMap[b.label];
      if (ao !== undefined && bo !== undefined) return ao - bo;
      if (ao !== undefined) return -1;
      if (bo !== undefined) return 1;
      return a.label.localeCompare(b.label, "ar");
    });
    if (hasNone) opts.push({ code: "__none__", label: "بدون حالة", matchCode: "" });
    return opts;
  })();
  const shippedOrders = allShipped.filter((o) => {
    if (shippedSearchNorm) {
      const matches =
        (o.shipping_reference || "").toLowerCase().includes(shippedSearchNorm) ||
        (o.phone || "").toLowerCase().includes(shippedSearchNorm);
      if (!matches) return false;
    }
    if (shippedCarrierFilter !== "all") {
      const code = extractStatusCode(o);
      const label = getCarrierFilterLabel(o);
      if (shippedCarrierFilter === "__none__") {
        if (label) return false;
      } else if (shippedCarrierFilter.startsWith("label:")) {
        const wanted = shippedCarrierFilter.slice("label:".length);
        if (label !== wanted) return false;
      } else if (code !== shippedCarrierFilter) {
        return false;
      }
    }
    if (shippedProductFilter !== "all" && displayProductName(o) !== shippedProductFilter) return false;
    return true;
  });
  const deliveredOrders = orders.filter((o) => (o.status === "delivered" || o.status === "settled") && !o.is_deleted);
  const cancelledOrders = orders.filter((o) => o.status === "cancelled" && !o.is_deleted);
  const returnedReceivedOrders = orders.filter((o) => o.status === "returned_received" && !o.is_deleted);
  const deletedOrders = orders.filter((o) => !!o.is_deleted);
  const unpackedSearchNorm = unpackedSearch.trim().toLowerCase();
  const unpackedOrders = orders.filter((o) => {
    if (o.status !== "unpacked" || o.is_deleted) return false;
    if (unpackedSearchNorm) {
      const matches =
        (o.shipping_reference || "").toLowerCase().includes(unpackedSearchNorm) ||
        (o.phone || "").toLowerCase().includes(unpackedSearchNorm) ||
        (o.customer_name || "").toLowerCase().includes(unpackedSearchNorm);
      if (!matches) return false;
    }
    if (unpackedDateFrom) {
      const from = new Date(unpackedDateFrom);
      from.setHours(0, 0, 0, 0);
      if (new Date(o.created_at) < from) return false;
    }
    if (unpackedDateTo) {
      const to = new Date(unpackedDateTo);
      to.setHours(23, 59, 59, 999);
      if (new Date(o.created_at) > to) return false;
    }
    return true;
  });

  // Delivery rate by confirmation status — only orders that were sent to shipping
  const shippedFinalStatuses = new Set(["shipped", "delivered", "settled", "returned_received", "unpacked", "cancelled"]);
  const sentToCarrier = orders.filter((o) => !!o.shipping_reference || shippedFinalStatuses.has(o.status));
  const isConfirmed = (o: Order) => o.confirmation_status === "confirmed";
  const isDelivered = (o: Order) => o.status === "delivered" || o.status === "settled";
  const confirmedSent = sentToCarrier.filter(isConfirmed);
  const unconfirmedSent = sentToCarrier.filter((o) => !isConfirmed(o));
  const confirmedDelivered = confirmedSent.filter(isDelivered).length;
  const unconfirmedDelivered = unconfirmedSent.filter(isDelivered).length;
  const confirmedRate = confirmedSent.length > 0
    ? Math.round((confirmedDelivered / confirmedSent.length) * 100)
    : 0;
  const unconfirmedRate = unconfirmedSent.length > 0
    ? Math.round((unconfirmedDelivered / unconfirmedSent.length) * 100)
    : 0;

  // نسبة التسليم بناءً على تصنيف أكواد حالات شركة الشحن
  // (تم التسليم / راجع / قيد التنفيذ) — يعتمد على التصنيف المحدد في إعدادات الشحن.
  // اعرض فقط منتجات النظام الرئيسية (الموجودة في جدول المنتجات)
  const mainProductNames = new Set(Object.values(productsMap));
  const carrierRateProductOptions = Array.from(mainProductNames)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ar"));
  const carrierRateOrders =
    carrierRateProductFilter === "all"
      ? orders
      : orders.filter(
          (o) =>
            ((o.product_id && productsMap[o.product_id]) || o.product_name) ===
            carrierRateProductFilter,
        );
  const carrierCategoryCounts = carrierRateOrders.reduce(
    (acc, o) => {
      const cat = getCarrierStatusCategory(o);
      if (cat === "delivered") acc.delivered += 1;
      else if (cat === "returned") acc.returned += 1;
      else if (cat === "in_progress") acc.in_progress += 1;
      return acc;
    },
    { delivered: 0, returned: 0, in_progress: 0 },
  );
  const carrierCategorizedTotal =
    carrierCategoryCounts.delivered + carrierCategoryCounts.returned + carrierCategoryCounts.in_progress;
  const carrierDeliveryRate = carrierCategorizedTotal > 0
    ? Math.round((carrierCategoryCounts.delivered / carrierCategorizedTotal) * 100)
    : 0;
  const carrierReturnRate = carrierCategorizedTotal > 0
    ? Math.round((carrierCategoryCounts.returned / carrierCategorizedTotal) * 100)
    : 0;
  const carrierInProgressRate = carrierCategorizedTotal > 0
    ? Math.round((carrierCategoryCounts.in_progress / carrierCategorizedTotal) * 100)
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const normalizePhone = (p: string | null | undefined) => (p || "").replace(/\D/g, "");
  const pendingPhoneCounts: Record<string, number> = {};
  pendingOrders.forEach((o) => {
    const k = normalizePhone(o.phone);
    if (!k) return;
    pendingPhoneCounts[k] = (pendingPhoneCounts[k] || 0) + 1;
  });

  type StickerVariantItem = {
    color?: string | null;
    size?: string | null;
    product_code?: string | null;
    product_name?: string | null;
  };

  const splitVariantValue = (value?: string | null): string[] =>
    (value || "")
      .split(/[،,]/)
      .map((part) => part.trim())
      .filter(Boolean);

  const buildFallbackStickerItems = (o: Order): StickerVariantItem[] => {
    const colors = splitVariantValue(o.selected_color);
    const sizes = splitVariantValue(o.selected_size);
    const codes = splitVariantValue(o.selected_product_code);
    const maxLength = Math.max(colors.length, sizes.length, codes.length);

    if (maxLength <= 1) return [];

    return Array.from({ length: maxLength }, (_, index) => ({
      color: colors[index] ?? (colors.length === 1 ? colors[0] : null) ?? null,
      size: sizes[index] ?? (sizes.length === 1 ? sizes[0] : null) ?? null,
      product_code: codes[index] ?? (codes.length === 1 ? codes[0] : null) ?? null,
      product_name: o.product_name ?? null,
    }));
  };

  const toStickerOrder = (o: Order, items?: StickerVariantItem[]): StickerOrder => ({
    id: o.id,
    customer_name: o.customer_name,
    phone: o.phone,
    address: o.address,
    city: o.city,
    matched_zone_name: o.matched_zone_name,
    matched_area_name: o.matched_area_name,
    product_name: o.product_name,
    selected_color: o.selected_color,
    selected_size: o.selected_size,
    selected_product_code: o.selected_product_code,
    quantity: o.quantity ?? null,
    price: o.price ?? null,
    shipping_reference: o.shipping_reference ?? null,
    carrier_status: displayCarrierStatus(o),
    created_at: o.created_at,
    local_code: localCodeMap[o.id] || null,
    items: items && items.length ? items : buildFallbackStickerItems(o),
  });

  const printOrders = async (orderList: Order[]) => {
    if (orderList.length === 0) {
      toast({ title: "تنبيه", description: "لا توجد طلبات للطباعة", variant: "destructive" });
      return;
    }
    // Fetch order_items for accurate per-piece color/size pairing
    let itemsByOrder: Record<string, StickerVariantItem[]> = {};
    try {
      const ids = orderList.map((o) => o.id);
      const { data } = await supabase
        .from("order_items")
        .select("order_id, selected_color, selected_size, selected_product_code, product_name")
        .in("order_id", ids);
      (data || []).forEach((it: any) => {
        (itemsByOrder[it.order_id] ||= []).push({
          color: it.selected_color ?? null,
          size: it.selected_size ?? null,
          product_code: it.selected_product_code ?? null,
          product_name: it.product_name ?? null,
        });
      });
    } catch (_) {
      // fallback: no items, sticker will fall back to flat fields
    }
    printStickers(
      orderList.map((o) => toStickerOrder(o, itemsByOrder[o.id])),
      stickerSettings,
      { currencySymbol, storeName },
    );
  };

  const renderOrderCard = (order: Order, showCheckbox: boolean = false, duplicateCount: number = 0) => (
    <Card
      key={order.id}
      className={`card-shadow animate-slide-up ${duplicateCount > 1 ? "border-2 border-destructive bg-destructive/5" : ""}`}
    >
      <CardContent className="p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            {showCheckbox && (
              <Checkbox
                checked={selectedOrders.includes(order.id)}
                onCheckedChange={() => toggleOrderSelection(order.id)}
                className="mt-1"
              />
            )}
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="font-mono" title="كود الطلب المحلي">
                  <Hash className="w-3 h-3 ml-1" />
                  {localCodeMap[order.id] || "—"}
                </Badge>
                <h3 className="font-semibold text-foreground">{order.locked_insufficient_balance ? "•••••• ••••" : order.customer_name}</h3>
                <Badge className={statusColors[order.status]}>
                  {statusLabels[order.status]}
                </Badge>
                {order.locked_insufficient_balance && (
                  <Badge variant="destructive" className="gap-1">🔒 محظور — رصيد غير كافٍ</Badge>
                )}
                {order.insufficient_stock && (
                  <Badge variant="destructive" className="gap-1">⚠ مخزون غير كافٍ</Badge>
                )}
                {order.country_code && order.country_code.toUpperCase() !== "LY" && (
                  <Badge variant="destructive" className="gap-1 bg-orange-600 hover:bg-orange-600">
                    <Globe className="w-3 h-3" />
                    من خارج ليبيا ({order.country_code})
                  </Badge>
                )}
                {(() => {
                  const cs = ((order.confirmation_status as ConfirmationStatus | null) || "unconfirmed");
                  return (
                    <Badge className={CONFIRMATION_BADGE_CLASS[cs]} title={order.confirmation_notes || undefined}>
                      {CONFIRMATION_LABELS[cs]}
                      {cs === "postponed" && order.postponed_until ? ` (${formatDate(order.postponed_until)})` : ""}
                      {(order.confirmation_attempts || 0) > 0 ? ` · ${order.confirmation_attempts} محاولة` : ""}
                    </Badge>
                  );
                })()}
                {(() => {
                  const ps = (order.prep_status as any) || "pending";
                  return (
                    <Badge className={PREP_BADGE_CLASS[ps]}>
                      التجهيز: {PREP_LABELS[ps]}
                    </Badge>
                  );
                })()}
                {duplicateCount > 1 && (
                  <Badge variant="destructive">
                    رقم مكرر ×{duplicateCount}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Phone className="w-4 h-4" />
                  <span dir="ltr">{order.locked_insufficient_balance ? "•••••••••" : order.phone}</span>
                </span>
                <span className="flex items-center gap-1">
                  <MapPin className="w-4 h-4" />
                  {order.locked_insufficient_balance ? "••••••••••" : `${order.address}، ${order.city}`}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {formatDate(order.created_at)}
                </span>
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-foreground">{isolateLatin(order.product_name)}</span>
                <span className="text-primary font-bold">{order.price} {currencySymbol}</span>
                {Array.isArray(order.upsell_offers) && order.upsell_offers.length > 0 && (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 gap-1">
                    عروض تخفيض
                  </Badge>
                )}
                {order.order_code && (
                  <Badge variant="outline" className="font-mono">
                    كود الشحنة: {order.order_code}
                  </Badge>
                )}
                {order.shipping_reference && (
                  <Badge className={carrierStatusClass(order)}>
                    حالة شركة التوصيل: {displayCarrierStatus(order)}
                  </Badge>
                )}
                {order.shipping_reference && (
                  <Badge variant="outline" className="font-mono">
                    رقم شركة الشحن: {order.shipping_reference}
                  </Badge>
                )}
              </div>
              {(order.carrier_cancellation_reason_id || order.carrier_notes) && (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs space-y-1">
                  {order.carrier_cancellation_reason_id && (
                    <div>
                      <span className="font-bold ml-1">سبب الإلغاء:</span>
                      <span className="text-foreground/80">{order.carrier_cancellation_reason_id}</span>
                    </div>
                  )}
                  {order.carrier_notes && (
                    <div>
                      <span className="font-bold ml-1">ملاحظات شركة الشحن:</span>
                      <span className="text-foreground/80 whitespace-pre-wrap">{order.carrier_notes}</span>
                    </div>
                  )}
                </div>
              )}
              {order.link_error && (
                <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                  <span className="font-bold ml-1">⚠ تعذر الربط التلقائي:</span>
                  <span className="text-foreground/80">{order.link_error}</span>
                </div>
              )}
              {order.shipping_error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                  <span className="font-bold ml-1 text-destructive">✕ فشل الإرسال لشركة الشحن:</span>
                  {matchShippingError(order.shipping_error, errorAliases) && (
                    <span className="inline-block bg-destructive text-destructive-foreground rounded px-2 py-0.5 mx-1 font-bold">
                      {matchShippingError(order.shipping_error, errorAliases)}
                    </span>
                  )}
                  <span className="text-foreground/80">{order.shipping_error}</span>
                </div>
              )}
              <EditMatchedCity
                orderId={order.id}
                city={order.matched_zone_name}
                area={order.matched_area_name}
                originalCity={order.city}
                originalAddress={order.address}
                onSaved={(nc, na) => setOrders((prev) => prev.map((p) => p.id === order.id ? { ...p, matched_zone_name: nc, matched_area_name: na } : p))}
              />
              {order.confirmation_notes && (
                <div className="text-xs text-muted-foreground italic pt-1">
                  📝 {order.confirmation_notes}
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2 w-full md:w-auto">
            <Button variant="outline" size="icon" onClick={() => setDetailsId(order.id)} title="تفاصيل وتعديل">
              <Eye className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => printOrders([order])}
              title="طباعة ستيكر بيانات الشحنة"
            >
              <Printer className="w-4 h-4" />
            </Button>
            
            {(order.status === "pending" || order.status === "shipped") && !order.is_deleted && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="icon">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>نقل الطلب للمحذوفة؟</AlertDialogTitle>
                    <AlertDialogDescription>
                      سيتم نقل طلب {order.customer_name} لقائمة المحذوفة. يمكنك استرجاعه لاحقًا من تبويب "محذوفة".
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>إلغاء</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleDeleteOrder(order.id)}>
                      حذف
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {order.is_deleted && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => handleRestoreOrder(order.id)}
                  title="استرجاع لقيد الانتظار"
                >
                  <RotateCcw className="w-4 h-4" />
                  استرجاع
                </Button>
                <AlertDialog open={permanentDeleteTarget?.id === order.id} onOpenChange={(open) => !open && setPermanentDeleteTarget(null)}>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-1"
                      onClick={() => setPermanentDeleteTarget(order)}
                    >
                      <Trash2 className="w-4 h-4" />
                      حذف نهائي
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>حذف نهائي من النظام</AlertDialogTitle>
                      <AlertDialogDescription>
                        سيتم حذف طلب {order.customer_name} بشكل نهائي من النظام. هذا الإجراء لا رجعة فيه.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel onClick={() => setPermanentDeleteTarget(null)}>إلغاء</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handlePermanentDelete(order.id)}
                        className="bg-red-600 hover:bg-red-700 text-white"
                      >
                        حذف نهائي
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const renderEmptyState = (icon: React.ReactNode, message: string) => (
    <Card className="card-shadow">
      <CardContent className="flex flex-col items-center justify-center py-12">
        {icon}
        <p className="text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        icon={ShoppingCart}
        title="الطلبيات"
        description="إدارة طلبات العملاء"
        iconGradient="from-blue-500 to-indigo-600"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 border-amber-500/20 hover:shadow-lg transition-shadow">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white flex items-center justify-center shadow-md shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{serverStatusCounts.pending ?? pendingOrders.length}</p>
              <p className="text-muted-foreground text-sm">قيد الانتظار</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/5 border-blue-500/20 hover:shadow-lg transition-shadow">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 text-white flex items-center justify-center shadow-md shrink-0">
              <Truck className="w-6 h-6" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{serverStatusCounts.shipped ?? shippedOrders.length}</p>
              <p className="text-muted-foreground text-sm">جاري التوصيل</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-emerald-500/10 to-green-500/5 border-emerald-500/20 hover:shadow-lg transition-shadow">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-green-500 text-white flex items-center justify-center shadow-md shrink-0">
              <CheckCircle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{(serverStatusCounts.delivered ?? 0) + (serverStatusCounts.settled ?? 0) || deliveredOrders.length}</p>
              <p className="text-muted-foreground text-sm">تم الاستلام</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-rose-500/10 to-red-500/5 border-rose-500/20 hover:shadow-lg transition-shadow">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-red-500 text-white flex items-center justify-center shadow-md shrink-0">
              <XCircle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{serverStatusCounts.cancelled ?? cancelledOrders.length}</p>
              <p className="text-muted-foreground text-sm">ملغي</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* زر إظهار/إخفاء إحصائيات نسبة التسليم */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDeliveryStats((v) => !v)}
          className="gap-2 shadow-sm hover:shadow-md transition-shadow border-primary/30 text-primary hover:bg-primary/5"
        >
          {showDeliveryStats ? <EyeOff className="w-4 h-4" /> : <BarChart3 className="w-4 h-4" />}
          {showDeliveryStats ? "إخفاء نسب التسليم" : "إظهار نسب التسليم"}
        </Button>
      </div>

      {showDeliveryStats && (
      <>
      {/* نسبة التسليم حسب حالة التأكيد */}
      <Card className="card-shadow">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-foreground">نسبة التسليم حسب حالة التأكيد (للطلبات المرسلة لشركة الشحن)</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border-2 border-success/30 bg-success/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-4 h-4 text-success" />
                <span className="font-semibold text-foreground">الطلبات المؤكدة</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-success">{confirmedRate}%</span>
                <span className="text-sm text-muted-foreground">
                  ({confirmedDelivered} من {confirmedSent.length})
                </span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full mt-2 overflow-hidden">
                <div className="h-full bg-success transition-all" style={{ width: `${confirmedRate}%` }} />
              </div>
            </div>
            <div className="rounded-lg border-2 border-warning/30 bg-warning/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <ShieldAlert className="w-4 h-4 text-warning" />
                <span className="font-semibold text-foreground">الطلبات بدون تأكيد</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-warning">{unconfirmedRate}%</span>
                <span className="text-sm text-muted-foreground">
                  ({unconfirmedDelivered} من {unconfirmedSent.length})
                </span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full mt-2 overflow-hidden">
                <div className="h-full bg-warning transition-all" style={{ width: `${unconfirmedRate}%` }} />
              </div>
            </div>
          </div>
          {confirmedSent.length > 0 && unconfirmedSent.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              💡 الفرق: {confirmedRate - unconfirmedRate > 0 ? `+${confirmedRate - unconfirmedRate}` : confirmedRate - unconfirmedRate}% لصالح الطلبات المؤكدة
            </p>
          )}
        </CardContent>
      </Card>

      {/* نسبة التسليم بناءً على حالات شركة الشحن المصنّفة */}
      <Card className="card-shadow">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              <h3 className="font-bold text-foreground">نسبة التسليم حسب حالات شركة الشحن</h3>
            </div>
            <Select value={carrierRateProductFilter} onValueChange={setCarrierRateProductFilter}>
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="اختر المنتج" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المنتجات</SelectItem>
                {carrierRateProductOptions.filter(Boolean).map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {carrierCategorizedTotal === 0 ? (
            <p className="text-sm text-muted-foreground">
              لم يتم تصنيف أي حالة بعد. اذهب إلى <span className="font-semibold">إعدادات الشحن ← تخصيص أسماء حالات الشحن</span> وحدد لكل كود تصنيفه (تم التسليم / راجع / قيد التنفيذ) ليظهر الاحتساب هنا.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-lg border-2 border-success/30 bg-success/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-4 h-4 text-success" />
                    <span className="font-semibold text-foreground">تم التسليم</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-success">{carrierDeliveryRate}%</span>
                    <span className="text-sm text-muted-foreground">
                      ({carrierCategoryCounts.delivered} من {carrierCategorizedTotal})
                    </span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full mt-2 overflow-hidden">
                    <div className="h-full bg-success transition-all" style={{ width: `${carrierDeliveryRate}%` }} />
                  </div>
                </div>
                <div className="rounded-lg border-2 border-destructive/30 bg-destructive/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="w-4 h-4 text-destructive" />
                    <span className="font-semibold text-foreground">راجع</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-destructive">{carrierReturnRate}%</span>
                    <span className="text-sm text-muted-foreground">
                      ({carrierCategoryCounts.returned} من {carrierCategorizedTotal})
                    </span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full mt-2 overflow-hidden">
                    <div className="h-full bg-destructive transition-all" style={{ width: `${carrierReturnRate}%` }} />
                  </div>
                </div>
                <div className="rounded-lg border-2 border-warning/30 bg-warning/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-warning" />
                    <span className="font-semibold text-foreground">قيد التنفيذ</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-warning">{carrierInProgressRate}%</span>
                    <span className="text-sm text-muted-foreground">
                      ({carrierCategoryCounts.in_progress} من {carrierCategorizedTotal})
                    </span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full mt-2 overflow-hidden">
                    <div className="h-full bg-warning transition-all" style={{ width: `${carrierInProgressRate}%` }} />
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                يتم احتساب النسب من إجمالي الطلبات المصنّفة فقط ({carrierCategorizedTotal} طلب). لتعديل التصنيفات اذهب إلى إعدادات الشحن.
              </p>
            </>
          )}
        </CardContent>
      </Card>
      </>
      )}

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-9 h-auto p-1 sm:p-1.5 bg-muted/40 rounded-xl gap-1.5">
          <TabsTrigger value="pending" className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 sm:py-2 rounded-lg border border-border/50 bg-card shadow-sm data-[state=active]:bg-gradient-to-br data-[state=active]:from-amber-500 data-[state=active]:to-orange-500 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:border-transparent transition-all">
            <Clock className="w-5 h-5 sm:w-4 sm:h-4" />
            <span className="text-[11px] sm:text-xs font-medium leading-tight">قيد الانتظار</span>
            <span className="text-[11px] sm:text-xs font-bold">({serverStatusCounts.pending ?? pendingOrders.length})</span>
          </TabsTrigger>
          <TabsTrigger value="foreign" className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 sm:py-2 rounded-lg border border-border/50 bg-card shadow-sm data-[state=active]:bg-gradient-to-br data-[state=active]:from-orange-600 data-[state=active]:to-red-600 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:border-transparent transition-all">
            <Globe className="w-5 h-5 sm:w-4 sm:h-4" />
            <span className="text-[11px] sm:text-xs font-medium leading-tight">من خارج ليبيا</span>
            <span className="text-[11px] sm:text-xs font-bold">({foreignOrders.length})</span>
          </TabsTrigger>
          <TabsTrigger value="shipped" className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 sm:py-2 rounded-lg border border-border/50 bg-card shadow-sm data-[state=active]:bg-gradient-to-br data-[state=active]:from-blue-500 data-[state=active]:to-cyan-500 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:border-transparent transition-all">
            <Truck className="w-5 h-5 sm:w-4 sm:h-4" />
            <span className="text-[11px] sm:text-xs font-medium leading-tight">جاري التوصيل</span>
            <span className="text-[11px] sm:text-xs font-bold">({serverStatusCounts.shipped ?? shippedOrders.length})</span>
          </TabsTrigger>
          <TabsTrigger value="delivered" className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 sm:py-2 rounded-lg border border-border/50 bg-card shadow-sm data-[state=active]:bg-gradient-to-br data-[state=active]:from-emerald-500 data-[state=active]:to-green-500 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:border-transparent transition-all">
            <CheckCircle className="w-5 h-5 sm:w-4 sm:h-4" />
            <span className="text-[11px] sm:text-xs font-medium leading-tight">تم الاستلام</span>
            <span className="text-[11px] sm:text-xs font-bold">({(serverStatusCounts.delivered ?? 0) + (serverStatusCounts.settled ?? 0) || deliveredOrders.length})</span>
          </TabsTrigger>
          <TabsTrigger value="unpacked" className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 sm:py-2 rounded-lg border border-border/50 bg-card shadow-sm data-[state=active]:bg-gradient-to-br data-[state=active]:from-teal-500 data-[state=active]:to-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:border-transparent transition-all">
            <PackageOpen className="w-5 h-5 sm:w-4 sm:h-4" />
            <span className="text-[11px] sm:text-xs font-medium leading-tight">تم التفريغ</span>
            <span className="text-[11px] sm:text-xs font-bold">({serverStatusCounts.unpacked ?? unpackedOrders.length})</span>
          </TabsTrigger>
          <TabsTrigger value="cancelled" className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 sm:py-2 rounded-lg border border-border/50 bg-card shadow-sm data-[state=active]:bg-gradient-to-br data-[state=active]:from-rose-500 data-[state=active]:to-red-500 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:border-transparent transition-all">
            <XCircle className="w-5 h-5 sm:w-4 sm:h-4" />
            <span className="text-[11px] sm:text-xs font-medium leading-tight">ملغي</span>
            <span className="text-[11px] sm:text-xs font-bold">({serverStatusCounts.cancelled ?? cancelledOrders.length})</span>
          </TabsTrigger>
          <TabsTrigger value="returned_received" className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 sm:py-2 rounded-lg border border-border/50 bg-card shadow-sm data-[state=active]:bg-gradient-to-br data-[state=active]:from-fuchsia-500 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:border-transparent transition-all">
            <Undo2 className="w-5 h-5 sm:w-4 sm:h-4" />
            <span className="text-[11px] sm:text-xs font-medium leading-tight">المرتجعات</span>
            <span className="text-[11px] sm:text-xs font-bold">({serverStatusCounts.returned_received ?? returnedReceivedOrders.length})</span>
          </TabsTrigger>
          <TabsTrigger value="deleted" className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 sm:py-2 rounded-lg col-span-2 sm:col-span-1 border border-border/50 bg-card shadow-sm data-[state=active]:bg-gradient-to-br data-[state=active]:from-slate-500 data-[state=active]:to-slate-700 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:border-transparent transition-all">
            <Archive className="w-5 h-5 sm:w-4 sm:h-4" />
            <span className="text-[11px] sm:text-xs font-medium leading-tight">محذوفة</span>
            <span className="text-[11px] sm:text-xs font-bold">({deletedOrders.length})</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-4">
          <Card className="card-shadow border-primary/30 bg-primary/5">
            <CardContent className="p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <span>لإدارة مكالمات التأكيد بشكل احترافي (قوالب واتساب، تأجيل، سجل المحاولات…)</span>
              </div>
              <Button asChild size="sm">
                <Link to="/dashboard/confirmation">اذهب إلى مركز تأكيد الطلبات ←</Link>
              </Button>
            </CardContent>
          </Card>
          {(
            <Card className="card-shadow">
              <CardContent className="p-4">
                <div className="flex flex-col lg:flex-row lg:flex-wrap lg:items-center lg:justify-between gap-4">
                  <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={pendingOrders.length > 0 && pendingOrders.every((o) => selectedOrders.includes(o.id))}
                        onCheckedChange={() => toggleSelectAll(pendingOrders.map((o) => o.id))}
                      />
                      <span className="text-sm text-foreground">تحديد الكل ({selectedOrders.filter(id => pendingOrders.some(o => o.id === id)).length} محدد)</span>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
                    <Select value={productFilter} onValueChange={(v) => { setProductFilter(v); setSelectedOrders([]); }}>
                      <SelectTrigger className="w-full sm:w-52">
                        <SelectValue placeholder="فلتر حسب المنتج" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">كل المنتجات</SelectItem>
                        {productNames.filter(Boolean).map((name) => (
                          <SelectItem key={name} value={name}>{name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={confirmationFilter} onValueChange={(v) => { setConfirmationFilter(v as any); setSelectedOrders([]); }}>
                      <SelectTrigger className="w-full sm:w-52">
                        <SelectValue placeholder="فلتر حسب التأكيد" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">كل حالات التأكيد ({allPending.length})</SelectItem>
                        <SelectItem value="unconfirmed">بانتظار التأكيد ({confirmationCounts.unconfirmed})</SelectItem>
                        <SelectItem value="confirmed">مؤكد ({confirmationCounts.confirmed})</SelectItem>
                        <SelectItem value="no_answer">لم يرد ({confirmationCounts.no_answer})</SelectItem>
                        <SelectItem value="postponed">مؤجل ({confirmationCounts.postponed})</SelectItem>
                        <SelectItem value="cancelled">ألغى ({confirmationCounts.cancelled})</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={prepFilter} onValueChange={(v) => { setPrepFilter(v as any); setSelectedOrders([]); }}>
                      <SelectTrigger className="w-full sm:w-52">
                        <SelectValue placeholder="فلتر حسب التجهيز" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">كل حالات التجهيز</SelectItem>
                        <SelectItem value="pending">قيد الانتظار</SelectItem>
                        <SelectItem value="preparing">جاري التجهيز</SelectItem>
                        <SelectItem value="prepared">تم التجهيز</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-muted-foreground whitespace-nowrap">من:</span>
                        <Input
                          type="date"
                          value={pendingDateFrom}
                          onChange={(e) => { setPendingDateFrom(e.target.value); setSelectedOrders([]); }}
                          className="w-full sm:w-40"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-muted-foreground whitespace-nowrap">إلى:</span>
                        <Input
                          type="date"
                          value={pendingDateTo}
                          onChange={(e) => { setPendingDateTo(e.target.value); setSelectedOrders([]); }}
                          className="w-full sm:w-40"
                        />
                      </div>
                      {(pendingDateFrom || pendingDateTo) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setPendingDateFrom(""); setPendingDateTo(""); }}
                        >
                          مسح
                        </Button>
                      )}
                    </div>
                    <Button
                      onClick={() => {
                        if (selectedOrders.length === 0) {
                          toast({ title: "تنبيه", description: "حدد طلبات أولاً", variant: "destructive" });
                          return;
                        }
                        setShippingOptionsOpen(true);
                      }}
                      disabled={selectedOrders.length === 0 || shipping}
                      className="w-full sm:w-auto bg-accent text-accent-foreground hover:bg-accent/90 bg-lime-700 py-[8px]"
                    >
                      {shipping ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Send className="w-4 h-4 ml-2" />}
                      {shipping && shipProgress
                        ? `جاري الإرسال ${shipProgress.done} من ${shipProgress.total}`
                        : "إرسال لشركة الشحن"}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          disabled={selectedOrders.filter((id) => pendingOrders.some((o) => o.id === id)).length === 0}
                          className="w-full sm:w-auto"
                        >
                          <Trash2 className="w-4 h-4 ml-2" />
                          حذف المحدد
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>تأكيد حذف الطلبات</AlertDialogTitle>
                          <AlertDialogDescription>
                            سيتم نقل {selectedOrders.filter((id) => pendingOrders.some((o) => o.id === id)).length} طلب إلى قائمة المحذوفة. يمكنك استرجاعها لاحقًا.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>إلغاء</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() =>
                              handleBulkDelete(selectedOrders.filter((id) => pendingOrders.some((o) => o.id === id)))
                            }
                          >
                            حذف
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <Button variant="outline" onClick={exportPendingOrders} className="w-full sm:w-auto">
                      <Download className="w-4 h-4 ml-2" />
                      تصدير Excel
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => document.getElementById("order-image-input")?.click()}
                      disabled={extracting}
                      className="w-full sm:w-auto border-accent text-accent"
                    >
                      {extracting ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <ImagePlus className="w-4 h-4 ml-2" />}
                      إنشاء طلب من صورة
                    </Button>
                    <Button
                      onClick={handleCreateManualOrder}
                      disabled={creating}
                      className="w-full sm:w-auto"
                    >
                      {creating ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Plus className="w-4 h-4 ml-2" />}
                      إضافة طلب
                    </Button>
                    <input
                      id="order-image-input"
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          
          {pendingOrders.length === 0 ? (
            renderEmptyState(
              <Clock className="w-16 h-16 text-muted-foreground mb-4" />,
              "لا توجد طلبات قيد الانتظار"
            )
          ) : (() => {
            const p = paginate(pendingOrders, "pending");
            return (
              <div className="space-y-4">
                {p.items.map((order) => renderOrderCard(order, true, pendingPhoneCounts[normalizePhone(order.phone)] || 0))}
                <Pager p={p} />
              </div>
            );
          })()}
        </TabsContent>

        <TabsContent value="foreign" className="space-y-4">
          <Card className="card-shadow border-orange-500/40 bg-orange-500/5">
            <CardContent className="p-3 flex items-center gap-2 text-sm">
              <Globe className="w-5 h-5 text-orange-600" />
              <span>
                هذه طلبات وردت من عناوين IP خارج ليبيا. راجعها قبل التأكيد أو الشحن — قد تكون من زبائن يستخدمون VPN أو طلبات وهمية.
              </span>
            </CardContent>
          </Card>
          {foreignOrders.length === 0 ? (
            renderEmptyState(
              <Globe className="w-16 h-16 text-muted-foreground mb-4" />,
              "لا توجد طلبات من خارج ليبيا"
            )
          ) : (() => {
            const p = paginate(foreignOrders, "foreign");
            return (
              <div className="space-y-4">
                {p.items.map((order) => renderOrderCard(order, true, pendingPhoneCounts[normalizePhone(order.phone)] || 0))}
                <Pager p={p} />
              </div>
            );
          })()}
        </TabsContent>

        <TabsContent value="shipped" className="space-y-4">
          <Card className="card-shadow">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={shippedSearch}
                    onChange={(e) => setShippedSearch(e.target.value)}
                    placeholder="ابحث بكود الشحن أو رقم الهاتف"
                    className="pr-10"
                  />
                </div>
                <Select value={shippedCarrierFilter} onValueChange={setShippedCarrierFilter}>
                  <SelectTrigger className="sm:w-64">
                    <SelectValue placeholder="فلترة حسب حالة الشحن" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الحالات ({serverStatusCounts.shipped ?? allShipped.length})</SelectItem>
                    {shippedCarrierOptions.map((opt) => {
                      const localCount = allShipped.filter((o) => {
                        const c = extractStatusCode(o);
                        const label = getCarrierFilterLabel(o);
                        if (opt.code === "__none__") return !c;
                        if (opt.code.startsWith("label:")) {
                          const wanted = opt.code.slice("label:".length);
                          return label === wanted;
                        }
                        return c === opt.code;
                      }).length;
                      // Prefer server-side count (matches by displayed label) so the
                      // dropdown stays accurate even when the in-memory list is capped.
                      const serverKey = opt.code.startsWith("label:")
                        ? opt.code.slice("label:".length)
                        : opt.code === "__none__" ? "بدون حالة" : opt.label;
                      const count = serverCarrierCounts[serverKey] ?? localCount;
                      return (
                        <SelectItem key={opt.code} value={opt.code}>
                          {opt.label} ({count})
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Select value={shippedProductFilter} onValueChange={setShippedProductFilter}>
                  <SelectTrigger className="sm:w-52">
                    <SelectValue placeholder="فلترة حسب المنتج" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل المنتجات</SelectItem>
                    {productNames.filter(Boolean).map((name) => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSyncCarrierStatuses}
                  disabled={syncingCarrier}
                  className="gap-2"
                >
                  {syncingCarrier ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  مزامنة حالات الشحن
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={shippedOrders.length > 0 && shippedOrders.every((o) => selectedOrders.includes(o.id))}
                    onCheckedChange={() => toggleSelectAll(shippedOrders.map((o) => o.id))}
                  />
                  <span className="text-sm text-foreground">
                    تحديد الكل ({selectedOrders.filter((id) => shippedOrders.some((o) => o.id === id)).length} محدد)
                  </span>
                </div>
                <Button
                  variant="outline"
                  onClick={() =>
                    printOrders(shippedOrders.filter((o) => selectedOrders.includes(o.id)))
                  }
                  disabled={selectedOrders.filter((id) => shippedOrders.some((o) => o.id === id)).length === 0}
                  className="gap-2"
                >
                  <Printer className="w-4 h-4" />
                  طباعة المحدد
                </Button>
                <Button
                  variant="outline"
                  onClick={() => printOrders(shippedOrders)}
                  disabled={shippedOrders.length === 0}
                  className="gap-2"
                >
                  <Printer className="w-4 h-4" />
                  طباعة كل الظاهر
                </Button>
                <span className="text-xs text-muted-foreground">
                  لتعديل بيانات الستيكر، اذهب إلى "تصميم ستيكر الشحن" من القائمة.
                </span>
              </div>
              {carrierSyncResult && (
                <div className="mt-4 border-t pt-4 space-y-2">
                  <div className="text-sm text-muted-foreground">
                    تم فحص {carrierSyncResult.total} طلب — تحديث {carrierSyncResult.updated} — فشل {carrierSyncResult.failed}
                  </div>
                  {carrierSyncResult.codes.length === 0 ? (
                    <div className="text-sm">لم يتم استرجاع أي حالات.</div>
                  ) : (
                    <div className="space-y-1">
                      <div className="text-sm font-semibold">الأكواد المسترجعة من شركة الشحن:</div>
                      <div className="flex flex-wrap gap-2">
                        {carrierSyncResult.codes.map((c) => (
                          <Badge
                            key={c.code}
                            variant={c.mapped ? "default" : "secondary"}
                            className="text-xs"
                            title={c.label}
                          >
                            <span className="font-mono">{c.code}</span>
                            <span className="mx-1">·</span>
                            <span>{c.label}</span>
                            <span className="mx-1">·</span>
                            <span>{c.count}</span>
                          </Badge>
                        ))}
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">
                        الأكواد بلون أزرق فاتح ليس لها تسمية مخصصة — يمكنك إضافتها من إعدادات شركة الشحن.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          {shippedOrders.length === 0 ? (
            renderEmptyState(
              <Truck className="w-16 h-16 text-muted-foreground mb-4" />,
              shippedSearchNorm ? "لا توجد نتائج مطابقة" : "لا توجد طلبات جاري توصيلها"
            )
          ) : (() => {
            const p = paginate(shippedOrders, "shipped");
            return (
              <div className="space-y-4">
                {p.items.map((order) => renderOrderCard(order, true))}
                <Pager p={p} />
              </div>
            );
          })()}
        </TabsContent>

        <TabsContent value="delivered" className="space-y-4">
          {deliveredOrders.length === 0 ? (
            renderEmptyState(
              <CheckCircle className="w-16 h-16 text-muted-foreground mb-4" />,
              "لا توجد طلبات مستلمة"
            )
          ) : (() => {
            const p = paginate(deliveredOrders, "delivered");
            return (
              <div className="space-y-4">
                {p.items.map((order) => renderOrderCard(order))}
                <Pager p={p} />
              </div>
            );
          })()}
        </TabsContent>

        <TabsContent value="unpacked" className="space-y-4">
          <Card className="card-shadow">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث برقم الطلبية أو الهاتف أو الاسم"
                    value={unpackedSearch}
                    onChange={(e) => setUnpackedSearch(e.target.value)}
                    className="flex-1"
                  />
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-muted-foreground whitespace-nowrap">من:</span>
                    <Input
                      type="date"
                      value={unpackedDateFrom}
                      onChange={(e) => setUnpackedDateFrom(e.target.value)}
                      className="w-full sm:w-40"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-muted-foreground whitespace-nowrap">إلى:</span>
                    <Input
                      type="date"
                      value={unpackedDateTo}
                      onChange={(e) => setUnpackedDateTo(e.target.value)}
                      className="w-full sm:w-40"
                    />
                  </div>
                  {(unpackedDateFrom || unpackedDateTo || unpackedSearch) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setUnpackedDateFrom(""); setUnpackedDateTo(""); setUnpackedSearch(""); }}
                    >
                      مسح
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
          {unpackedOrders.length === 0 ? (
            renderEmptyState(
              <PackageOpen className="w-16 h-16 text-muted-foreground mb-4" />,
              unpackedSearch.trim() ? "لا توجد نتائج مطابقة" : "لا توجد طلبات تم تفريغها"
            )
          ) : (() => {
            const p = paginate(unpackedOrders, "unpacked");
            return (
              <div className="space-y-4">
                {p.items.map((order) => renderOrderCard(order))}
                <Pager p={p} />
              </div>
            );
          })()}
        </TabsContent>
        <TabsContent value="cancelled" className="space-y-4">
          {cancelledOrders.length === 0 ? (
            renderEmptyState(
              <XCircle className="w-16 h-16 text-muted-foreground mb-4" />,
              "لا توجد طلبات ملغية"
            )
          ) : (
            <>
              <Card className="card-shadow">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={cancelledOrders.every((o) => selectedOrders.includes(o.id))}
                        onCheckedChange={() => toggleSelectAll(cancelledOrders.map((o) => o.id))}
                      />
                      <span className="text-sm text-foreground">
                        تحديد الكل ({selectedOrders.filter((id) => cancelledOrders.some((o) => o.id === id)).length} محدد)
                      </span>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          disabled={selectedOrders.filter((id) => cancelledOrders.some((o) => o.id === id)).length === 0}
                        >
                          <Trash2 className="w-4 h-4 ml-2" />
                          حذف المحدد
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>تأكيد حذف الطلبات الملغية</AlertDialogTitle>
                          <AlertDialogDescription>
                            سيتم حذف الطلبات المحددة نهائياً. لا تؤثر الطلبات الملغية على الأرباح أو المخزون أو المشتريات.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>إلغاء</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() =>
                              handleBulkDelete(
                                selectedOrders.filter((id) => cancelledOrders.some((o) => o.id === id))
                              )
                            }
                          >
                            حذف
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
              {(() => {
                const p = paginate(cancelledOrders, "cancelled");
                return (
                  <div className="space-y-4">
                    {p.items.map((order) => renderOrderCard(order, true))}
                    <Pager p={p} />
                  </div>
                );
              })()}
            </>
          )}
        </TabsContent>
        <TabsContent value="returned_received" className="space-y-4">
          {returnedReceivedOrders.length === 0 ? (
            renderEmptyState(
              <Undo2 className="w-16 h-16 text-muted-foreground mb-4" />,
              "لا توجد مرتجعات مؤكدة"
            )
          ) : (() => {
            const p = paginate(returnedReceivedOrders, "returned");
            return (
              <div className="space-y-4">
                {p.items.map((order) => renderOrderCard(order))}
                <Pager p={p} />
              </div>
            );
          })()}
        </TabsContent>
        <TabsContent value="deleted" className="space-y-4">
          {deletedOrders.length === 0 ? (
            renderEmptyState(
              <Archive className="w-16 h-16 text-muted-foreground mb-4" />,
              "لا توجد طلبات محذوفة"
            )
          ) : (
            <>
              <Card className="card-shadow">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={deletedOrders.every((o) => selectedOrders.includes(o.id))}
                        onCheckedChange={() => toggleSelectAll(deletedOrders.map((o) => o.id))}
                      />
                      <span className="text-sm text-foreground">
                        تحديد الكل ({selectedOrders.filter((id) => deletedOrders.some((o) => o.id === id)).length} محدد)
                      </span>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          disabled={selectedOrders.filter((id) => deletedOrders.some((o) => o.id === id)).length === 0}
                        >
                          <Trash2 className="w-4 h-4 ml-2" />
                          حذف نهائي للمحدد
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>تأكيد الحذف النهائي</AlertDialogTitle>
                          <AlertDialogDescription>
                            سيتم حذف {selectedOrders.filter((id) => deletedOrders.some((o) => o.id === id)).length} طلب نهائياً من النظام. هذا الإجراء لا رجعة فيه.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>إلغاء</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() =>
                              handleBulkPermanentDelete(
                                selectedOrders.filter((id) => deletedOrders.some((o) => o.id === id))
                              )
                            }
                            className="bg-red-600 hover:bg-red-700 text-white"
                          >
                            حذف نهائي
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
              {(() => {
                const p = paginate(deletedOrders, "deleted");
                return (
                  <div className="space-y-4">
                    {p.items.map((order) => renderOrderCard(order, true))}
                    <Pager p={p} />
                  </div>
                );
              })()}
            </>
          )}
        </TabsContent>

      </Tabs>
      <OrderDetailsDialog
        orderId={detailsId}
        open={!!detailsId}
        onOpenChange={(o) => !o && setDetailsId(null)}
        onSaved={(u) => setOrders((prev) => prev.map((p) => p.id === u.id ? { ...p, ...u } : p))}
      />

      <ShippingOptionsDialog
        open={shippingOptionsOpen}
        onOpenChange={setShippingOptionsOpen}
        count={selectedOrders.filter((id) => !orders.find((o) => o.id === id)?.locked_insufficient_balance).length}
        onConfirm={(opts) => {
          setShippingMode(opts.price_type_code === "INCLD" ? "included" : "excluded");
          setOpenableMode(opts.openable_code === "Y" ? "yes" : "no");
          handleShipToCompany(opts);
        }}
      />

      <AlertDialog open={!!confirmNoteOpen} onOpenChange={(o) => { if (!o) { setConfirmNoteOpen(null); setConfirmNoteValue(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{CONFIRMATION_LABELS[confirmNoteAction]}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmNoteAction === "postponed"
                ? "اكتب موعد إعادة الاتصال أو أي ملاحظة (مثلاً: تأجيل ليوم الأحد)."
                : confirmNoteAction === "cancelled"
                ? "سيتم تغيير حالة الطلب إلى ملغي. اكتب سبب الإلغاء (اختياري)."
                : "اكتب ملاحظة (اختياري)، مثل: محاولة ثانية، الهاتف مغلق…"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmNoteValue}
            onChange={(e) => setConfirmNoteValue(e.target.value)}
            placeholder="ملاحظة..."
            className="my-2"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const order = orders.find((o) => o.id === confirmNoteOpen);
                if (order) handleConfirmationAction(order, confirmNoteAction, confirmNoteValue);
              }}
            >
              حفظ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Orders;
