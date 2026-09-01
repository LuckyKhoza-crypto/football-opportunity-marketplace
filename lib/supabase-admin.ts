import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// Admin client using the service role key to bypass RLS.
// Only use server-side (never exposed to the browser).
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);