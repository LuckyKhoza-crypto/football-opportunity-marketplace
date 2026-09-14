import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { NotificationsClient } from "./NotificationsClient";

export default async function NotificationsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("email", session.user.email)
    .single();

  if (!profile) {
    redirect("/onboarding");
  }

  const roles: string[] = profile?.role ?? [];
  if (roles.length === 0) {
    redirect("/onboarding");
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">Notifications</h1>
          <p className="text-lg text-muted-foreground">
            Important marketplace activity
          </p>
        </div>

        <NotificationsClient />
      </div>
    </div>
  );
}