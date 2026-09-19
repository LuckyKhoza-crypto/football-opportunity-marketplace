import { redirect } from "next/navigation";
import { getSafeCallbackUrl } from "@/lib/invite-callback";

/**
 * TEAM-003 — Signup page.
 *
 * The project uses Google OAuth as the primary signup mechanism, so this
 * page redirects to /login. When a callbackUrl is present (e.g. from an
 * invite link), it is validated and preserved through the redirect so the
 * invite continuation survives the signup flow. Normal signup without a
 * callbackUrl redirects to /login exactly as before.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const rawCallback = typeof resolved.callbackUrl === "string" ? resolved.callbackUrl : null;

  if (rawCallback) {
    const callbackUrl = getSafeCallbackUrl(rawCallback, "/dashboard");
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  redirect("/login");
}
