/* Compatibility endpoint for older WordPress versions. */
export { GET, OPTIONS } from "@/app/api/public/directory/route";
export const dynamic = "force-dynamic";
export const revalidate = 0;
