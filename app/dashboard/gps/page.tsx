import { redirect } from "next/navigation";

/** Keep existing GPS bookmarks and mobile links on the unified help entry. */
export default function Page() {
  redirect("/dashboard?help=1");
}
