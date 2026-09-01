import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import {
  TEAM_PLAYING_LEVEL_LABELS,
  type TeamProfile,
} from "@/types";
import { MapPin, Globe, Users, Trophy, Link as LinkIcon, ExternalLink, Instagram, Twitter } from "lucide-react";

export default async function TeamProfilePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  const userRoles = session.user.roles as string[] | undefined;
  if (!userRoles || userRoles.length === 0) {
    redirect("/onboarding");
  }
  if (!userRoles.includes("team")) {
    if (userRoles.includes("player")) {
      redirect("/player");
    }
    redirect("/onboarding");
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("email", session.user.email)
    .single();

  if (!profile) {
    redirect("/onboarding");
  }

  const { data: teamProfile } = await supabaseAdmin
    .from("team_profiles")
    .select("*")
    .eq("user_id", profile.id)
    .single();

  if (!teamProfile) {
    redirect("/team/onboarding");
  }

  const typedProfile = teamProfile as unknown as TeamProfile;
  const socialLinks: string[] = Array.isArray(typedProfile.social_links)
    ? typedProfile.social_links
    : [];

  function getSocialIcon(url: string) {
    const lower = url.toLowerCase();
    if (lower.includes("instagram")) return <Instagram className="h-4 w-4" />;
    if (lower.includes("twitter") || lower.includes("x.com")) return <Twitter className="h-4 w-4" />;
    return <Globe className="h-4 w-4" />;
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-3xl">
        {/* Profile Header */}
        <div className="mb-8">
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
            {/* Logo */}
            <div className="flex-shrink-0">
              {typedProfile.logo_url ? (
                <img
                  src={typedProfile.logo_url}
                  alt={`${typedProfile.team_name} logo`}
                  className="h-32 w-32 rounded-xl object-cover ring-2 ring-primary/20"
                />
              ) : (
                <div className="flex h-32 w-32 items-center justify-center rounded-xl bg-muted">
                  <Users className="h-12 w-12 text-muted-foreground" />
                </div>
              )}
            </div>

            {/* Basic Info */}
            <div className="flex-1">
              <h1 className="text-3xl font-bold">
                {typedProfile.team_name}
              </h1>
              <div className="mt-2 space-y-1">
                {typedProfile.playing_level && (
                  <p className="text-lg font-medium text-primary">
                    {TEAM_PLAYING_LEVEL_LABELS[typedProfile.playing_level]}
                    {typedProfile.league && (
                      <span className="text-muted-foreground">
                        {" "}
                        &middot;{" "}
                        {typedProfile.league}
                      </span>
                    )}
                  </p>
                )}
                {typedProfile.location && (
                  <p className="flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    {typedProfile.location}
                  </p>
                )}
              </div>
            </div>

            {/* Edit Button */}
            <Link href="/team/profile/edit">
              <Button variant="outline">Edit Profile</Button>
            </Link>
          </div>
        </div>

        <div className="grid gap-6">
          {/* About */}
          {typedProfile.description && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Trophy className="h-5 w-5 text-primary" />
                  About
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{typedProfile.description}</p>
              </CardContent>
            </Card>
          )}

          {/* Team Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5 text-primary" />
                Team Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {typedProfile.playing_level && (
                  <div>
                    <p className="text-sm text-muted-foreground">Playing Level</p>
                    <p className="font-medium">
                      {TEAM_PLAYING_LEVEL_LABELS[typedProfile.playing_level]}
                    </p>
                  </div>
                )}
                {typedProfile.league && (
                  <div>
                    <p className="text-sm text-muted-foreground">League</p>
                    <p className="font-medium">{typedProfile.league}</p>
                  </div>
                )}
                {typedProfile.contact_name && (
                  <div>
                    <p className="text-sm text-muted-foreground">Contact</p>
                    <p className="font-medium">{typedProfile.contact_name}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Website */}
          {typedProfile.website_url && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <LinkIcon className="h-5 w-5 text-primary" />
                  Website
                </CardTitle>
              </CardHeader>
              <CardContent>
                <a
                  href={typedProfile.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  {typedProfile.website_url}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </CardContent>
            </Card>
          )}

          {/* Social Links */}
          {socialLinks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Globe className="h-5 w-5 text-primary" />
                  Social Links
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {socialLinks.map((link, index) => (
                    <a
                      key={index}
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-primary underline-offset-4 hover:underline"
                    >
                      {getSocialIcon(link)}
                      {link}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}