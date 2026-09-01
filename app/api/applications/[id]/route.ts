import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { ApplicationStatus } from "@/types";

// Valid status transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ["reviewing", "rejected", "accepted"],
  reviewing: ["rejected", "accepted"],
  accepted: [],
  rejected: [],
  withdrawn: [],
};

// GET /api/applications/[id] — Get a single application detail
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const { id } = await params;

    // Fetch the application with all related data
    const { data: application, error } = await supabaseAdmin
      .from("applications")
      .select(`
        *,
        opportunity:opportunity_id (
          id,
          title,
          position,
          secondary_positions,
          role,
          formation,
          age_min,
          age_max,
          playing_level,
          league,
          location,
          radius,
          preferred_foot,
          availability,
          compensation,
          housing,
          travel_requirements,
          visa_requirements,
          contract_length,
          tryout_date,
          description,
          status,
          created_at,
          updated_at,
          team:team_id (
            id,
            team_name,
            logo_url,
            location,
            league,
            playing_level,
            description,
            website_url
          )
        ),
        player_profile:player_profile_id (
          id,
          user_id,
          profile_photo_url,
          date_of_birth,
          location,
          positions,
          preferred_role,
          playing_level,
          preferred_foot,
          availability,
          willing_to_travel,
          willing_to_relocate,
          travel_radius,
          compensation_expectation,
          previous_clubs,
          stats,
          achievements,
          highlight_video_url,
          preferred_leagues,
          bio,
          created_at,
          updated_at
        )
      `)
      .eq("id", id)
      .single();

    if (error || !application) {
      return NextResponse.json(
        { error: "Application not found" },
        { status: 404 },
      );
    }

    // Verify the user has access to this application
    const userId = session.user.id;
    const playerUserId = application.player_profile?.user_id;
    const teamUserId = application.opportunity?.team?.user_id;

    const isPlayerOwner = playerUserId === userId;
    const isTeamOwner = teamUserId === userId;

    if (!isPlayerOwner && !isTeamOwner) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 },
      );
    }

    return NextResponse.json({ application });
  } catch (err) {
    console.error("Application fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PATCH /api/applications/[id] — Update application status
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const { id } = await params;
    const body = await request.json();
    const { status: newStatus } = body;

    if (!newStatus) {
      return NextResponse.json(
        { error: "Status is required" },
        { status: 400 },
      );
    }

    const validStatuses: ApplicationStatus[] = [
      "pending",
      "reviewing",
      "accepted",
      "rejected",
      "withdrawn",
    ];

    if (!validStatuses.includes(newStatus as ApplicationStatus)) {
      return NextResponse.json(
        { error: "Invalid status value" },
        { status: 400 },
      );
    }

    // Fetch the current application
    const { data: application, error: fetchError } = await supabaseAdmin
      .from("applications")
      .select(`
        *,
        opportunity:opportunity_id (
          team_id,
          team:team_id (
            user_id
          )
        ),
        player_profile:player_profile_id (
          user_id
        )
      `)
      .eq("id", id)
      .single();

    if (fetchError || !application) {
      return NextResponse.json(
        { error: "Application not found" },
        { status: 404 },
      );
    }

    const userId = session.user.id;
    const playerUserId = application.player_profile?.user_id;
    const teamUserId = application.opportunity?.team?.user_id;

    // Determine who is making the request
    const isPlayer = playerUserId === userId;
    const isTeam = teamUserId === userId;

    if (!isPlayer && !isTeam) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 },
      );
    }

    // Validate status transition
    const currentStatus = application.status;
    const allowedTransitions = VALID_TRANSITIONS[currentStatus] ?? [];

    if (!allowedTransitions.includes(newStatus)) {
      return NextResponse.json(
        {
          error: `Cannot transition from '${currentStatus}' to '${newStatus}'`,
          allowedTransitions,
        },
        { status: 400 },
      );
    }

    // Players can only withdraw their own applications
    if (isPlayer && newStatus !== "withdrawn") {
      return NextResponse.json(
        { error: "Players can only withdraw their applications" },
        { status: 403 },
      );
    }

    // Teams can only update applications for their own opportunities
    if (isTeam && newStatus === "withdrawn") {
      return NextResponse.json(
        { error: "Teams cannot withdraw applications" },
        { status: 403 },
      );
    }

    // Update the application status
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("applications")
      .update({ status: newStatus })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("Failed to update application:", updateError);
      return NextResponse.json(
        { error: "Failed to update application" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, application: updated });
  } catch (err) {
    console.error("Application update error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}