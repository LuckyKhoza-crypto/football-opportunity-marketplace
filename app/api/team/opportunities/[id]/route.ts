import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function verifyOpportunityOwnership(
  userId: string,
  opportunityId: string,
  teamId?: string | null,
): Promise<{ opportunity: Record<string, unknown> | null; error: NextResponse | null }> {
  let teamProfileId: string | null = null;

  if (teamId) {
    // Verify the specific team belongs to the user
    const { data: teamProfile } = await supabaseAdmin
      .from("team_profiles")
      .select("id")
      .eq("id", teamId)
      .eq("user_id", userId)
      .single();

    if (!teamProfile) {
      return {
        opportunity: null,
        error: NextResponse.json(
          { error: "Team profile not found or access denied" },
          { status: 404 },
        ),
      };
    }
    teamProfileId = teamProfile.id;
  } else {
    // Fallback: get the user's first team
    const { data: teamProfile } = await supabaseAdmin
      .from("team_profiles")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!teamProfile) {
      return {
        opportunity: null,
        error: NextResponse.json(
          { error: "Team profile not found" },
          { status: 404 },
        ),
      };
    }
    teamProfileId = teamProfile.id;
  }

  const { data: opportunity } = await supabaseAdmin
    .from("opportunities")
    .select("*")
    .eq("id", opportunityId)
    .eq("team_id", teamProfileId)
    .single();

  if (!opportunity) {
    return {
      opportunity: null,
      error: NextResponse.json(
        { error: "Opportunity not found or access denied" },
        { status: 404 },
      ),
    };
  }

  return { opportunity: opportunity as unknown as Record<string, unknown>, error: null };
}

// Get a single opportunity
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
    const { searchParams } = new URL(request.url);
    const teamIdParam = searchParams.get("team_id");

    const { opportunity, error } = await verifyOpportunityOwnership(
      session.user.id,
      id,
      teamIdParam,
    );
    if (error) return error;

    return NextResponse.json({ opportunity });
  } catch (err) {
    console.error("Opportunity fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Update an opportunity
export async function PUT(
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
    const teamIdParam = body.team_id as string | undefined;

    const { opportunity, error } = await verifyOpportunityOwnership(
      session.user.id,
      id,
      teamIdParam,
    );
    if (error) return error;

    // Validate status if provided
    if (body.status) {
      const validStatuses = ["draft", "active", "closed"];
      if (!validStatuses.includes(body.status)) {
        return NextResponse.json(
          { error: "Invalid status" },
          { status: 400 },
        );
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      "title", "position", "secondary_positions", "role", "formation",
      "age_min", "age_max", "playing_level", "league", "location",
      "radius", "preferred_foot", "availability", "compensation",
      "housing", "travel_requirements", "visa_requirements",
      "contract_length", "tryout_date", "description", "status",
    ];

    for (const field of allowedFields) {
      if (field in body) {
        if (field === "secondary_positions") {
          updateData[field] = Array.isArray(body[field]) ? body[field] : [];
        } else {
          updateData[field] = body[field] ?? null;
        }
      }
    }

    // If no changes, return current
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ opportunity });
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("opportunities")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("Failed to update opportunity:", updateError);
      return NextResponse.json(
        { error: "Failed to update opportunity" },
        { status: 500 },
      );
    }

    return NextResponse.json({ opportunity: updated });
  } catch (err) {
    console.error("Opportunity update error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Delete an opportunity
export async function DELETE(
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
    const { searchParams } = new URL(request.url);
    const teamIdParam = searchParams.get("team_id");

    const { opportunity, error } = await verifyOpportunityOwnership(
      session.user.id,
      id,
      teamIdParam,
    );
    if (error) return error;

    // Only allow deletion of drafts and closed opportunities
    const status = opportunity?.status as string;
    if (status === "active") {
      return NextResponse.json(
        { error: "Active opportunities must be closed before deletion" },
        { status: 400 },
      );
    }

    const { error: deleteError } = await supabaseAdmin
      .from("opportunities")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Failed to delete opportunity:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete opportunity" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Opportunity deletion error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}