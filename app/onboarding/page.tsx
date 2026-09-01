"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function OnboardingPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userRoles = (session?.user?.roles as string[] | undefined) ?? [];
  const hasPlayerRole = userRoles.includes("player");
  const hasTeamRole = userRoles.includes("team");
  const hasBothRoles = hasPlayerRole && hasTeamRole;
  const isAddingRole = userRoles.length > 0;

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/login");
    }

    // If user already has both roles, redirect to player dashboard
    if (hasBothRoles) {
      router.push("/player");
    }
  }, [session, status, router, hasBothRoles]);

  const handleRoleSelect = async (role: "player" | "team") => {
    if (!session?.user?.email) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/update-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to update role");
      }

      // Update the session to reflect the new role
      await update();

      // Redirect to the appropriate dashboard
      if (role === "player") {
        router.push("/player");
      } else {
        router.push("/team");
      }
    } catch (err) {
      console.error("Failed to set role:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-3xl font-bold">
            {isAddingRole
              ? "Add Another Role to Your Account"
              : "Welcome to Football Opportunity Marketplace"}
          </h1>
          <p className="text-lg text-muted-foreground">
            {isAddingRole
              ? "You can be both a player AND a team representative. Select the role you'd like to add."
              : "Tell us about yourself to get started"}
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-destructive/10 p-4 text-center text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {/* Player Card — only show if user doesn't already have player role */}
          {!hasPlayerRole && (
            <Card
              className={`cursor-pointer transition-all hover:border-primary hover:shadow-lg ${
                loading ? "pointer-events-none opacity-50" : ""
              }`}
              onClick={() => handleRoleSelect("player")}
            >
              <CardHeader className="text-center">
                <div className="mb-4 text-5xl">⚽</div>
                <CardTitle className="text-xl">I{"'"}m a Player</CardTitle>
                <CardDescription>
                  I{"'"}m Looking for a Team
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={loading}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRoleSelect("player");
                  }}
                >
                  {loading ? "Setting up..." : "Get Started as Player"}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Team Card — only show if user doesn't already have team role */}
          {!hasTeamRole && (
            <Card
              className={`cursor-pointer transition-all hover:border-primary hover:shadow-lg ${
                loading ? "pointer-events-none opacity-50" : ""
              }`}
              onClick={() => handleRoleSelect("team")}
            >
              <CardHeader className="text-center">
                <div className="mb-4 text-5xl">🏟️</div>
                <CardTitle className="text-xl">I{"'"}m a Team</CardTitle>
                <CardDescription>
                  I{"'"}m Looking for Players
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={loading}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRoleSelect("team");
                  }}
                >
                  {loading ? "Setting up..." : "Get Started as Team"}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
