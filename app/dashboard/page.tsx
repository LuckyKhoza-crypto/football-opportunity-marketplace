import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  // Use session roles from JWT for authentication decisions
  const userRoles = session.user.roles as string[] | undefined;
  if (!userRoles || userRoles.length === 0) {
    redirect("/onboarding");
  }

  // Fetch profile data for display using admin client (bypasses RLS)
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("email", session.user.email)
    .single();

  if (!profile) {
    redirect("/onboarding");
  }

  const isPlayer = userRoles.includes("player");
  const isTeam = userRoles.includes("team");

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-bold">
          Welcome, {profile.full_name || "Player"}
        </h1>
        <p className="text-lg text-muted-foreground">
          {isPlayer && isTeam ? "Player & Team Account" : isPlayer ? "Player Account" : "Team Account"}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>
              {isPlayer ? "Your Player Profile" : "Your Team Profile"}
            </CardTitle>
            <CardDescription>
              {isPlayer
                ? "Your football profile will be built next."
                : "Your team profile will be built next."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={isPlayer ? "/player" : "/team"}>
              <Button className="w-full">
                {isPlayer ? "Build My Player Profile" : "Create Team Profile"}
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>My Applications</CardTitle>
            <CardDescription>Track your opportunity applications</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Applications will be available in a future MVP.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Stay updated on your opportunities</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Notifications will be available in a future MVP.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}