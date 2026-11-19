import { POST as provisionSignup } from "../trial-signup/route";

export const runtime = "nodejs";

/** The fixed server route selects direct purchase; request fields cannot do so. */
export async function POST(request: Request) {
  return provisionSignup(request);
}
