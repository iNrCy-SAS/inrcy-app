import { createPublicationChannelHandlers } from "@/lib/inrsend/publicationChannelActions";

// Keep the historical action URL usable for already-open publication views.
export const { PATCH, DELETE } = createPublicationChannelHandlers("site_web");
