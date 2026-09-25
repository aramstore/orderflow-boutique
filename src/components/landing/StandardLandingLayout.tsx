import { Fragment, type ReactNode } from "react";
import { LANDING_SECTION_ORDER, normalizeLandingSectionOrder, type LandingSectionId } from "@/lib/landingSectionOrder";

interface StandardLandingLayoutProps {
  hero: ReactNode;
  images: ReactNode;
  order: ReactNode;
  description: ReactNode;
  reviews: ReactNode;
  faq: ReactNode;
  formFirst?: boolean;
  sectionOrder?: readonly LandingSectionId[];
}

/** Uses the original layout unless a different section order is explicitly provided. */
export default function StandardLandingLayout(props: StandardLandingLayoutProps) {
  const { hero, images, order, description, reviews, faq, formFirst = false, sectionOrder } = props;
  const sequence = normalizeLandingSectionOrder(sectionOrder, formFirst);
  const regularOrder = LANDING_SECTION_ORDER.every((id, index) => sequence[index] === id);
  if (!sectionOrder || regularOrder) {
    return (
      <>
        {hero}
        <main data-wasla-part="main" className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-6 sm:py-12">
          <div data-wasla-part="checkout-grid" className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
            <div data-wasla-section="images" className={!sectionOrder && formFirst ? "order-2 lg:order-1" : ""}>{images}</div>
            <div data-wasla-section="order" className={`lg:sticky lg:top-24 h-fit ${!sectionOrder && formFirst ? "order-1 lg:order-2" : ""}`}>{order}</div>
          </div>
          {description}{reviews}{faq}
        </main>
      </>
    );
  }

  const rows: LandingSectionId[][] = [];
  for (let index = 0; index < sequence.length; index++) {
    const current = sequence[index]; const next = sequence[index + 1];
    // Adjacent image and checkout sections retain the original desktop columns.
    if ((current === "images" && next === "order") || (current === "order" && next === "images")) {
      rows.push([current, next]); index++;
    } else rows.push([current]);
  }
  const checkoutSection = (id: "images" | "order", paired: boolean) => (
    <div key={id} data-wasla-section={id}
      className={id === "order" && paired ? "lg:sticky lg:top-24 h-fit" : ""}
      style={paired ? undefined : { maxWidth: id === "images" ? 640 : 720, width: "100%", marginInline: "auto" }}>
      {props[id]}
    </div>
  );
  return (
    <main data-wasla-layout="ordered">
      {rows.map(row => {
        const key = row.join("-");
        if (row[0] === "hero") return <Fragment key={key}>{hero}</Fragment>;
        const isCheckout = row[0] === "images" || row[0] === "order";
        return (
          <div key={key} data-wasla-part="main" data-wasla-row={isCheckout ? "checkout" : "content"}
            className="w-full max-w-6xl mx-auto px-3 sm:px-6"
            style={{ paddingBlock: isCheckout ? 24 : 0 }}>
            {row.length === 2 ? (
              <div data-wasla-part="checkout-grid" className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
                {row.map(id => checkoutSection(id as "images" | "order", true))}
              </div>
            ) : isCheckout ? checkoutSection(row[0] as "images" | "order", false) : props[row[0]]}
          </div>
        );
      })}
    </main>
  );
}
