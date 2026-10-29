import { NextResponse } from "next/server";
import { getGmbToken } from "@/lib/googleBusiness";
import { getGmbReviewTargetFromRow, gmbListReviews } from "@/lib/googleBusinessReviews";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { asRecord, asString } from "@/lib/tsSafe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function resolveGoogleBusinessUrl(row: unknown, locationTitle: string | null) {
  const metaUrl = asString(asRecord(asRecord(row).meta).url);
  if (metaUrl) return metaUrl;
  const cleanTitle = String(locationTitle || "").trim();
  return cleanTitle
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleanTitle)}`
    : null;
}

export async function GET(req: Request) {
  try {
    const { errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    const token = await getGmbToken();
    if (!token?.accessToken) {
      return NextResponse.json({
        connected: false,
        configured: false,
        accountName: null,
        locationName: null,
        locationTitle: null,
        reportUrl: null,
        averageRating: null,
        totalReviewCount: 0,
        nextPageToken: null,
        reviews: [],
      });
    }

    const target = getGmbReviewTargetFromRow(token.row);
    if (!target.accountName || !target.locationName) {
      return NextResponse.json({
        connected: true,
        configured: false,
        accountName: target.accountName,
        locationName: target.locationName,
        locationTitle: target.locationTitle,
        reportUrl: resolveGoogleBusinessUrl(token.row, target.locationTitle),
        averageRating: null,
        totalReviewCount: 0,
        nextPageToken: null,
        reviews: [],
      });
    }

    const url = new URL(req.url);
    const expectedLocation = url.searchParams.get("locationName");
    if (expectedLocation && expectedLocation !== target.locationName) {
      return NextResponse.json({ error: "google_business_selection_changed", user_message: "La fiche Google sélectionnée a changé. Fermez puis rouvrez les avis." }, { status: 409 });
    }
    const pageSize = Number(url.searchParams.get("pageSize") || 50);
    const pageToken = url.searchParams.get("pageToken");
    const requestedOrderBy = url.searchParams.get("orderBy") || "updateTime desc";
    const orderBy = ["updateTime desc", "rating desc"].includes(requestedOrderBy) ? requestedOrderBy : "updateTime desc";

    const payload = await gmbListReviews(token.accessToken, target.accountName, target.locationName, {
      pageSize,
      pageToken,
      orderBy,
    });

    return NextResponse.json({
      ...payload,
      connected: true,
      configured: true,
      accountName: target.accountName,
      locationName: target.locationName,
      locationTitle: target.locationTitle,
      reportUrl: resolveGoogleBusinessUrl(token.row, target.locationTitle),
    });
  } catch (error) {
    return jsonUserFacingError(error, {
      status: 500,
      fallback: "Impossible de charger les avis Google pour le moment.",
    });
  }
}
