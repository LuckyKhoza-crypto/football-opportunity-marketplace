import { getSafeCallbackUrl } from "@/lib/invite-callback";
import { LoginClient } from "./LoginClient";

/**
 * TEAM-003 — Login page (server component).
 *
 * Reads the optional `callbackUrl` search param and validates it with
 * the safe-callback helper before passing it to the client login UI.
 * Unsafe or missing callback URLs fall back to "/dashboard", so normal
 * login behavior is unchanged and open redirects are impossible.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const rawCallback = typeof resolved.callbackUrl === "string" ? resolved.callbackUrl : null;
  const callbackUrl = getSafeCallbackUrl(rawCallback, "/dashboard");

  return <LoginClient callbackUrl={callbackUrl} />;
}