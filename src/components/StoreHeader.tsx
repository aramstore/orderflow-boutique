import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Phone, Mail, Instagram, Facebook, Music2, MessageCircle } from "lucide-react";

export interface HeaderSettings {
  logo_text: string;
  logo_image: string | null;
  tagline: string | null;
  phone: string | null;
  email: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  whatsapp_url: string | null;
  tiktok_url: string | null;
}

const DEFAULTS: HeaderSettings = {
  logo_text: "",
  logo_image: null,
  tagline: "",
  phone: "",
  email: "",
  instagram_url: "",
  facebook_url: "",
  whatsapp_url: "",
  tiktok_url: "",
};

interface StoreHeaderProps {
  ownerId?: string;
  storeId?: string;
  variant?: "default" | "landing";
}

const StoreHeader = ({ ownerId, storeId, variant = "default" }: StoreHeaderProps = {}) => {
  const [settings, setSettings] = useState<HeaderSettings>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    if (!ownerId) return;
    let q = supabase
      .from("header_settings")
      .select("logo_text, logo_image, tagline, phone, email, instagram_url, facebook_url, whatsapp_url, tiktok_url, owner_id")
      .eq("owner_id", ownerId);
    if (storeId) q = q.eq("store_id", storeId);
    q.limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setSettings(data as HeaderSettings);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId, storeId]);

  const hasContact = settings.phone || settings.email;
  const hasSocial =
    settings.instagram_url || settings.facebook_url || settings.whatsapp_url || settings.tiktok_url;

  return (
    <header data-wasla-section="header" className={`w-full bg-gradient-to-l from-primary/10 via-background to-primary/5 border-b border-border rounded-lg overflow-hidden ${variant === "landing" ? "mb-3" : "mb-6"}`} dir="rtl">
      {/* Top contact bar */}
      {(hasContact || hasSocial) && (
        <div className="bg-foreground/95 text-background text-xs sm:text-sm">
          <div className="container mx-auto px-4 py-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4">
              {settings.phone && (
                <a href={`tel:${settings.phone}`} className="flex items-center gap-1.5 hover:text-primary transition-colors">
                  <Phone className="w-3.5 h-3.5" />
                  <span dir="ltr">{settings.phone}</span>
                </a>
              )}
              {settings.email && (
                <a href={`mailto:${settings.email}`} className="flex items-center gap-1.5 hover:text-primary transition-colors">
                  <Mail className="w-3.5 h-3.5" />
                  <span dir="ltr">{settings.email}</span>
                </a>
              )}
            </div>
            {hasSocial && (
              <div className="flex items-center gap-3">
                {[
                  { url: settings.instagram_url, Icon: Instagram, label: "Instagram" },
                  { url: settings.facebook_url, Icon: Facebook, label: "Facebook" },
                  { url: settings.tiktok_url, Icon: Music2, label: "TikTok" },
                  { url: settings.whatsapp_url, Icon: MessageCircle, label: "WhatsApp" },
                ].filter(s => s.url).map(({ url, Icon, label }) => (
                  <a
                    key={label}
                    href={url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className="hover:text-primary transition-colors"
                    onClick={(e) => {
                      e.preventDefault();
                      try {
                        (window.top || window).open(url!, "_blank", "noopener,noreferrer");
                      } catch {
                        window.open(url!, "_blank", "noopener,noreferrer");
                      }
                    }}
                  >
                    <Icon className="w-4 h-4" />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main header */}
      <div data-wasla-part="brand-row" className={`container mx-auto px-4 flex flex-col sm:flex-row items-center ${variant === "landing" ? "min-h-14 py-2 sm:py-3 gap-2 justify-center sm:justify-between" : "py-6 gap-4 justify-between"}`}>
        <div className={variant === "landing" ? "flex min-w-0 max-w-full items-center gap-2.5" : "flex items-center gap-4"}>
          {settings.logo_image && (
            <img
              src={settings.logo_image}
              alt={settings.logo_text}
              className={`${variant === "landing" ? "w-8 h-8 sm:w-10 sm:h-10 shrink-0" : "w-14 h-14 sm:w-16 sm:h-16"} rounded-full object-cover border-2 border-primary/30`}
              loading="eager"
            />
          )}
          <div className={`${variant === "landing" ? "min-w-0 " : ""}text-center sm:text-right`}>
            {variant === "landing" ? (
              <p data-wasla-part="store-name" className="text-base sm:text-lg font-semibold leading-6 text-foreground break-words">
                {settings.logo_text}
              </p>
            ) : (
              <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
                {settings.logo_text}
              </h1>
            )}
            {settings.tagline && (
              <p className={`${variant === "landing" ? "text-xs sm:text-sm" : "text-sm sm:text-base"} text-muted-foreground mt-1`}>{settings.tagline}</p>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default StoreHeader;
