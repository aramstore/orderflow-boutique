import { useState, useEffect, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Eye, EyeOff, Trash2, Package, Edit, Copy, ExternalLink, Loader2, Layout, Link2, ShieldCheck, ShieldOff, FolderTree, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import type { ProductFormData } from "@/components/ProductForm";
import { supabase } from "@/integrations/supabase/client";
import { useUserContext } from "@/hooks/useUserContext";
import { useStoreContext } from "@/hooks/useStoreContext";
import { isolateLatin } from "@/lib/bidi";
import LandingPageForm, { emptyLandingPageData, type LandingPageFormData } from "@/components/LandingPageForm";
import { ProductsImportExport } from "@/components/ProductsImportExport";

const ProductForm = lazy(() => import("@/components/ProductForm"));

interface Product {
  id: string;
  name: string;
  slug: string;
  price: string;
  original_price?: string;
  purchase_price: string;
  description: string;
  images: string[];
  product_codes?: string[];
  colors?: string[];
  sizes?: string[];
  is_visible: boolean;
  stock?: number;
  variant_stock?: Record<string, number>;
  category_id?: string | null;
}

interface LandingPage {
  id: string;
  product_id: string;
  slug: string;
  title: string;
  subtitle?: string;
  is_visible: boolean;
  product_name?: string;
  product_image?: string;
}

interface StoreSettings {
  currency_symbol: string;
}

const emptyFormData: ProductFormData = {
  name: "",
  slug: "",
  price: "",
  originalPrice: "",
  purchasePrice: "",
  stock: "",
  variantStock: {},
  variantWarehouseCodes: {},
  variantEasyOrdersIds: {},
  variantSkus: {},
  easyOrdersProductId: "",
  description: "",
  images: [],
  features: "",
  productCodes: "",
  colors: "",
  sizes: "",
  warehouseLinked: true,
  upsellEnabled: false,
  upsellTitle: "",
  upsellOffers: [],
  categoryId: null,
  sizeChartUrl: "",
  reviews: [],
};

interface Category { id: string; name: string; sort_order?: number }

const Products = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [strictStock, setStrictStock] = useState(false);
  const [strictSaving, setStrictSaving] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditLoading, setIsEditLoading] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [newProduct, setNewProduct] = useState<ProductFormData>(emptyFormData);
  const [editProduct, setEditProduct] = useState<ProductFormData>(emptyFormData);
  const { isAdmin, loading: userLoading } = useUserContext();
  const { activeStoreId, loading: storeLoading } = useStoreContext();
  const [storeSettings, setStoreSettings] = useState<StoreSettings>({ currency_symbol: "د.إ" });
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const navigate = useNavigate();

  // ===== صفحات الهبوط =====
  const [activeTab, setActiveTab] = useState<"products" | "landing" | "categories">("products");
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<Category | null>(null);
  const [productFilterCategory, setProductFilterCategory] = useState<string>("__all__");
  const [lpFilterCategory, setLpFilterCategory] = useState<string>("__all__");
  const [lpFilterProduct, setLpFilterProduct] = useState<string>("__all__");
  const [landingPages, setLandingPages] = useState<LandingPage[]>([]);
  const [isLpAddOpen, setIsLpAddOpen] = useState(false);
  const [isLpEditOpen, setIsLpEditOpen] = useState(false);
  const [editingLpId, setEditingLpId] = useState<string | null>(null);
  const [newLp, setNewLp] = useState<LandingPageFormData>(emptyLandingPageData);
  const [editLp, setEditLp] = useState<LandingPageFormData>(emptyLandingPageData);
  const [isSavingLp, setIsSavingLp] = useState(false);
  const [deleteLpTarget, setDeleteLpTarget] = useState<LandingPage | null>(null);
  const [lpTemplates, setLpTemplates] = useState<Array<{ id: string; name: string; is_default: boolean; puck_data: any }>>([]);

  // عداد صفحات الهبوط لكل منتج
  const lpCountByProduct = landingPages.reduce<Record<string, number>>((acc, lp) => {
    acc[lp.product_id] = (acc[lp.product_id] || 0) + 1;
    return acc;
  }, {});

  const runWithTimeout = async <T,>(request: PromiseLike<T>, timeoutMs = 30000): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("انتهت مهلة تحميل المنتجات")), timeoutMs);
    });
    return Promise.race([Promise.resolve(request), timeout]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  };

  // Two-phase load: fast metadata first, images in background
  useEffect(() => {
    if (userLoading || storeLoading) return;
    if (!activeStoreId) { setProducts([]); setIsLoading(false); return; }
    let cancelled = false;

    const loadProducts = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) setIsLoading(false);
          return;
        }

        // Phase 1: lightweight metadata only (no images) — fast
        let metaQuery = supabase
          .from("products")
          .select("id, name, slug, price, original_price, is_visible, category_id")
          .is("deleted_at", null)
          .order("created_at", { ascending: false });
        metaQuery = metaQuery.eq("store_id", activeStoreId);
        const { data: metaData, error: metaError } = await runWithTimeout(metaQuery, 15000);

        if (metaError) throw metaError;
        if (cancelled) return;

        // Fetch purchase prices via RPC (sensitive cost data is no longer publicly readable)
        const { data: costsData } = await (supabase as any).rpc("get_owner_product_costs", { _product_ids: null });
        const costMap = new Map<string, number>((costsData || []).map((c: any) => [c.id, Number(c.purchase_price || 0)]));

        const baseList: Product[] = (metaData || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          price: String(p.price),
          original_price: p.original_price ? String(p.original_price) : undefined,
          purchase_price: String(costMap.get(p.id) ?? 0),
          description: "",
          images: [],
          product_codes: [],
          colors: [],
          sizes: [],
          is_visible: p.is_visible ?? true,
          category_id: p.category_id ?? null,
        }));
        setProducts(baseList);
        setIsLoading(false);

        // Phase 2: load images in background (heavy column)
        let imgQuery = supabase.from("products").select("id, images").is("deleted_at", null);
        imgQuery = imgQuery.eq("store_id", activeStoreId);
        const { data: imgData } = await imgQuery;
        if (cancelled || !imgData) return;
        const imgMap = new Map<string, string[]>(
          imgData.map((r: any) => [r.id as string, (r.images as string[]) || []])
        );
        setProducts((prev) =>
          prev.map((p) => ({ ...p, images: imgMap.get(p.id) || [] }))
        );
      } catch (error) {
        console.error("Error fetching products:", error);
        if (!cancelled) {
          toast({
            title: "خطأ",
            description: "حدث خطأ أثناء تحميل المنتجات",
            variant: "destructive",
          });
          setIsLoading(false);
        }
      }
    };

    loadProducts();

    // Currency in background (non-blocking)
    supabase.from("store_settings").select("currency_symbol").limit(1).maybeSingle().then(({ data }) => {
      if (!cancelled && data) {
        setStoreSettings({ currency_symbol: data.currency_symbol });
      }
    });

    // Load strict-stock toggle for current user
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("profiles").select("strict_stock_enabled").eq("user_id", user.id).maybeSingle()
        .then(({ data }) => {
          if (!cancelled && data) setStrictStock(!!(data as any).strict_stock_enabled);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [isAdmin, userLoading, storeLoading, activeStoreId]);

  const fetchProducts = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      if (!activeStoreId) return;
      let query = supabase
        .from("products")
        .select("id, name, slug, price, original_price, images, is_visible")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      query = query.eq("store_id", activeStoreId);
      const { data, error } = await runWithTimeout(query, 30000);

      if (error) throw error;

      const { data: costsData2 } = await (supabase as any).rpc("get_owner_product_costs", { _product_ids: null });
      const costMap2 = new Map<string, number>((costsData2 || []).map((c: any) => [c.id, Number(c.purchase_price || 0)]));

      setProducts(
        (data || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          price: String(p.price),
          original_price: p.original_price ? String(p.original_price) : undefined,
          purchase_price: String(costMap2.get(p.id) ?? 0),
          description: "",
          images: p.images || [],
          product_codes: [],
          colors: [],
          sizes: [],
          is_visible: p.is_visible ?? true,
        }))
      );
    } catch (error) {
      console.error("Error fetching products:", error);
      toast({
        title: "خطأ",
        description: "حدث خطأ أثناء تحميل المنتجات",
        variant: "destructive",
      });
    }
  };

  const handleAddProduct = async () => {
    if (!newProduct.name || !newProduct.price || !newProduct.purchasePrice) {
      toast({
        title: "حقول إلزامية ناقصة",
        description: "يرجى ملء اسم المنتج والسعر وسعر الشراء",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      // في وضع "إضافة منتج" نولّد slug تلقائيًا (المنتج لا يملك صفحة هبوط افتراضيًا)
      let finalSlug = newProduct.slug;
      if (!finalSlug) {
        const base = (newProduct.name || "product")
          .toLowerCase()
          .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .replace(/[\u0600-\u06FF]/g, "")
          .replace(/-+/g, "-") || "product";
        const rand = Math.random().toString(36).slice(2, 8);
        finalSlug = `${base || "product"}-${rand}`;
      }
      const colorsArray = newProduct.colors ? newProduct.colors.split(",").map(c => c.trim()).filter(Boolean) : [];
      const sizesArray = newProduct.sizes ? newProduct.sizes.split(",").map(s => s.trim()).filter(Boolean) : [];
      const hasColorOrSize = colorsArray.length > 0 || sizesArray.length > 0;
      const legacyCodesArray = newProduct.productCodes ? newProduct.productCodes.split(",").map(c => c.trim()).filter(Boolean) : [];

      // Build variant_stock (numeric) only for existing variant keys
      const { buildVariantKeys } = await import("@/components/ProductForm");
      const variantKeys = buildVariantKeys(newProduct.colors, newProduct.sizes, newProduct.productCodes);
      const variantSkusObj: Record<string, string> = {};
      variantKeys.forEach((k) => {
        const sku = (newProduct.variantSkus?.[k] || "").trim();
        if (sku) variantSkusObj[k] = sku;
      });
      // For backward compatibility: when colors/sizes exist, derive product_codes from per-variant SKUs.
      // When neither exists, keep the legacy CSV "أكواد المنتج" behavior.
      const productCodesArray = hasColorOrSize
        ? Array.from(new Set(Object.values(variantSkusObj).filter(Boolean)))
        : legacyCodesArray;
      const variantStockNum: Record<string, number> = {};
      let totalVariantQty = 0;
      variantKeys.forEach((k) => {
        const n = parseInt(newProduct.variantStock[k] || "0");
        const v = isNaN(n) || n < 0 ? 0 : n;
        variantStockNum[k] = v;
        totalVariantQty += v;
      });
      const stockNum = variantKeys.length > 0
        ? totalVariantQty
        : (newProduct.stock ? Math.max(0, parseInt(newProduct.stock) || 0) : 0);

      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("products").insert({
        owner_id: user!.id,
        store_id: activeStoreId,
        name: newProduct.name,
        slug: finalSlug,
        price: parseFloat(newProduct.price),
        original_price: newProduct.originalPrice ? parseFloat(newProduct.originalPrice) : null,
        purchase_price: newProduct.purchasePrice ? parseFloat(newProduct.purchasePrice) : 0,
        description: newProduct.description,
        images: newProduct.images,
        product_codes: productCodesArray,
        colors: colorsArray,
        sizes: sizesArray,
        stock: stockNum,
        variant_stock: variantStockNum,
        variant_warehouse_codes: Object.fromEntries(
          variantKeys.map((k) => [k, (newProduct.variantWarehouseCodes?.[k] || "").trim()]).filter(([, v]) => v)
        ),
        variant_skus: variantSkusObj,
        easyorders_product_id: newProduct.easyOrdersProductId?.trim() || null,
        variant_easyorders_ids: Object.fromEntries(
          variantKeys.map((k) => [k, (newProduct.variantEasyOrdersIds?.[k] || "").trim()]).filter(([, v]) => v)
        ),
      warehouse_linked: newProduct.warehouseLinked !== false,
    category_id: newProduct.categoryId || null,
      upsell_enabled: !!newProduct.upsellEnabled,
      upsell_title: (newProduct.upsellTitle?.trim() || "🎁 عروض خاصة"),
      upsell_offers: (newProduct.upsellOffers || [])
        .map((o) => ({
          quantity: Math.max(1, parseInt(o.quantity) || 0),
          price: Math.max(0, parseFloat(o.price) || 0),
          label: (o.label || "").trim(),
        }))
        .filter((o) => o.quantity > 0 && o.price > 0),
      size_chart_url: newProduct.sizeChartUrl?.trim() || null,
      reviews: (newProduct.reviews || [])
        .map((r) => ({
          name: (r.name || "").trim(),
          rating: Math.max(1, Math.min(5, parseInt(String(r.rating)) || 5)),
          comment: (r.comment || "").trim(),
        }))
        .filter((r) => r.name && r.comment),
      }).select("id").single();

      if (error) {
        if (error.code === "23505") {
          toast({
            title: "خطأ",
            description: "رابط المنتج موجود مسبقاً، يرجى اختيار رابط آخر",
            variant: "destructive",
          });
          return;
        }
        throw error;
      }

      // إنشاء حركات مخزون افتتاحية (opening_stock) لكل كمية مُدخلة عند الإنشاء
      try {
        const openingRows: any[] = [];
        if (variantKeys.length > 0) {
          variantKeys.forEach((k) => {
            const q = Number(variantStockNum[k] || 0);
            if (q > 0) {
              openingRows.push({
                owner_id: user!.id,
                product_id: data.id,
                product_name: newProduct.name,
                variant_key: k,
                warehouse_code: null,
                qty: q,
                unit_price: newProduct.price ?? null,
                reason: "opening_stock",
                notes: "كمية افتتاحية عند إنشاء المنتج",
              });
            }
          });
        } else if (stockNum > 0) {
          openingRows.push({
            owner_id: user!.id,
            product_id: data.id,
            product_name: newProduct.name,
            variant_key: null,
            warehouse_code: null,
            qty: stockNum,
            unit_price: newProduct.price ?? null,
            reason: "opening_stock",
            notes: "كمية افتتاحية عند إنشاء المنتج",
          });
        }
        if (openingRows.length > 0) {
          await (supabase as any).from("stock_movements").insert(openingRows);
        }
      } catch (openErr) {
        console.warn("Opening stock movement insert failed", openErr);
      }

      // Add to list directly without refetching
      const newProductData: Product = {
        id: data.id,
        name: newProduct.name,
        slug: finalSlug,
        price: newProduct.price,
        original_price: newProduct.originalPrice || undefined,
        purchase_price: newProduct.purchasePrice || "0",
        description: newProduct.description,
        images: newProduct.images,
        product_codes: productCodesArray,
        colors: colorsArray,
        sizes: sizesArray,
        is_visible: true,
        stock: stockNum,
        variant_stock: variantStockNum,
        category_id: newProduct.categoryId || null,
      };
      setProducts(prev => [newProductData, ...prev]);
      setNewProduct(emptyFormData);
      setIsAddOpen(false);
      toast({
        title: "تم بنجاح",
        description: "تم إضافة المنتج بنجاح",
      });
    } catch (error) {
      console.error("Error adding product:", error);
      toast({
        title: "خطأ",
        description: "حدث خطأ أثناء إضافة المنتج",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditProduct = async () => {
    if (!editingProductId || !editProduct.name || !editProduct.price || !editProduct.slug || !editProduct.purchasePrice) {
      toast({
        title: "خطأ",
        description: "يرجى ملء اسم المنتج والسعر وسعر الشراء ورابط المنتج",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const colorsArray = editProduct.colors ? editProduct.colors.split(",").map(c => c.trim()).filter(Boolean) : [];
      const sizesArray = editProduct.sizes ? editProduct.sizes.split(",").map(s => s.trim()).filter(Boolean) : [];
      const hasColorOrSize = colorsArray.length > 0 || sizesArray.length > 0;
      const legacyCodesArray = editProduct.productCodes ? editProduct.productCodes.split(",").map(c => c.trim()).filter(Boolean) : [];

      const { buildVariantKeys } = await import("@/components/ProductForm");
      const variantKeys = buildVariantKeys(editProduct.colors, editProduct.sizes, editProduct.productCodes);
      const variantSkusObj: Record<string, string> = {};
      variantKeys.forEach((k) => {
        const sku = (editProduct.variantSkus?.[k] || "").trim();
        if (sku) variantSkusObj[k] = sku;
      });
      const productCodesArray = hasColorOrSize
        ? Array.from(new Set(Object.values(variantSkusObj).filter(Boolean)))
        : legacyCodesArray;
      const variantStockNum: Record<string, number> = {};
      let totalVariantQty = 0;
      variantKeys.forEach((k) => {
        const n = parseInt(editProduct.variantStock[k] || "0");
        const v = isNaN(n) || n < 0 ? 0 : n;
        variantStockNum[k] = v;
        totalVariantQty += v;
      });
      const stockNum = variantKeys.length > 0
        ? totalVariantQty
        : (editProduct.stock ? Math.max(0, parseInt(editProduct.stock) || 0) : 0);

      // Only include images if they actually changed (images can be heavy base64)
      const originalProduct = products.find(p => p.id === editingProductId);
      const imagesChanged = !originalProduct
        || originalProduct.images.length !== editProduct.images.length
        || originalProduct.images.some((img, i) => img !== editProduct.images[i]);

      const updatePayload: any = {
        name: editProduct.name,
        slug: editProduct.slug,
        price: parseFloat(editProduct.price),
        original_price: editProduct.originalPrice ? parseFloat(editProduct.originalPrice) : null,
        purchase_price: editProduct.purchasePrice ? parseFloat(editProduct.purchasePrice) : 0,
        description: editProduct.description,
        product_codes: productCodesArray,
        colors: colorsArray,
        sizes: sizesArray,
        variant_warehouse_codes: Object.fromEntries(
          variantKeys.map((k) => [k, (editProduct.variantWarehouseCodes?.[k] || "").trim()]).filter(([, v]) => v)
        ),
        variant_skus: variantSkusObj,
        easyorders_product_id: editProduct.easyOrdersProductId?.trim() || null,
        variant_easyorders_ids: Object.fromEntries(
          variantKeys.map((k) => [k, (editProduct.variantEasyOrdersIds?.[k] || "").trim()]).filter(([, v]) => v)
        ),
      warehouse_linked: editProduct.warehouseLinked !== false,
    category_id: editProduct.categoryId || null,
      upsell_enabled: !!editProduct.upsellEnabled,
      upsell_title: (editProduct.upsellTitle?.trim() || "🎁 عروض خاصة"),
      upsell_offers: (editProduct.upsellOffers || [])
        .map((o) => ({
          quantity: Math.max(1, parseInt(o.quantity) || 0),
          price: Math.max(0, parseFloat(o.price) || 0),
          label: (o.label || "").trim(),
        }))
        .filter((o) => o.quantity > 0 && o.price > 0),
      size_chart_url: editProduct.sizeChartUrl?.trim() || null,
      reviews: (editProduct.reviews || [])
        .map((r) => ({
          name: (r.name || "").trim(),
          rating: Math.max(1, Math.min(5, parseInt(String(r.rating)) || 5)),
          comment: (r.comment || "").trim(),
        }))
        .filter((r) => r.name && r.comment),
      };
      if (imagesChanged) updatePayload.images = editProduct.images;

      const { error } = await supabase
        .from("products")
        .update(updatePayload)
        .eq("id", editingProductId);

      if (error) {
        if (error.code === "23505") {
          toast({
            title: "خطأ",
            description: "رابط المنتج موجود مسبقاً، يرجى اختيار رابط آخر",
            variant: "destructive",
          });
          return;
        }
        throw error;
      }

      // Propagate updated warehouse codes to PENDING (not yet shipped) orders so they pick up new mapping.
      try {
        const newWhMap: Record<string, string> = Object.fromEntries(
          variantKeys.map((k) => [k, (editProduct.variantWarehouseCodes?.[k] || "").trim()])
        );
        const { data: pendingOrders } = await supabase
          .from("orders")
          .select("id")
          .eq("product_id", editingProductId)
          .eq("status", "pending")
          .eq("shipped_to_company", false);
        const pendingOrderIds = (pendingOrders || []).map((o: any) => o.id);
        if (pendingOrderIds.length > 0) {
          for (const [vk, code] of Object.entries(newWhMap)) {
            let color: string | null = null;
            let size: string | null = null;
            let pcode: string | null = null;
            if (colorsArray.length && sizesArray.length && vk.includes(" - ")) {
              const [c, s] = vk.split(" - ");
              color = c?.trim() || null;
              size = s?.trim() || null;
            } else if (colorsArray.includes(vk)) {
              color = vk;
            } else if (sizesArray.includes(vk)) {
              size = vk;
            } else {
              pcode = vk;
            }
            let q: any = (supabase as any)
              .from("order_items")
              .update({ warehouse_code: code ? code : null })
              .in("order_id", pendingOrderIds)
              .eq("product_id", editingProductId);
            if (color !== null) q = q.eq("selected_color", color);
            if (size !== null) q = q.eq("selected_size", size);
            if (pcode !== null) q = q.eq("selected_product_code", pcode);
            await q;
          }
        }
      } catch (propErr) {
        console.warn("Propagate warehouse codes to pending orders failed", propErr);
      }

      // Update list directly without refetching
      setProducts(prev => prev.map(p => 
        p.id === editingProductId ? {
          id: editingProductId,
          name: editProduct.name,
          slug: editProduct.slug,
          price: editProduct.price,
          original_price: editProduct.originalPrice || undefined,
          purchase_price: editProduct.purchasePrice || "0",
          description: editProduct.description,
          images: editProduct.images,
          product_codes: productCodesArray,
          colors: colorsArray,
          sizes: sizesArray,
          is_visible: p.is_visible,
          stock: stockNum,
          variant_stock: variantStockNum,
          category_id: editProduct.categoryId || null,
        } : p
      ));
      setEditingProductId(null);
      setEditProduct(emptyFormData);
      setIsEditOpen(false);
      toast({
        title: "تم بنجاح",
        description: "تم تحديث المنتج بنجاح",
      });
    } catch (error) {
      console.error("Error updating product:", error);
      toast({
        title: "خطأ",
        description: "حدث خطأ أثناء تحديث المنتج",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const openEditDialog = async (product: Product) => {
    setEditingProductId(product.id);
    setEditProduct({
      name: product.name,
      slug: product.slug,
      price: product.price,
      originalPrice: product.original_price || "",
      purchasePrice: product.purchase_price || "",
      stock: product.stock != null ? String(product.stock) : "",
      variantStock: product.variant_stock
        ? Object.fromEntries(Object.entries(product.variant_stock).map(([k, v]) => [k, String(v)]))
        : {},
      variantWarehouseCodes: {},
      variantEasyOrdersIds: {},
      variantSkus: {},
      easyOrdersProductId: "",
      description: product.description,
      images: product.images,
      features: "",
      productCodes: product.product_codes?.join(", ") || "",
      colors: product.colors?.join(", ") || "",
      sizes: product.sizes?.join(", ") || "",
      warehouseLinked: true,
      upsellEnabled: false,
      upsellTitle: "",
      upsellOffers: [],
      categoryId: product.category_id || null,
    });
    setIsEditOpen(true);

    setIsEditLoading(true);
    try {
      const { data, error } = await runWithTimeout(
        supabase
          .from("products")
          .select("description, product_codes, colors, sizes, stock, variant_stock, variant_warehouse_codes, variant_skus, easyorders_product_id, variant_easyorders_ids, warehouse_linked, upsell_enabled, upsell_title, upsell_offers, category_id, size_chart_url, reviews")
          .eq("id", product.id)
          .single()
      );

      if (error) throw error;

      setEditProduct((current) => ({
        ...current,
        description: (data as any).description || "",
        productCodes: (data as any).product_codes?.join(", ") || "",
        colors: (data as any).colors?.join(", ") || "",
        sizes: (data as any).sizes?.join(", ") || "",
        stock: (data as any).stock != null ? String((data as any).stock) : "",
        variantStock: (data as any).variant_stock
          ? Object.fromEntries(
              Object.entries((data as any).variant_stock as Record<string, any>).map(([k, v]) => [k, String(v)])
            )
          : {},
        variantWarehouseCodes: (data as any).variant_warehouse_codes
          ? Object.fromEntries(
              Object.entries((data as any).variant_warehouse_codes as Record<string, any>).map(([k, v]) => [k, String(v)])
            )
          : {},
        variantSkus: (data as any).variant_skus
          ? Object.fromEntries(
              Object.entries((data as any).variant_skus as Record<string, any>).map(([k, v]) => [k, String(v)])
            )
          : {},
        easyOrdersProductId: (data as any).easyorders_product_id || "",
        variantEasyOrdersIds: (data as any).variant_easyorders_ids
          ? Object.fromEntries(
              Object.entries((data as any).variant_easyorders_ids as Record<string, any>).map(([k, v]) => [k, String(v)])
            )
          : {},
        warehouseLinked: (data as any).warehouse_linked !== false,
        upsellEnabled: !!(data as any).upsell_enabled,
        upsellTitle: (data as any).upsell_title || "",
        upsellOffers: Array.isArray((data as any).upsell_offers)
          ? ((data as any).upsell_offers as any[]).map((o) => ({
              quantity: String(o?.quantity ?? ""),
              price: String(o?.price ?? ""),
              label: String(o?.label ?? ""),
            }))
          : [],
        categoryId: (data as any).category_id || null,
        sizeChartUrl: (data as any).size_chart_url || "",
        reviews: Array.isArray((data as any).reviews)
          ? ((data as any).reviews as any[]).map((r) => ({
              name: String(r?.name ?? ""),
              rating: parseInt(String(r?.rating ?? 5)) || 5,
              comment: String(r?.comment ?? ""),
            }))
          : [],
      }));
    } catch (error) {
      console.error("Error loading product details:", error);
      toast({
        title: "تنبيه",
        description: "تم فتح المنتج، لكن تعذر تحميل التفاصيل الكاملة",
        variant: "destructive",
      });
    } finally {
      setIsEditLoading(false);
    }
  };

  const openPreviewPage = (slug: string) => {
    window.open(`/p/${slug}`, "_blank");
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      // منع الحذف إذا كان المنتج عنده مخزون
      const mainStock = Number(deleteTarget.stock) || 0;
      const variantStockValues = Object.values(deleteTarget.variant_stock || {}).map((v) => Number(v) || 0);
      const totalVariantStock = variantStockValues.reduce((a, b) => a + b, 0);
      const hasStock = mainStock > 0 || variantStockValues.some((v) => v > 0);
      if (hasStock) {
        toast({
          title: "لا يمكن حذف المنتج",
          description: `يوجد مخزون متبقٍ (${Math.max(mainStock, totalVariantStock)}). قم بتصفير الكمية أولاً ثم حاول مرة أخرى.`,
          variant: "destructive",
        });
        setIsDeleting(false);
        setDeleteTarget(null);
        return;
      }

      const { error } = await supabase
        .from("products")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", deleteTarget.id);

      if (error) throw error;

      setProducts((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      toast({
        title: "تم النقل",
        description: "تم نقل المنتج إلى سلة المحذوفات",
      });
      setDeleteTarget(null);
    } catch (error) {
      console.error("Error deleting product:", error);
      toast({
        title: "خطأ",
        description: "حدث خطأ أثناء حذف المنتج",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleVisibility = async (product: Product) => {
    const newVisibility = !product.is_visible;
    // Optimistic update
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, is_visible: newVisibility } : p));
    try {
      const { error } = await supabase
        .from("products")
        .update({ is_visible: newVisibility })
        .eq("id", product.id);
      if (error) throw error;
      toast({
        title: newVisibility ? "تم إظهار المنتج" : "تم إخفاء المنتج",
        description: newVisibility ? "أصبح المنتج مرئياً للزوار" : "تم إخفاء المنتج عن الزوار",
      });
    } catch (error) {
      console.error("Error toggling visibility:", error);
      // Revert
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, is_visible: !newVisibility } : p));
      toast({
        title: "خطأ",
        description: "تعذر تحديث حالة المنتج",
        variant: "destructive",
      });
    }
  };

  const copyProductUrl = (slug: string) => {
    const url = `${window.location.origin}/p/${slug}`;
    navigator.clipboard.writeText(url);
    toast({
      title: "تم النسخ",
      description: "تم نسخ رابط المنتج بنجاح",
    });
  };

  // ===== Landing Pages: load =====
  useEffect(() => {
    if (userLoading || storeLoading) return;
    if (!activeStoreId) { setLandingPages([]); return; }
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("landing_pages")
        .select("id, product_id, slug, title, subtitle, is_visible")
        .eq("store_id", activeStoreId)
        .order("created_at", { ascending: false });
      if (cancelled || error) return;
      setLandingPages((data || []) as any);
    })();
    return () => { cancelled = true; };
  }, [userLoading, storeLoading, activeStoreId]);

  // ===== Landing templates =====
  useEffect(() => {
    if (userLoading || storeLoading || !activeStoreId) { setLpTemplates([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("landing_page_templates")
        .select("id, name, is_default, puck_data")
        .eq("store_id", activeStoreId)
        .order("is_default", { ascending: false })
        .order("updated_at", { ascending: false });
      if (!cancelled) setLpTemplates((data || []) as any);
    })();
    return () => { cancelled = true; };
  }, [userLoading, storeLoading, activeStoreId]);

  // ===== Categories: load =====
  useEffect(() => {
    if (userLoading || storeLoading) return;
    if (!activeStoreId) { setCategories([]); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase as any)
        .from("product_categories")
        .select("id, name, sort_order")
        .eq("store_id", activeStoreId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (cancelled || error) return;
      setCategories((data || []) as Category[]);
    })();
    return () => { cancelled = true; };
  }, [userLoading, storeLoading, activeStoreId]);

  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !activeStoreId) return;
    const { data, error } = await (supabase as any)
      .from("product_categories")
      .insert({ owner_id: user.id, store_id: activeStoreId, name, sort_order: categories.length })
      .select("id, name, sort_order")
      .single();
    if (error) {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
      return;
    }
    setCategories((prev) => [...prev, data as Category]);
    setNewCategoryName("");
    toast({ title: "تم", description: "تمت إضافة القسم" });
  };

  const handleRenameCategory = async (id: string) => {
    const name = editingCategoryName.trim();
    if (!name) return;
    const { error } = await (supabase as any)
      .from("product_categories")
      .update({ name })
      .eq("id", id);
    if (error) {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
      return;
    }
    setCategories((prev) => prev.map((c) => c.id === id ? { ...c, name } : c));
    setEditingCategoryId(null);
    setEditingCategoryName("");
    toast({ title: "تم", description: "تم تعديل القسم" });
  };

  const confirmDeleteCategory = async () => {
    if (!deleteCategoryTarget) return;
    const { error } = await (supabase as any)
      .from("product_categories")
      .delete()
      .eq("id", deleteCategoryTarget.id);
    if (error) {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
      return;
    }
    setCategories((prev) => prev.filter((c) => c.id !== deleteCategoryTarget.id));
    setProducts((prev) => prev.map((p) => p.category_id === deleteCategoryTarget.id ? { ...p, category_id: null } : p));
    setDeleteCategoryTarget(null);
    toast({ title: "تم الحذف", description: "تم حذف القسم" });
  };

  const productCountByCategory = products.reduce<Record<string, number>>((acc, p) => {
    const k = p.category_id || "__none__";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  // أضف اسم/صورة المنتج لكل صفحة هبوط من قائمة المنتجات المحلية
  const enrichedLandingPages: LandingPage[] = landingPages.map((lp) => {
    const p = products.find((x) => x.id === lp.product_id);
    return {
      ...lp,
      product_name: p?.name,
      product_image: p?.images?.[0],
    };
  });

  const validateLp = (lp: LandingPageFormData): string | null => {
    if (!lp.productId) return "يرجى اختيار المنتج المرتبط";
    if (!lp.title.trim()) return "يرجى إدخال العنوان";
    if (!lp.slug.trim()) return "يرجى إدخال الرابط (slug)";
    return null;
  };

  const handleAddLp = async () => {
    const err = validateLp(newLp);
    if (err) { toast({ title: "خطأ", description: err, variant: "destructive" }); return; }
    setIsSavingLp(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const chosenTpl = newLp.templateId ? lpTemplates.find((t) => t.id === newLp.templateId) : null;
      const { data, error } = await supabase.from("landing_pages").insert({
        owner_id: user!.id,
        store_id: activeStoreId,
        product_id: newLp.productId,
        slug: newLp.slug.trim(),
        title: newLp.title.trim(),
        subtitle: newLp.subtitle.trim() || null,
        description: newLp.description || "",
        images: newLp.images || [],
        price: newLp.price ? parseFloat(newLp.price) : null,
        original_price: newLp.originalPrice ? parseFloat(newLp.originalPrice) : null,
        upsell_enabled: !!newLp.upsellEnabled,
        upsell_title: newLp.upsellTitle?.trim() || null,
        upsell_offers: (newLp.upsellOffers || [])
          .map((o) => ({
            quantity: Math.max(1, parseInt(o.quantity) || 0),
            price: Math.max(0, parseFloat(o.price) || 0),
            label: (o.label || "").trim(),
          }))
          .filter((o) => o.quantity > 0 && o.price > 0),
        order_form_on_top: !!newLp.orderFormOnTop,
        show_quantity: newLp.showQuantity !== false,
        is_visible: newLp.isVisible !== false,
        faqs: (newLp.faqs || [])
          .map((f) => ({ question: (f.question || "").trim(), answer: (f.answer || "").trim() }))
          .filter((f) => f.question && f.answer),
        size_chart: newLp.sizeChart
          ? {
              enabled: !!newLp.sizeChart.enabled,
              title: (newLp.sizeChart.title || "").trim(),
              description: (newLp.sizeChart.description || "").trim(),
              columns: (newLp.sizeChart.columns || []).map((c) => (c || "").trim()),
              rows: (newLp.sizeChart.rows || []).map((r) => ({
                enabled: r.enabled !== false,
                values: (r.values || []).map((v) => (v || "").trim()),
                note: (r.note || "").trim(),
              })),
            }
          : { enabled: false, title: "", description: "", columns: [], rows: [] },
        template_id: chosenTpl?.id || null,
        puck_data: chosenTpl?.puck_data ?? null,
      } as any).select("id, product_id, slug, title, subtitle, is_visible").single();
      if (error) {
        if (error.code === "23505") {
          toast({ title: "خطأ", description: "الرابط مستخدم مسبقاً، اختر رابطًا آخر", variant: "destructive" });
          return;
        }
        throw error;
      }
      setLandingPages((prev) => [data as any, ...prev]);
      setNewLp(emptyLandingPageData);
      setIsLpAddOpen(false);
      toast({ title: "تم", description: "تم إنشاء صفحة الهبوط" });
    } catch (e) {
      console.error(e);
      toast({ title: "خطأ", description: "تعذر إنشاء صفحة الهبوط", variant: "destructive" });
    } finally {
      setIsSavingLp(false);
    }
  };

  const openEditLp = async (lp: LandingPage) => {
    setEditingLpId(lp.id);
    setIsLpEditOpen(true);
    const { data, error } = await supabase
      .from("landing_pages")
      .select("*")
      .eq("id", lp.id)
      .single();
    if (error || !data) {
      toast({ title: "خطأ", description: "تعذر تحميل صفحة الهبوط", variant: "destructive" });
      return;
    }
    const d = data as any;
    setEditLp({
      productId: d.product_id,
      slug: d.slug,
      title: d.title || "",
      subtitle: d.subtitle || "",
      description: d.description || "",
      images: d.images || [],
      price: d.price != null ? String(d.price) : "",
      originalPrice: d.original_price != null ? String(d.original_price) : "",
      upsellEnabled: !!d.upsell_enabled,
      upsellTitle: d.upsell_title || "",
      upsellOffers: Array.isArray(d.upsell_offers)
        ? (d.upsell_offers as any[]).map((o) => ({
            quantity: String(o?.quantity ?? ""),
            price: String(o?.price ?? ""),
            label: String(o?.label ?? ""),
          }))
        : [],
      orderFormOnTop: !!d.order_form_on_top,
      showQuantity: d.show_quantity !== false,
      isVisible: d.is_visible !== false,
      faqs: Array.isArray(d.faqs)
        ? (d.faqs as any[]).map((f) => ({
            question: String(f?.question ?? ""),
            answer: String(f?.answer ?? ""),
          }))
        : [],
      sizeChart: d.size_chart && typeof d.size_chart === "object"
        ? {
            enabled: !!d.size_chart.enabled,
            title: String(d.size_chart.title ?? "جدول المقاسات"),
            description: String(d.size_chart.description ?? ""),
            columns: Array.isArray(d.size_chart.columns) ? d.size_chart.columns.map((c: any) => String(c ?? "")) : [],
            rows: Array.isArray(d.size_chart.rows)
              ? d.size_chart.rows.map((r: any) => ({
                  enabled: r?.enabled !== false,
                  values: Array.isArray(r?.values) ? r.values.map((v: any) => String(v ?? "")) : [],
                  note: String(r?.note ?? ""),
                }))
              : [],
          }
        : { enabled: false, title: "جدول المقاسات", description: "", columns: ["المقاس", "الطول (سم)", "العرض (سم)"], rows: [] },
      templateId: d.template_id || "",
    });
  };

  const handleUpdateLp = async () => {
    if (!editingLpId) return;
    const err = validateLp(editLp);
    if (err) { toast({ title: "خطأ", description: err, variant: "destructive" }); return; }
    setIsSavingLp(true);
    try {
      const chosenTpl = editLp.templateId ? lpTemplates.find((t) => t.id === editLp.templateId) : null;
      const updatePayload: any = {
        slug: editLp.slug.trim(),
        title: editLp.title.trim(),
        subtitle: editLp.subtitle.trim() || null,
        description: editLp.description || "",
        images: editLp.images || [],
        price: editLp.price ? parseFloat(editLp.price) : null,
        original_price: editLp.originalPrice ? parseFloat(editLp.originalPrice) : null,
        upsell_enabled: !!editLp.upsellEnabled,
        upsell_title: editLp.upsellTitle?.trim() || null,
        upsell_offers: (editLp.upsellOffers || [])
          .map((o) => ({
            quantity: Math.max(1, parseInt(o.quantity) || 0),
            price: Math.max(0, parseFloat(o.price) || 0),
            label: (o.label || "").trim(),
          }))
          .filter((o) => o.quantity > 0 && o.price > 0),
        order_form_on_top: !!editLp.orderFormOnTop,
        show_quantity: editLp.showQuantity !== false,
        is_visible: editLp.isVisible !== false,
        faqs: (editLp.faqs || [])
          .map((f) => ({ question: (f.question || "").trim(), answer: (f.answer || "").trim() }))
          .filter((f) => f.question && f.answer),
        size_chart: editLp.sizeChart
          ? {
              enabled: !!editLp.sizeChart.enabled,
              title: (editLp.sizeChart.title || "").trim(),
              description: (editLp.sizeChart.description || "").trim(),
              columns: (editLp.sizeChart.columns || []).map((c) => (c || "").trim()),
              rows: (editLp.sizeChart.rows || []).map((r) => ({
                enabled: r.enabled !== false,
                values: (r.values || []).map((v) => (v || "").trim()),
                note: (r.note || "").trim(),
              })),
            }
          : { enabled: false, title: "", description: "", columns: [], rows: [] },
        template_id: chosenTpl?.id || null,
      };
      if (chosenTpl) updatePayload.puck_data = chosenTpl.puck_data ?? null;
      else updatePayload.puck_data = null;
      const { error } = await supabase.from("landing_pages").update(updatePayload).eq("id", editingLpId);
      if (error) {
        if (error.code === "23505") {
          toast({ title: "خطأ", description: "الرابط مستخدم مسبقاً", variant: "destructive" });
          return;
        }
        throw error;
      }
      setLandingPages((prev) => prev.map((lp) => lp.id === editingLpId ? {
        ...lp,
        slug: editLp.slug.trim(),
        title: editLp.title.trim(),
        subtitle: editLp.subtitle.trim(),
        is_visible: editLp.isVisible !== false,
      } : lp));
      setIsLpEditOpen(false);
      setEditingLpId(null);
      toast({ title: "تم", description: "تم تحديث صفحة الهبوط" });
    } catch (e) {
      console.error(e);
      toast({ title: "خطأ", description: "تعذر تحديث الصفحة", variant: "destructive" });
    } finally {
      setIsSavingLp(false);
    }
  };

  const handleDeleteLp = async () => {
    if (!deleteLpTarget) return;
    try {
      const { error } = await supabase.from("landing_pages").delete().eq("id", deleteLpTarget.id);
      if (error) throw error;
      setLandingPages((prev) => prev.filter((lp) => lp.id !== deleteLpTarget.id));
      toast({ title: "تم الحذف", description: "تم حذف صفحة الهبوط" });
      setDeleteLpTarget(null);
    } catch (e) {
      console.error(e);
      toast({ title: "خطأ", description: "تعذر الحذف", variant: "destructive" });
    }
  };

  const openCreateLpForProduct = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    setNewLp({
      ...emptyLandingPageData,
      productId,
      title: p?.name || "",
    });
    setActiveTab("landing");
    setIsLpAddOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">المنتجات</h1>
          <p className="text-sm text-muted-foreground">إدارة المنتجات وصفحات الهبوط</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            className="gap-2 w-full sm:w-auto"
            onClick={() => navigate("/dashboard/products/trash")}
          >
            <Trash2 className="w-4 h-4" />
            سلة المحذوفات
          </Button>
          <ProductsImportExport onDone={() => window.location.reload()} />
          <Button
            variant={strictStock ? "default" : "outline"}
            className="gap-2 w-full sm:w-auto"
            disabled={strictSaving}
            onClick={async () => {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) return;
              const next = !strictStock;
              setStrictSaving(true);
              const { error } = await supabase
                .from("profiles")
                .update({ strict_stock_enabled: next })
                .eq("user_id", user.id);
              setStrictSaving(false);
              if (error) {
                toast({ title: "خطأ", description: error.message, variant: "destructive" });
                return;
              }
              setStrictStock(next);
              toast({
                title: next ? "تم تفعيل تتبع المخزون الدقيق" : "تم إيقاف تتبع المخزون الدقيق",
                description: next
                  ? "سيتم رفض الطلبات الجديدة عند نفاد المخزون"
                  : "ستُقبل الطلبات حتى لو لم يتوفر المخزون",
              });
            }}
          >
            {strictStock ? <ShieldCheck className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
            {strictStock ? "تتبع المخزون الدقيق: مفعّل" : "تتبع المخزون الدقيق"}
          </Button>
          {activeTab === "products" ? (
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger asChild>
                <Button className="gradient-primary text-primary-foreground gap-2 w-full sm:w-auto">
                  <Plus className="w-4 h-4" />
                  إضافة منتج
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>إضافة منتج جديد</DialogTitle>
                </DialogHeader>
                <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
                  <ProductForm
                    mode="product"
                    product={newProduct}
                    onProductChange={setNewProduct}
                    onSubmit={handleAddProduct}
                    submitText="إضافة المنتج"
                    isLoading={isSaving}
                    categories={categories}
                  />
                </Suspense>
              </DialogContent>
            </Dialog>
          ) : (
            <Dialog open={isLpAddOpen} onOpenChange={(o) => {
              setIsLpAddOpen(o);
              if (o) {
                const def = lpTemplates.find((t) => t.is_default);
                if (def && !newLp.templateId) setNewLp((prev) => ({ ...prev, templateId: def.id }));
              } else {
                setNewLp(emptyLandingPageData);
              }
            }}>
              <DialogTrigger asChild>
                <Button className="gradient-primary text-primary-foreground gap-2 w-full sm:w-auto">
                  <Plus className="w-4 h-4" />
                  إنشاء صفحة هبوط
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>إنشاء صفحة هبوط جديدة</DialogTitle>
                </DialogHeader>
                <LandingPageForm
                  data={newLp}
                  onChange={setNewLp}
                  onSubmit={handleAddLp}
                  submitText="إنشاء الصفحة"
                  isLoading={isSavingLp}
                  products={products.map((p) => ({
                    id: p.id, name: p.name, price: p.price, original_price: p.original_price, images: p.images,
                  }))}
                  templates={lpTemplates.map((t) => ({ id: t.id, name: t.name, is_default: t.is_default }))}
                />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Edit Dialog - Full page */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent
          className="max-w-none w-screen h-screen sm:rounded-none p-0 gap-0 translate-x-0 translate-y-0 left-0 top-0 border-0 flex flex-col"
          aria-describedby={undefined}
        >
          <DialogHeader className="px-4 sm:px-6 py-4 border-b shrink-0">
            <DialogTitle>تعديل المنتج</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
            <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
              <ProductForm
                mode="product"
                product={editProduct}
                onProductChange={setEditProduct}
                onSubmit={handleEditProduct}
                submitText="حفظ التعديلات"
                isLoading={isSaving || isEditLoading}
                categories={categories}
                readOnlyStock
              />
            </Suspense>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Landing Page Dialog */}
      <Dialog open={isLpEditOpen} onOpenChange={(o) => { setIsLpEditOpen(o); if (!o) setEditingLpId(null); }}>
        <DialogContent
          className="max-w-none w-screen h-screen sm:rounded-none p-0 gap-0 translate-x-0 translate-y-0 left-0 top-0 border-0 flex flex-col"
          aria-describedby={undefined}
        >
          <DialogHeader className="px-4 sm:px-6 py-4 border-b shrink-0">
            <DialogTitle>تعديل صفحة الهبوط</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
            <LandingPageForm
              data={editLp}
              onChange={setEditLp}
              onSubmit={handleUpdateLp}
              submitText="حفظ التعديلات"
              isLoading={isSavingLp}
              lockProduct
              products={products.map((p) => ({
                id: p.id, name: p.name, price: p.price, original_price: p.original_price, images: p.images,
              }))}
              templates={lpTemplates.map((t) => ({ id: t.id, name: t.name, is_default: t.is_default }))}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
        <TabsList className="grid grid-cols-3 max-w-xl">
          <TabsTrigger value="products" className="gap-2">
            <Package className="w-4 h-4" />
            المنتجات ({products.length})
          </TabsTrigger>
          <TabsTrigger value="landing" className="gap-2">
            <Layout className="w-4 h-4" />
            صفحات الهبوط ({landingPages.length})
          </TabsTrigger>
          <TabsTrigger value="categories" className="gap-2">
            <FolderTree className="w-4 h-4" />
            الأقسام ({categories.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-6">
      {/* Category filter */}
      {categories.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
          <FolderTree className="w-4 h-4 text-muted-foreground" />
          <Select value={productFilterCategory} onValueChange={setProductFilterCategory}>
            <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">كل الأقسام ({products.length})</SelectItem>
              <SelectItem value="__none__">بدون قسم ({productCountByCategory["__none__"] || 0})</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name} ({productCountByCategory[c.id] || 0})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {/* Products Grid */}
      {(() => {
        const filteredProducts = productFilterCategory === "__all__"
          ? products
          : productFilterCategory === "__none__"
            ? products.filter((p) => !p.category_id)
            : products.filter((p) => p.category_id === productFilterCategory);
        return filteredProducts.length === 0 ? (
        <Card className="card-shadow">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="w-16 h-16 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">{products.length === 0 ? "لا توجد منتجات حالياً" : "لا توجد منتجات في هذا القسم"}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProducts.map((product) => (
            <Card key={product.id} className={`card-shadow overflow-hidden animate-slide-up ${!product.is_visible ? 'opacity-60' : ''}`}>
              <div className="aspect-video relative overflow-hidden bg-muted">
                {product.images[0] ? (
                  <img
                    src={product.images[0]}
                    alt={product.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Package className="w-10 h-10 text-muted-foreground/50" />
                  </div>
                )}
                {product.images.length > 1 && (
                  <span className="absolute bottom-2 left-2 bg-foreground/70 text-background text-xs px-2 py-1 rounded">
                    +{product.images.length - 1} صور
                  </span>
                )}
                {!product.is_visible && (
                  <span className="absolute top-2 right-2 bg-destructive text-destructive-foreground text-xs px-2 py-1 rounded font-semibold">
                    مخفي
                  </span>
                )}
              </div>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-foreground">{isolateLatin(product.name)}</h3>
                  <div className="text-left">
                    <span className="text-primary font-bold">{product.price} {storeSettings.currency_symbol}</span>
                    {product.original_price && (
                      <span className="text-muted-foreground line-through text-sm mr-2">
                        {product.original_price} {storeSettings.currency_symbol}
                      </span>
                    )}
                  </div>
                </div>

                {/* Landing pages indicator */}
                <div className="flex items-center justify-between gap-2 mb-4 p-2 bg-muted rounded-lg">
                  <div className="flex items-center gap-2 min-w-0">
                    <Layout className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground truncate">
                      {lpCountByProduct[product.id] || 0} صفحة هبوط
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs gap-1 text-primary hover:text-primary"
                    onClick={() => openCreateLpForProduct(product.id)}
                  >
                    <Plus className="w-3 h-3" />
                    إضافة
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => toggleVisibility(product)}
                    className={`flex-1 min-w-0 px-2 sm:px-3 shadow-md hover:shadow-lg transition-all ${
                      product.is_visible
                        ? "bg-amber-500 hover:bg-amber-600 text-white"
                        : "bg-green-500 hover:bg-green-600 text-white"
                    }`}
                    title={product.is_visible ? "إخفاء المنتج" : "إظهار المنتج"}
                  >
                    {product.is_visible ? (
                      <EyeOff className="w-3 h-3 sm:w-4 sm:h-4" />
                    ) : (
                      <Eye className="w-3 h-3 sm:w-4 sm:h-4" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => openEditDialog(product)}
                    className="px-2 sm:px-3 bg-sky-500 hover:bg-sky-600 text-white shadow-md hover:shadow-lg transition-all"
                  >
                    <Edit className="w-3 h-3 sm:w-4 sm:h-4" />
                  </Button>
                  <Button
                    size="sm"
                    className="bg-red-500 hover:bg-red-600 text-white shadow-md hover:shadow-lg transition-all px-2 sm:px-3"
                    onClick={() => setDeleteTarget(product)}
                  >
                    <Trash2 className="w-3 h-3 sm:w-4 sm:h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      );
      })()}
        </TabsContent>

        <TabsContent value="landing" className="mt-6">
          {(landingPages.length > 0) && (
            <div className="flex flex-col sm:flex-row gap-2 mb-4">
              <Select value={lpFilterCategory} onValueChange={setLpFilterCategory}>
                <SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="فلتر القسم" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">كل الأقسام</SelectItem>
                  <SelectItem value="__none__">بدون قسم</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={lpFilterProduct} onValueChange={setLpFilterProduct}>
                <SelectTrigger className="w-full sm:w-72"><SelectValue placeholder="فلتر المنتج" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">كل المنتجات</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {(() => {
            const filteredLps = enrichedLandingPages.filter((lp) => {
              if (lpFilterProduct !== "__all__" && lp.product_id !== lpFilterProduct) return false;
              if (lpFilterCategory !== "__all__") {
                const prod = products.find((p) => p.id === lp.product_id);
                const cat = prod?.category_id || null;
                if (lpFilterCategory === "__none__") { if (cat) return false; }
                else if (cat !== lpFilterCategory) return false;
              }
              return true;
            });
            return filteredLps.length === 0 ? (
            <Card className="card-shadow">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Layout className="w-16 h-16 text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-2">{enrichedLandingPages.length === 0 ? "لا توجد صفحات هبوط بعد" : "لا توجد نتائج بهذا الفلتر"}</p>
                <p className="text-xs text-muted-foreground">اضغط «إنشاء صفحة هبوط» لإنشاء صفحة جديدة مرتبطة بأحد منتجاتك</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredLps.map((lp) => (
                <Card key={lp.id} className={`card-shadow overflow-hidden ${!lp.is_visible ? 'opacity-60' : ''}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      {lp.product_image ? (
                        <img src={lp.product_image} alt="" className="w-14 h-14 object-cover rounded shrink-0" />
                      ) : (
                        <div className="w-14 h-14 rounded bg-muted flex items-center justify-center shrink-0">
                          <Package className="w-6 h-6 text-muted-foreground/50" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-foreground truncate">{isolateLatin(lp.title)}</h3>
                          {!lp.is_visible && (
                            <Badge variant="destructive" className="text-[10px]">مخفي</Badge>
                          )}
                        </div>
                        {lp.subtitle && (
                          <p className="text-xs text-muted-foreground truncate">{lp.subtitle}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Link2 className="w-3 h-3" /> {lp.product_name || "—"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                      <span className="text-xs text-muted-foreground truncate flex-1" dir="ltr">/p/{lp.slug}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyProductUrl(lp.slug)}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="flex-1 min-w-0 gap-1 text-xs bg-blue-500 hover:bg-blue-600 text-white"
                        onClick={() => openPreviewPage(lp.slug)}
                      >
                        <Eye className="w-3 h-3" />
                        معاينة
                        <ExternalLink className="w-2.5 h-2.5" />
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => openEditLp(lp)}
                        className="px-2 bg-sky-500 hover:bg-sky-600 text-white"
                      >
                        <Edit className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        className="bg-red-500 hover:bg-red-600 text-white px-2"
                        onClick={() => setDeleteLpTarget(lp)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          );
          })()}
        </TabsContent>

        <TabsContent value="categories" className="mt-6">
          <Card className="card-shadow">
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCategory(); } }}
                  placeholder="اسم القسم الجديد (مثال: ملابس رجالية)"
                />
                <Button onClick={handleAddCategory} className="gradient-primary text-primary-foreground gap-2">
                  <Plus className="w-4 h-4" />
                  إضافة قسم
                </Button>
              </div>
              {categories.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">لا توجد أقسام بعد</div>
              ) : (
                <div className="divide-y border rounded-lg">
                  {categories.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 p-3">
                      <FolderTree className="w-4 h-4 text-muted-foreground shrink-0" />
                      {editingCategoryId === c.id ? (
                        <Input
                          value={editingCategoryName}
                          onChange={(e) => setEditingCategoryName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleRenameCategory(c.id); } }}
                          className="flex-1"
                          autoFocus
                        />
                      ) : (
                        <span className="flex-1 font-medium">{c.name}</span>
                      )}
                      <Badge variant="secondary" className="text-xs">{productCountByCategory[c.id] || 0} منتج</Badge>
                      {editingCategoryId === c.id ? (
                        <Button size="sm" onClick={() => handleRenameCategory(c.id)} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                          <Save className="w-3.5 h-3.5" />
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => { setEditingCategoryId(c.id); setEditingCategoryName(c.name); }}>
                          <Edit className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button size="sm" className="bg-red-500 hover:bg-red-600 text-white" onClick={() => setDeleteCategoryTarget(c)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حذف المنتج</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف المنتج «{deleteTarget?.name}»؟
              سيتم نقله إلى سلة المحذوفات ويمكنك استعادته لاحقاً.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={isDeleting}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "نقل إلى السلة"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteLpTarget} onOpenChange={(open) => !open && setDeleteLpTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حذف صفحة الهبوط</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف صفحة الهبوط «{deleteLpTarget?.title}»؟
              لن يتأثر المنتج المرتبط، فقط الصفحة سيتم حذفها نهائيًا.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteLp(); }}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteCategoryTarget} onOpenChange={(open) => !open && setDeleteCategoryTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حذف القسم</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف القسم «{deleteCategoryTarget?.name}»؟
              سيتم إزالته من المنتجات المرتبطة دون حذفها.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDeleteCategory(); }}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Products;
