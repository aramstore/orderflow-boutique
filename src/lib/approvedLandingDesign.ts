import type { LandingSectionId } from "./landingSectionOrder";

export const APPROVED_LANDING_DESIGN_VERSION = "standard-approved-v1";

export const APPROVED_LANDING_SECTION_ORDER = [
  "images", "hero", "order", "description", "reviews", "faq",
] as const satisfies readonly LandingSectionId[];

/** Approved visual settings only; product content remains supplied by each page. */
export const APPROVED_LANDING_DESIGN = {
  pageBg: "#07375f",
  maxWidth: 1152,
  mainPadding: 24,
  gridGap: 32,
  sectionGap: 48,
  radius: 24,
  headerSize: 14,
  headerDesktop: 18,
  headerWeight: 600,
  headerPadding: 3,
  headerGap: 12,
  headerBg: "#09142f",
  headerColor: "#ffffff",
  headerVisible: true,
  heroSize: 17,
  heroDesktop: 28,
  heroWeight: 600,
  heroPadding: 16,
  heroLineHeight: 1.5,
  heroBg: "#09142f",
  heroColor: "#ffffff",
  heroVisible: true,
  offerBadge: false,
  guaranteeBadge: false,
  animations: true,
  imagePadding: 0,
  imageRatio: "4 / 5",
  imageFit: "cover",
  bestsellerBadge: false,
  formBg: "#ffffff",
  formPadding: 16,
  buttonBg: "#d97706",
  buttonColor: "#0f172a",
  buttonRadius: 17,
  buttonHeight: 52,
  descriptionVisible: true,
  reviewsVisible: true,
  faqVisible: true,
  stickyVisible: true,
} as const;
