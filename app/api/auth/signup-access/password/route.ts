import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { getTemporaryPasswordMetadata } from "@/lib/temporaryPasswordPolicy";
import { openSignupAccess, signupAccessMatchesUser, SIGNUP_ACCESS_COOKIE } from "@/lib/signupImmediateAccessPolicy";
import { signupAccessSecret } from "@/lib/signupImmediateAccessServer";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const responseHeaders = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ required: false }, { status: 403, headers: responseHeaders });
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return NextResponse.json({ required: false }, { status: 401, headers: responseHeaders });
  const temporary = getTemporaryPasswordMetadata(data.user.app_metadata);
  const cookieStore = await cookies();
  const claims = openSignupAccess(cookieStore.get(SIGNUP_ACCESS_COOKIE)?.value, signupAccessSecret());
  const currentPassword = claims && signupAccessMatchesUser(claims, data.user) ? claims.password : undefined;
  // Hand off the password once, to the authenticated account only. React retains
  // it in component memory until save/skip/unmount; it is never browser storage.
  cookieStore.set(SIGNUP_ACCESS_COOKIE, "", { httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "strict", path: "/api/auth/signup-access", maxAge: 0 });
  return NextResponse.json({ required: Boolean(temporary), email: data.user.email, ...(temporary && currentPassword ? { currentPassword } : {}) }, { headers: responseHeaders });
}
