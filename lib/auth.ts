import GoogleProvider from "next-auth/providers/google";
import type { NextAuthOptions } from "next-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ user, account }) {
      try {
        if (!user.email) {
          console.error("No email in Google account");
          return false;
        }

        if (account?.provider === "google") {
          const { email, name, image } = user;

          // Check if profile already exists - don't overwrite user-edited data
          const { data: existingProfile } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("email", email)
            .single();

          if (!existingProfile) {
            // New user: create profile with Google account info
            // Use admin client to bypass RLS
            const { error: profileError } = await supabaseAdmin
              .from("profiles")
              .insert({
                email,
                full_name: name ?? null,
                avatar_url: image ?? null,
              });

            if (profileError) {
              console.error("Supabase profile insert failed:", profileError);
            }
          }
        }

        return true;
      } catch (err) {
        console.error("signIn callback error:", err);
        return true;
      }
    },

    async jwt({ token, user }) {
      // Determine which email to query: on initial sign-in use `user.email`,
      // on subsequent updates use `token.email`
      const email = user?.email ?? token.email;
      if (!email) return token;

      // Always fetch the latest profile from the database.
      // Use admin client to bypass RLS (NextAuth manages auth independently of Supabase Auth).
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id, role")
        .eq("email", email)
        .single();

      if (error) {
        console.error("jwt callback: supabaseAdmin query failed", error);
      }

      if (data) {
        token.id = data.id;
        token.roles = data.role ?? undefined;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.roles = token.roles as string[] | undefined;
      }
      return session;
    },
  },
};