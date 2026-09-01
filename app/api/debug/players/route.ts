import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const results: Record<string, unknown> = {};

  // Test 1: Count all player_profiles
  const { count: totalCount, error: countError } = await supabaseAdmin
    .from("player_profiles")
    .select("*", { count: "exact", head: true });

  results.total_profiles = totalCount;
  results.count_error = countError?.message;

  // Test 2: Count with discoverable = true
  const { count: discoverableCount, error: discError } = await supabaseAdmin
    .from("player_profiles")
    .select("*", { count: "exact", head: true })
    .eq("discoverable", true);

  results.discoverable_true_count = discoverableCount;
  results.discoverable_error = discError?.message;

  // Test 3: Count with discoverable = false or null
  const { count: nonDiscoverableCount, error: nonDiscError } = await supabaseAdmin
    .from("player_profiles")
    .select("*", { count: "exact", head: true })
    .or("discoverable.is.null,discoverable.eq.false");

  results.non_discoverable_count = nonDiscoverableCount;
  results.non_discoverable_error = nonDiscError?.message;

  // Test 4: Select a sample row without join
  const { data: sampleRows, error: sampleError } = await supabaseAdmin
    .from("player_profiles")
    .select("*")
    .limit(3);

  results.sample_rows = sampleRows;
  results.sample_error = sampleError?.message;

  // Test 5: Try the exact query the browse page uses
  const { data: browseData, error: browseError } = await supabaseAdmin
    .from("player_profiles")
    .select(`
      *,
      profile:user_id (
        full_name,
        avatar_url
      )
    `)
    .eq("discoverable", true)
    .order("created_at", { ascending: false });

  results.browse_query_results = browseData?.length ?? 0;
  results.browse_query_error = browseError?.message;
  if (browseData && browseData.length > 0) {
    results.browse_query_sample = browseData.slice(0, 2);
  }

  // Test 6: Try without discoverable filter
  const { data: noDiscData, error: noDiscBrowseError } = await supabaseAdmin
    .from("player_profiles")
    .select(`
      *,
      profile:user_id (
        full_name,
        avatar_url
      )
    `)
    .order("created_at", { ascending: false })
    .limit(5);

  results.no_discoverable_filter_results = noDiscData?.length ?? 0;
  results.no_discoverable_filter_error = noDiscBrowseError?.message;
  if (noDiscData && noDiscData.length > 0) {
    results.no_discoverable_filter_sample = noDiscData.map((r: Record<string, unknown>) => ({
      id: r.id,
      user_id: r.user_id,
      discoverable: r.discoverable,
      positions: r.positions,
      playing_level: r.playing_level,
      location: r.location,
      profile: r.profile,
    }));
  }

  return NextResponse.json(results);
}