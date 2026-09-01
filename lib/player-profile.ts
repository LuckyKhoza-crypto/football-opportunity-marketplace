import type { PlayerProfile } from "@/types";

function isFieldCompleted(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export interface ProfileCompleteness {
  percentage: number;
  totalFields: number;
  completedFields: number;
  missingFields: string[];
}

/**
 * Calculate profile completeness based on completed fields.
 * Returns a percentage and details about what's missing.
 */
export function calculateProfileCompleteness(
  profile: Partial<PlayerProfile> | null | undefined,
): ProfileCompleteness {
  if (!profile) {
    return {
      percentage: 0,
      totalFields: 13,
      completedFields: 0,
      missingFields: [
        "Profile photo",
        "Location",
        "Position",
        "Playing level",
        "Preferred foot",
        "Availability",
        "Travel preference",
        "Relocation preference",
        "Previous clubs",
        "Stats",
        "Achievements",
        "Highlight video",
        "Preferred leagues",
      ],
    };
  }

  const fields: { name: string; completed: boolean }[] = [
    { name: "Profile photo", completed: !!profile.profile_photo_url },
    { name: "Location", completed: !!profile.location },
    {
      name: "Position",
      completed:
        Array.isArray(profile.positions) && profile.positions.length > 0,
    },
    { name: "Playing level", completed: !!profile.playing_level },
    { name: "Preferred foot", completed: !!profile.preferred_foot },
    { name: "Availability", completed: !!profile.availability },
    {
      name: "Travel preference",
      completed: isFieldCompleted(profile.willing_to_travel),
    },
    {
      name: "Relocation preference",
      completed: isFieldCompleted(profile.willing_to_relocate),
    },
    {
      name: "Previous clubs",
      completed:
        Array.isArray(profile.previous_clubs) &&
        profile.previous_clubs.length > 0,
    },
    {
      name: "Stats",
      completed: !!(
        profile.stats &&
        typeof profile.stats === "object" &&
        Object.keys(profile.stats).length > 0
      ),
    },
    {
      name: "Achievements",
      completed:
        Array.isArray(profile.achievements) &&
        profile.achievements.length > 0,
    },
    { name: "Highlight video", completed: !!profile.highlight_video_url },
    {
      name: "Preferred leagues",
      completed:
        Array.isArray(profile.preferred_leagues) &&
        profile.preferred_leagues.length > 0,
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