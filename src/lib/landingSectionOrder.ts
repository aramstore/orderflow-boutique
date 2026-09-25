export const LANDING_SECTION_ORDER = [
  "hero", "images", "order", "description", "reviews", "faq",
] as const;

export type LandingSectionId = (typeof LANDING_SECTION_ORDER)[number];

const knownSections = new Set<string>(LANDING_SECTION_ORDER);

/** An explicit order takes precedence over the legacy form-first setting. */
export function normalizeLandingSectionOrder(
  value: unknown,
  formFirst = false,
): LandingSectionId[] {
  const result: LandingSectionId[] = [];
  if (Array.isArray(value)) {
    for (const section of value) {
      if (typeof section === "string" && knownSections.has(section)) {
        const id = section as LandingSectionId;
        if (!result.includes(id)) result.push(id);
      }
    }
  }

  if (result.length === 0 && formFirst) {
    return ["hero", "order", "images", "description", "reviews", "faq"];
  }

  for (const section of LANDING_SECTION_ORDER) {
    if (!result.includes(section)) result.push(section);
  }
  return result;
}

/** Move one section without changing the caller's array or dropping any section. */
export function moveLandingSection(
  order: unknown,
  section: LandingSectionId,
  direction: -1 | 1,
): LandingSectionId[] {
  const result = normalizeLandingSectionOrder(order);
  const index = result.indexOf(section);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= result.length) return result;
  [result[index], result[destination]] = [result[destination], result[index]];
  return result;
}
