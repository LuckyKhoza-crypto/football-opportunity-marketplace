import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { TeamApplicationsClient } from "./TeamApplicationsClient";
import { getSelectedTeamId, resolveSelectedTeam } from "@/lib/team-context";

export default async function TeamApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
  if (!roles.includes("team")) {
    redirect("/onboarding");
  }

  const resolvedSearchParams = await searchParams;
  const selectedTeamId = getSelectedTeamId(resolvedSearchParams);
  const teamProfile = await resolveSelectedTeam(profile.id, selectedTeamId);

  if (!teamProfile) {
    redirect("/team/onboarding");
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">Applications</h1>
          <p className="text-lg text-muted-foreground">
            Review and manage applications for your opportunities
          </p>
        </div>

        <TeamApplicationsClient />
      </div>
    </div>
  );
}