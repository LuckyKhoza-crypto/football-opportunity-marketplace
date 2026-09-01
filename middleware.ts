import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;
    const userRoles = (token?.roles as string[] | undefined) ?? [];

    // Route context detection
    // Player management routes
    const playerRoutes = ["/player", "/player/onboarding", "/player/profile", "/player/find-team", "/player/applications"];
    // Team management routes
    const teamRoutes = ["/team", "/team/onboarding", "/team/profile", "/team/opportunities", "/team/find-players", "/team/players", "/team/applications"];

    const isPlayerRoute = playerRoutes.some((r) => pathname === r || pathname.startsWith(r + "/"));
    const isTeamRoute = teamRoutes.some((r) => pathname === r || pathname.startsWith(r + "/"));

    // If user has no roles, redirect role-specific routes to onboarding
    if (userRoles.length === 0) {
      if (isPlayerRoute || isTeamRoute) {
        return NextResponse.redirect(new URL("/onboarding", req.url));
      }
      return NextResponse.next();
    }

    // If user is accessing a player route but doesn't have player role
    if (isPlayerRoute && !userRoles.includes("player")) {
      // If they have team role, redirect to team dashboard
      if (userRoles.includes("team")) {
        return NextResponse.redirect(new URL("/team", req.url));
      }
      // Otherwise redirect to onboarding
      return NextResponse.redirect(new URL("/onboarding", req.url));
    }

    // If user is accessing a team route but doesn't have team role
    if (isTeamRoute && !userRoles.includes("team")) {
      // If they have player role, redirect to player dashboard
      if (userRoles.includes("player")) {
        return NextResponse.redirect(new URL("/player", req.url));
      }
      // Otherwise redirect to onboarding
      return NextResponse.redirect(new URL("/onboarding", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const pathname = req.nextUrl.pathname;

        // Public routes that don't need auth
        const publicRoutes: string[] = [
          "/",
          "/login",
          "/signup",
          "/api/auth",
          "/_next",
          "/favicon.ico",
          "/players",
          "/teams",
          "/opportunities",
        ];

        const isPublicRoute = publicRoutes.some((route) =>
          route === "/"
            ? pathname === "/"
            : pathname.startsWith(route),
        );

        // Allow public routes
        if (isPublicRoute) return true;

        // Protected routes that require auth
        const protectedRoutes = [
          "/dashboard",
          "/player",
          "/team",
          "/onboarding",
        ];

        const isProtectedRoute = protectedRoutes.some((route) =>
          pathname.startsWith(route),
        );

        if (isProtectedRoute) {
          return !!token;
        }

        // Allow all other routes (e.g., public API routes)
        return true;
      },
    },
    pages: {
      signIn: "/login",
    },
  },
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/player/:path*",
    "/team/:path*",
    "/onboarding/:path*",
    "/login/:path*",
    "/players/:path*",
    "/teams/:path*",
    "/opportunities/:path*",
  ],
};
