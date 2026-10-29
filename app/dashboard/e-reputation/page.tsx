import { redirect } from "next/navigation";

export default function GoogleReviewsRedirect() {
  redirect("/dashboard?panel=gmb&googleReviews=1");
}
