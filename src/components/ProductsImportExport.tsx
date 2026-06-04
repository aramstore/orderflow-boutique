import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Upload, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useUserContext } from "@/hooks/useUserContext";
import { useStoreContext } from "@/hooks/useStoreContext";

const EXPORT_VERSION = 1;

const stripCommon = (row: any) => {
  const { id, owner_id, store_id, created_at, updated_at, ...rest } = row;
  return { _oldId: id, ...rest };
};

const uniqueSlug = async (table: "products" | "landing_pages", base: string, ownerId: string) => {
  let candidate = base || `item-${Date.now()}`;
  let i = 0;
  while (true) {
    const q = supabase.from(table).select("id", { head: true, count: "exact" }).eq("slug", candidate);
    const { count } = table === "products" ? await q.eq("owner_id", ownerId) : await q;
    if (!count) return candidate;
    i += 1;
    candidate = `${base}-${i}`;
  }
};

export const ProductsImportExport = ({ onDone }: { onDone?: () => void }) => {
  const { effectiveOwnerId } = useUserContext();
  const { activeStoreId } = useStoreContext();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportData = async () => {
    if (!activeStoreId) {
      toast({ title: "اختر متجراً أولاً", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const [{ data: products, error: pErr }, { data: lps, error: lErr }] = await Promise.all([
        supabase.from("products").select("*").eq("store_id", activeStoreId).is("deleted_at", null),
        supabase.from("landing_pages").select("*").eq("store_id", activeStoreId),
      ]);
      if (pErr) throw pErr;
      if (lErr) throw lErr;

      const payload = {
        version: EXPORT_VERSION,
        exported_at: new Date().toISOString(),
        counts: { products: products?.length || 0, landing_pages: lps?.length || 0 },
        products: products || [],
        landing_pages: lps || [],
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `libya-store-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({
        title: "تم التصدير",
        description: `${payload.counts.products} منتج، ${payload.counts.landing_pages} صفحة هبوط`,
      });
    } catch (e: any) {
      toast({ title: "تعذر التصدير", description: e?.message || "خطأ", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const importData = async (file: File) => {
    if (!effectiveOwnerId || !activeStoreId) {
      toast({ title: "اختر متجراً أولاً", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.products) || !Array.isArray(data.landing_pages)) {
        throw new Error("ملف غير صالح");
      }

      const idMap = new Map<string, string>(); // oldProductId -> newProductId
      let productsAdded = 0;
      let lpsAdded = 0;

      // Insert products one-by-one so we can pick a unique slug per row.
      for (const raw of data.products) {
        const cleaned = stripCommon(raw);
        const oldId = cleaned._oldId;
        delete cleaned._oldId;
        // category_id won't exist on this account — drop it
        delete cleaned.category_id;
        // easyorders linkage doesn't carry over
        cleaned.easyorders_product_id = null;
        cleaned.variant_easyorders_ids = {};

        const baseSlug = (cleaned.slug || "product").toString();
        cleaned.slug = await uniqueSlug("products", baseSlug, effectiveOwnerId);
        cleaned.owner_id = effectiveOwnerId;
        cleaned.store_id = activeStoreId;

        const { data: ins, error } = await supabase
          .from("products")
          .insert(cleaned)
          .select("id")
          .single();
        if (error) throw new Error(`منتج "${cleaned.name}": ${error.message}`);
        if (oldId) idMap.set(oldId, ins.id);
        productsAdded += 1;
      }

      for (const raw of data.landing_pages) {
        const cleaned = stripCommon(raw);
        delete cleaned._oldId;
        const oldProductId = cleaned.product_id;
        const newProductId = idMap.get(oldProductId);
        if (!newProductId) {
          // skip landing pages whose product wasn't in the export
          continue;
        }
        cleaned.product_id = newProductId;
        // template_id from another account most likely won't exist
        delete cleaned.template_id;

        const baseSlug = (cleaned.slug || "page").toString();
        cleaned.slug = await uniqueSlug("landing_pages", baseSlug, effectiveOwnerId);
        cleaned.owner_id = effectiveOwnerId;
        cleaned.store_id = activeStoreId;

        const { error } = await supabase.from("landing_pages").insert(cleaned);
        if (error) throw new Error(`صفحة "${cleaned.title || cleaned.slug}": ${error.message}`);
        lpsAdded += 1;
      }

      toast({
        title: "تم الاستيراد",
        description: `${productsAdded} منتج، ${lpsAdded} صفحة هبوط`,
      });
      onDone?.();
    } catch (e: any) {
      toast({ title: "تعذر الاستيراد", description: e?.message || "خطأ", variant: "destructive" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importData(f);
        }}
      />
      <Button
        variant="outline"
        className="gap-2 w-full sm:w-auto"
        disabled={busy}
        onClick={exportData}
        title="تصدير المنتجات وصفحات الهبوط مع الصور"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        تصدير
      </Button>
      <Button
        variant="outline"
        className="gap-2 w-full sm:w-auto"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        title="استيراد من ملف JSON"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        استيراد
      </Button>
    </>
  );
};