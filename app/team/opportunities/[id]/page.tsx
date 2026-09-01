import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import {
  OPPORTUNITY_STATUS_LABELS,
  OPPORTUNITY_STATUS_COLORS,
  POSITION_LABELS,
  PLAYING_LEVEL_LABELS,
  PREFERRED_FOOT_LABELS,
  AVAILABILITY_LABELS,
  type Opportunity,
  type TeamProfile,
} from "@/types";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Swords,
  DollarSign,
  Home,
  Plane,
  FileText,
  Eye,
  Clock,
  User,
  Footprints,
  Shield,
} from "lucide-react";
import { OpportunityActionsClient } from "./OpportunityActionsClient";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Not set";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex-shrink-0 text-muted-foreground">{icon}</div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="font-medium">{value}</p>
      </div>
    </div>
  );
}

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  const { id } = await params;

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

  const { data: opportunity } = await supabaseAdmin
    .from("opportunities")
    .select("*")
    .eq("id", id)
    .eq("team_id", teamProfile.id)
    .single();

  if (!opportunity) {
    redirect("/team/opportunities");
  }

  const opp = opportunity as unknown as Opportunity;
  const team = teamProfile as unknown as TeamProfile;
  const statusColor = OPPORTUNITY_STATUS_COLORS[opp.status] ?? "";
  const positionLabel = opp.position
    ? POSITION_LABELS[opp.position] ?? opp.position
    : "Any Position";

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-3xl">
        {/* Back */}
        <div className="mb-6">
          <Link href="/team/opportunities">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Opportunities
            </Button>
          </Link>
        </div>

        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold">{opp.title}</h1>
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${statusColor}`}
                >
                  {OPPORTUNITY_STATUS_LABELS[opp.status]}
                </span>
              </div>
              <p className="mt-1 text-lg text-muted-foreground">
                {team.team_name}
              </p>
            </div>

            {/* Actions */}
            <OpportunityActionsClient
              opportunityId={opp.id}
              status={opp.status}
            />
          </div>
        </div>

        <div className="space-y-6">
          {/* Description */}
          {opp.description && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-5 w-5 text-primary" />
                  Description
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {opp.description}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Opportunity Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Swords className="h-5 w-5 text-primary" />
                Opportunity Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 sm:grid-cols-2">
                <InfoRow
                  icon={<Swords className="h-4 w-4" />}
                  label="Primary Position"
                  value={positionLabel}
                />
                {opp.secondary_positions.length > 0 && (
                  <InfoRow
                    icon={<Swords className="h-4 w-4" />}
                    label="Secondary Positions"
                    value={opp.secondary_positions
                      .map(
                        (p) => POSITION_LABELS[p] ?? p,
                      )
                      .join(", ")}
                  />
                )}
                <InfoRow
                  icon={<User className="h-4 w-4" />}
                  label="Role"
                  value={opp.role}
                />
                <InfoRow
                  icon={<Shield className="h-4 w-4" />}
                  label="Formation"
                  value={opp.formation}
                />
                <InfoRow
                  icon={<Eye className="h-4 w-4" />}
                  label="Status"
                  value={
                    OPPORTUNITY_STATUS_LABELS[opp.status]
                  }
                />
                <InfoRow
                  icon={<Calendar className="h-4 w-4" />}
                  label="Created"
                  value={formatDate(opp.created_at)}
                />
                <InfoRow
                  icon={<Calendar className="h-4 w-4" />}
                  label="Last Updated"
                  value={formatDate(opp.updated_at)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Player Requirements */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <User className="h-5 w-5 text-primary" />
                Player Requirements
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 sm:grid-cols-2">
                {opp.age_min && (
                  <InfoRow
                    icon={<Calendar className="h-4 w-4" />}
                    label="Age Range"
                    value={`${opp.age_min} - ${opp.age_max ?? "No max"}`}
                  />
                )}
                {opp.age_max && !opp.age_min && (
                  <InfoRow
                    icon={<Calendar className="h-4 w-4" />}
                    label="Max Age"
                    value={String(opp.age_max)}
                  />
                )}
                <InfoRow
                  icon={<Swords className="h-4 w-4" />}
                  label="Playing Level"
                  value={
                    opp.playing_level
                      ? PLAYING_LEVEL_LABELS[
                          opp.playing_level as keyof typeof PLAYING_LEVEL_LABELS
                        ] ?? opp.playing_level
                      : null
                  }
                />
                <InfoRow
                  icon={<MapPin className="h-4 w-4" />}
                  label="League"
                  value={opp.league}
                />
                <InfoRow
                  icon={<Footprints className="h-4 w-4" />}
                  label="Preferred Foot"
                  value={
                    opp.preferred_foot
                      ? PREFERRED_FOOT_LABELS[
                          opp.preferred_foot as keyof typeof PREFERRED_FOOT_LABELS
                        ] ?? opp.preferred_foot
                      : null
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* Location */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MapPin className="h-5 w-5 text-primary" />
                Location
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 sm:grid-cols-2">
                <InfoRow
                  icon={<MapPin className="h-4 w-4" />}
                  label="Location"
                  value={opp.location}
                />
                {opp.radius && (
                  <InfoRow
                    icon={<MapPin className="h-4 w-4" />}
                    label="Travel Radius"
                    value={`${opp.radius} miles`}
                  />
                )}
                <InfoRow
                  icon={<Plane className="h-4 w-4" />}
                  label="Travel Requirements"
                  value={opp.travel_requirements}
                />
              </div>
            </CardContent>
          </Card>

          {/* Availability */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="h-5 w-5 text-primary" />
                Availability
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 sm:grid-cols-2">
                <InfoRow
                  icon={<Clock className="h-4 w-4" />}
                  label="Availability Needed"
                  value={
                    opp.availability
                      ? AVAILABILITY_LABELS[
                          opp.availability as keyof typeof AVAILABILITY_LABELS
                        ] ?? opp.availability
                      : null
                  }
                />
                <InfoRow
                  icon={<Calendar className="h-4 w-4" />}
                  label="Tryout Date"
                  value={formatDate(opp.tryout_date)}
                />
                <InfoRow
                  icon={<FileText className="h-4 w-4" />}
                  label="Contract Length"
                  value={opp.contract_length}
                />
              </div>
            </CardContent>
          </Card>

          {/* Compensation & Logistics */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <DollarSign className="h-5 w-5 text-primary" />
                Compensation & Logistics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 sm:grid-cols-2">
                <InfoRow
                  icon={<DollarSign className="h-4 w-4" />}
                  label="Compensation"
                  value={opp.compensation}
                />
                <InfoRow
                  icon={<Home className="h-4 w-4" />}
                  label="Housing"
                  value={opp.housing}
                />
                <InfoRow
                  icon={<FileText className="h-4 w-4" />}
                  label="Visa Requirements"
                  value={opp.visa_requirements}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}