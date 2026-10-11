import "server-only";

import { createMediaCreditPayments, type MediaCreditOrder } from "@/lib/boutique/mediaCreditPayments";
import { findImageCreditPack } from "@/lib/boutique/imageCreditPacks";

export type ImageCreditOrder = MediaCreditOrder & {
  images: number; revoked_images: number; held_images: number; dispute_revoked_images: number;
};
export const IMAGE_CREDIT_PAYMENT_KIND = "inrcy_image_credits_v1";
const payments = createMediaCreditPayments({ mediaKind: "image", unit: "images", findPack: findImageCreditPack });

export const getImageCreditOrder = payments.getOrder as (orderId: string, accountId?: string) => Promise<ImageCreditOrder | null>;
export const validateImageCreditPrice = payments.validatePrice;
export const startImageCreditCheckout = payments.startCheckout;
export const fulfillImageCreditCheckout = payments.fulfillCheckout;
export const reconcileImageCreditDispute = payments.reconcileDispute;
export const reconcileImageCreditRefund = payments.reconcileRefund;
