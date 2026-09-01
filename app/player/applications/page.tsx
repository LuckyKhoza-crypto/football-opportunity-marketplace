import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_COLORS,
  type ApplicationStatus,
  POSITION_LABELS,
  PLAYING_LEVEL_LABELS,
} from "@/types";
import { ApplicationsClient } from "./ApplicationsClient";

export default async function PlayerApplicationsPage() {
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
  if (!roles.includes("player")) {
    redirect("/onboarding");
  }

  const { data: playerProfile } = await supabaseAdmin
    .from("player_profiles")
    .select("id")
    .eq("user_id", profile.id)
    .single();

  if (!playerProfile) {
    redirect("/player/onboarding");
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">My Applications</h1>
          <p className="text-lg text-muted-foreground">
            Track and manage your applications
          </p>
        </div>

        <ApplicationsClient />
      </div>
    </div>
  );
}