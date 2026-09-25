/** Theme token helpers for Deno edge (mirrors src/lib/themeTokens.ts). */

export interface StoreThemeTokens {
  preset?: string;
  primary?: string;
  primaryForeground?: string;
  accent?: string;
  secondary?: string;
  background?: string;
  foreground?: string;
  card?: string;
  cardForeground?: string;
  muted?: string;
  mutedForeground?: string;
  border?: string;
  headerBg?: string;
  buttonRadius?: string;
  sectionRadius?: string;
  fontFamily?: string;
  headingFont?: string;
  buttonStyle?: string;
  headerStyle?: string;
  shadow?: string;
}

const DEFAULT: StoreThemeTokens = {
  preset: "ocean-pro",
  primary: "217 91% 50%",
  primaryForeground: "0 0% 100%",
  accent: "217 91% 45%",
  secondary: "217 40% 92%",
  background: "220 20% 97%",
  foreground: "222 47% 11%",
  card: "0 0% 100%",
  cardForeground: "222 47% 11%",
  muted: "220 14% 94%",
  mutedForeground: "220 10% 40%",
  border: "220 13% 88%",
  headerBg: "0 0% 100%",
  buttonRadius: "0.75rem",
  sectionRadius: "1rem",
  fontFamily: "Cairo, system-ui, sans-serif",
  headingFont: "Cairo, system-ui, sans-serif",
  buttonStyle: "gradient",
  headerStyle: "solid",
  shadow: "soft",
};

const SHADOW_CSS: Record<string, string> = {
  none: "none",
  soft: "0 2px 8px hsl(var(--store-primary) / 0.08)",
  medium: "0 8px 24px hsl(var(--store-primary) / 0.12)",
  strong: "0 16px 48px hsl(var(--store-primary) / 0.18)",
};

export function parseThemeTokens(raw: unknown): StoreThemeTokens {
  if (!raw || typeof raw !== "object") return { ...DEFAULT };
  const o = raw as Record<string, unknown>;
  return {
    ...DEFAULT,
    ...Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "string")),
  };
}

function themeTokensToCssVars(tokens: StoreThemeTokens): Record<string, string> {
  const t = { ...DEFAULT, ...tokens };
  return {
    "--store-primary": t.primary!,
    "--store-primary-fg": t.primaryForeground!,
    "--store-accent": t.accent!,
    "--store-secondary": t.secondary || t.muted || "220 14% 94%",
    "--store-bg": t.background!,
    "--store-fg": t.foreground!,
    "--store-card": t.card || "0 0% 100%",
    "--store-card-fg": t.cardForeground || t.foreground!,
    "--store-muted": t.muted || "220 14% 94%",
    "--store-muted-fg": t.mutedForeground || "220 10% 40%",
    "--store-border": t.border || "220 13% 88%",
    "--store-header-bg": t.headerBg || "0 0% 100%",
    "--store-radius": t.buttonRadius || "0.75rem",
    "--store-section-radius": t.sectionRadius || "1rem",
    "--store-font": t.fontFamily || DEFAULT.fontFamily!,
    "--store-heading-font": t.headingFont || t.fontFamily || DEFAULT.fontFamily!,
    "--store-shadow": SHADOW_CSS[t.shadow || "soft"] || SHADOW_CSS.soft,
  };
}

export function themeTokensToSsrCssFromTokens(
  tokens: StoreThemeTokens,
  scope = "#root",
  customCss?: string | null
): string {
  const vars = themeTokensToCssVars(tokens);
  const entries = Object.entries(vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join("");
  const custom = customCss?.trim()
    ? `\n${scope}, .store-theme-scope { ${customCss} }`
    : "";
  return `${scope}, .store-theme-scope { ${entries} font-family: var(--store-font); direction: rtl; background: hsl(var(--store-bg)); color: hsl(var(--store-fg)); }
${scope} .text-primary { color: hsl(var(--store-primary)) !important; }
${scope} .bg-primary, ${scope} .gradient-primary { background: hsl(var(--store-primary)) !important; color: hsl(var(--store-primary-fg)) !important; border-radius: var(--store-radius); }${custom}`;
}
