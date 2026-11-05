import { redirect } from "next/navigation";
import { PRODUCT_GOOGLE_REVIEWS_HREF } from "../../../lib/productNavigation.ts";

export default function GoogleReviewsRedirect() {
  redirect(PRODUCT_GOOGLE_REVIEWS_HREF);
}
