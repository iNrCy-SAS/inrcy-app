import "server-only";

import {
  collectStripeListPages,
} from "@/lib/adminSubscriberPagination";
import {
  stripeAdminSubscriberSnapshot,
  type StripeAdminSubscriberSnapshot,
} from "@/lib/adminSubscriberStripe";
import { stripeGet } from "@/lib/stripeRest";

type StripeListResponse = {
  data?: unknown;
  has_more?: unknown;
};

export type StripeAdminSubscriberSnapshotResult = {
  snapshots: StripeAdminSubscriberSnapshot[];
  pages: number;
  subscriptions_scanned: number;
};

export async function listStripeAdminSubscriberSnapshots(): Promise<StripeAdminSubscriberSnapshotResult> {
  const { rows, pages } = await collectStripeListPages<unknown>({
    pageSize: 100,
    getId: (row) => {
      if (!row || typeof row !== "object") return null;
      const id = (row as Record<string, unknown>).id;
      return typeof id === "string" && id.trim() ? id.trim() : null;
    },
    fetchPage: async (startingAfter, limit) => {
      const params = new URLSearchParams({
        status: "all",
        limit: String(limit),
      });
      params.append("expand[]", "data.customer");
      if (startingAfter) params.set("starting_after", startingAfter);

      const response = (await stripeGet(`/subscriptions?${params.toString()}`)) as StripeListResponse;
      if (!Array.isArray(response?.data) || typeof response?.has_more !== "boolean") {
        throw new Error("stripe_subscription_list_malformed");
      }
      return {
        data: response.data,
        hasMore: response.has_more,
      };
    },
  });

  const bySubscriptionId = new Map<string, StripeAdminSubscriberSnapshot>();
  for (const row of rows) {
    const snapshot = stripeAdminSubscriberSnapshot(row);
    if (snapshot) bySubscriptionId.set(snapshot.subscription_id, snapshot);
  }

  return {
    snapshots: Array.from(bySubscriptionId.values()),
    pages,
    subscriptions_scanned: rows.length,
  };
}
