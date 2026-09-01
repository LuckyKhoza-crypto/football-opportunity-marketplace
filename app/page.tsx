import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  const isAuthenticated = !!session?.user;

  // Authenticated users: redirect to their appropriate dashboard
  if (isAuthenticated) {
    const userRoles = (session.user.roles as string[] | undefined) ?? [];

    // No roles → onboarding
    if (userRoles.length === 0) {
      redirect("/onboarding");
    }

    // Player only → player dashboard
    if (userRoles.includes("player") && !userRoles.includes("team")) {
      redirect("/player");
    }

    // Team only → team dashboard
    if (userRoles.includes("team") && !userRoles.includes("player")) {
      redirect("/team");
    }

    // Dual-role: default to player dashboard (client-side view persistence
    // will restore the previously active view on the client side)
    redirect("/player");
  }

  return (
    <div className="container mx-auto px-4 py-12">
      {/* Hero Section */}
      <section className="mb-16 text-center">
        <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl">
          Find Your{" "}
          <span className="text-primary">Next Football Opportunity</span>
        </h1>
        <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground">
          The marketplace connecting football players with teams. Create your
          profile, discover opportunities, and take the next step in your
          football journey.
        </p>
        <div className="flex justify-center gap-4">
          <Link href="/login">
            <Button size="lg">Get Started</Button>
          </Link>
          <Link href="/opportunities">
            <Button variant="outline" size="lg">
              Browse Opportunities
            </Button>
          </Link>
        </div>
      </section>

      {/* Features Section */}
      <section className="mb-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>For Players</CardTitle>
            <CardDescription>
              Create your football profile and get discovered
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              <li>Build a professional football profile</li>
              <li>Browse team opportunities</li>
              <li>Get matched with relevant openings</li>
              <li>Apply directly to teams</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>For Teams</CardTitle>
            <CardDescription>
              Find the talent your team needs
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              <li>Create your team profile</li>
              <li>Post player opportunities</li>
              <li>Discover talented players</li>
              <li>Review and manage applicants</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Smart Matching</CardTitle>
            <CardDescription>
              Intelligent connections between players and teams
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              <li>Position-based matching</li>
              <li>Location-aware opportunities</li>
              <li>Skill level alignment</li>
              <li>Real-time notifications</li>
            </ul>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}