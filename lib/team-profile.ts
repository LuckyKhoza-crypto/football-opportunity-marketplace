import type { TeamProfile } from "@/types";

export interface ProfileCompleteness {
  percentage: number;
  totalFields: number;
  completedFields: number;
  missingFields: string[];
}

/**
 * Calculate team profile completeness based on completed fields.
 * Returns a percentage and details about what's missing.
 */
export function calculateTeamProfileCompleteness(
  profile: Partial<TeamProfile> | null | undefined,
): ProfileCompleteness {
  if (!profile) {
    return {
      percentage: 0,
      totalFields: 9,
      completedFields: 0,
      missingFields: [
        "Team name",
        "Logo",
        "Location",
        "League",
        "Playing level",
        "Description",
        "Contact name",
        "Website",
        "Social links",
      ],
    };
  }

  const fields: { name: string; completed: boolean }[] = [
    { name: "Team name", completed: !!profile.team_name },
    { name: "Logo", completed: !!profile.logo_url },
    { name: "Location", completed: !!profile.location },
    { name: "League", completed: !!profile.league },
    { name: "Playing level", completed: !!profile.playing_level },
    { name: "Description", completed: !!profile.description },
    { name: "Contact name", completed: !!profile.contact_name },
    { name: "Website", completed: !!profile.website_url },
    {
      name: "Social links",
      completed:
        Array.isArray(profile.social_links) && profile.social_links.length > 0,
    },
  ];

  const completedFields = fields.filter((f) => f.completed).length;
  const totalFields = fields.length;
  const missingFields = fields
    .filter((f) => !f.completed)
    .map((f) => f.name);

  return {
    percentage: Math.round((completedFields / totalFields) * 100),
    totalFields,
    completedFields,
    missingFields,
  };
}