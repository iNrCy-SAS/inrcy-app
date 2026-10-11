import "server-only";

import { createMediaCreditPayments, type MediaCreditOrder } from "@/lib/boutique/mediaCreditPayments";
import { findVideoCreditPack } from "@/lib/boutique/videoCreditPacks";

export type VideoCreditOrder = MediaCreditOrder & {
  seconds: number; revoked_seconds: number; held_seconds: number; dispute_revoked_seconds: number;
};
export const VIDEO_CREDIT_PAYMENT_KIND = "inrcy_video_credits_v1";
const payments = createMediaCreditPayments({ mediaKind: "video", unit: "seconds", findPack: findVideoCreditPack });

export const getVideoCreditOrder = payments.getOrder as (orderId: string, accountId?: string) => Promise<VideoCreditOrder | null>;
export const validateVideoCreditPrice = payments.validatePrice;
export const startVideoCreditCheckout = payments.startCheckout;
export const fulfillVideoCreditCheckout = payments.fulfillCheckout;
export const reconcileVideoCreditDispute = payments.reconcileDispute;
export const reconcileVideoCreditRefund = payments.reconcileRefund;
