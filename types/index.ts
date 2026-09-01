export type UserRole = "player" | "team";

export interface NavItem {
  label: string;
  href: string;
  icon?: string;
  requiresAuth?: boolean;
}

export type PagePlaceholderProps = {
  title: string;
  description: string;
};

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: UserRole[] | null;
  created_at: string;
  updated_at: string;
}

export type PlayingLevel =
  | "recreational"
  | "amateur"
  | "competitive_amateur"
  | "semi_pro"
  | "academy"
  | "college"
  | "professional";

export type PreferredFoot = "left" | "right" | "both";

export type Availability =
  | "immediately"
  | "2_weeks"
  | "1_month"
  | "next_season"
  | "not_specified";

export type PreferredRole =
  | "goalkeeper"
  | "defender"
  | "midfielder"
  | "forward"
  | "any";

export type Position =
  | "GK"
  | "CB"
  | "LB"
  | "RB"
  | "LWB"
  | "RWB"
  | "CDM"
  | "CM"
  | "CAM"
  | "LM"
  | "RM"
  | "LW"
  | "RW"
  | "ST"
  | "CF";

export interface PreviousClub {
  name: string;
  startDate: string;
  endDate: string | null;
  position: string;
  achievements?: string;
}

export interface PlayerStats {
  appearances?: number;
  goals?: number;
  assists?: number;
  cleanSheets?: number;
  manOfTheMatch?: number;
}

export interface PlayerProfile {
  id: string;
  user_id: string;
  profile_photo_url: string | null;
  date_of_birth: string | null;
  location: string | null;
  positions: Position[];
  preferred_role: PreferredRole | null;
  playing_level: PlayingLevel | null;
  preferred_foot: PreferredFoot | null;
  availability: Availability | null;
  willing_to_travel: boolean;
  willing_to_relocate: boolean;
  travel_radius: number | null;
  compensation_expectation: string | null;
  previous_clubs: PreviousClub[];
  stats: PlayerStats;
  achievements: string[];
  highlight_video_url: string | null;
  preferred_leagues: string[];
  bio: string | null;
  created_at: string;
  updated_at: string;
}

export const POSITIONS: Position[] = [
  "GK",
  "CB",
  "LB",
  "RB",
  "LWB",
  "RWB",
  "CDM",
  "CM",
  "CAM",
  "LM",
  "RM",
  "LW",
  "RW",
  "ST",
  "CF",
];

export const PLAYING_LEVELS: PlayingLevel[] = [
  "recreational",
  "amateur",
  "competitive_amateur",
  "semi_pro",
  "academy",
  "college",
  "professional",
];

export const PREFERRED_FEET: PreferredFoot[] = ["left", "right", "both"];

export const AVAILABILITY_OPTIONS: Availability[] = [
  "immediately",
  "2_weeks",
  "1_month",
  "next_season",
  "not_specified",
];

export const PREFERRED_ROLES: PreferredRole[] = [
  "goalkeeper",
  "defender",
  "midfielder",
  "forward",
  "any",
];

export const PLAYING_LEVEL_LABELS: Record<PlayingLevel, string> = {
  recreational: "Recreational",
  amateur: "Amateur",
  competitive_amateur: "Competitive Amateur",
  semi_pro: "Semi-Pro",
  academy: "Academy",
  college: "College",
  professional: "Professional",
};

export const PREFERRED_FOOT_LABELS: Record<PreferredFoot, string> = {
  left: "Left Footed",
  right: "Right Footed",
  both: "Both Feet",
};

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  immediately: "Available Immediately",
  "2_weeks": "Available in 2 Weeks",
  "1_month": "Available in 1 Month",
  next_season: "Next Season",
  not_specified: "Not Specified",
};

export const PREFERRED_ROLE_LABELS: Record<PreferredRole, string> = {
  goalkeeper: "Goalkeeper",
  defender: "Defender",
  midfielder: "Midfielder",
  forward: "Forward",
  any: "Any Position",
};

// ─── Team Profile ────────────────────────────────────────────────

export interface TeamProfile {
  id: string;
  user_id: string;
  team_name: string;
  logo_url: string | null;
  location: string | null;
  league: string | null;
  playing_level: string | null;
  description: string | null;
  website_url: string | null;
  social_links: string[];
  contact_name: string | null;
  created_at: string;
  updated_at: string;
}

export const TEAM_PLAYING_LEVELS = [
  "recreational",
  "amateur",
  "competitive_amateur",
  "semi_pro",
  "academy",
  "college",
  "professional",
] as const;

export const TEAM_PLAYING_LEVEL_LABELS: Record<string, string> = {
  recreational: "Recreational",
  amateur: "Amateur",
  competitive_amateur: "Competitive Amateur",
  semi_pro: "Semi-Pro",
  academy: "Academy",
  college: "College",
  professional: "Professional",
};

// ─── Opportunity ────────────────────────────────────────────────

export type OpportunityStatus = "draft" | "active" | "closed";

export interface Opportunity {
  id: string;
  team_id: string;
  title: string;
  position: string | null;
  secondary_positions: string[];
  role: string | null;
  formation: string | null;
  age_min: number | null;
  age_max: number | null;
  playing_level: string | null;
  league: string | null;
  location: string | null;
  radius: number | null;
  preferred_foot: string | null;
  availability: string | null;
  compensation: string | null;
  housing: string | null;
  travel_requirements: string | null;
  visa_requirements: string | null;
  contract_length: string | null;
  tryout_date: string | null;
  description: string | null;
  status: OpportunityStatus;
  created_at: string;
  updated_at: string;
}

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  draft: "Draft",
  active: "Active",
  closed: "Closed",
};

export const OPPORTUNITY_STATUS_COLORS: Record<OpportunityStatus, string> = {
  draft: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  closed: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
};

export const POSITION_LABELS: Record<string, string> = {
  GK: "Goalkeeper",
  CB: "Center Back",
  LB: "Left Back",
  RB: "Right Back",
  LWB: "Left Wing Back",
  RWB: "Right Wing Back",
  CDM: "Central Defensive Midfielder",
  CM: "Central Midfielder",
  CAM: "Central Attacking Midfielder",
  LM: "Left Midfielder",
  RM: "Right Midfielder",
  LW: "Left Wing",
  RW: "Right Wing",
  ST: "Striker",
  CF: "Center Forward",
};

export const ROLE_OPTIONS = [
  "Pressing Forward",
  "Target Man",
  "Poacher",
  "False Nine",
  "Winger",
  "Inverted Winger",
  "Box-to-Box Midfielder",
  "Deep-Lying Playmaker",
  "Holding Midfielder",
  "Advanced Playmaker",
  "Ball-Winning Midfielder",
  "Wing Back",
  "Inverted Full Back",
  "Ball-Playing Defender",
  "Sweeper",
  "Sweeper Keeper",
  "Shot-Stopper",
] as const;

export const FORMATION_OPTIONS = [
  "4-3-3",
  "4-4-2",
  "4-2-3-1",
  "3-5-2",
  "3-4-3",
  "5-3-2",
  "4-1-4-1",
  "4-3-2-1",
  "4-4-1-1",
  "3-4-1-2",
  "4-2-2-2",
  "5-4-1",
] as const;

export const COMPENSATION_OPTIONS = [
  "Unpaid",
  "Expenses Covered",
  "Stipend",
  "Part-Time Contract",
  "Full-Time Contract",
  "Performance Bonuses",
  "Negotiable",
] as const;

export const HOUSING_OPTIONS = [
  "Not Provided",
  "Provided",
  "Assistance Available",
  "Negotiable",
] as const;

export const CONTRACT_LENGTH_OPTIONS = [
  "Seasonal",
  "1 Year",
  "2 Years",
  "3+ Years",
  "Month-to-Month",
  "Trial Period",
  "Negotiable",
] as const;

export const TRAVEL_REQUIREMENTS_OPTIONS = [
  "No Travel Required",
  "Local Travel Only",
  "Regional Travel",
  "National Travel",
  "International Travel",
  "As Needed",
] as const;

export const VISA_REQUIREMENTS_OPTIONS = [
  "Not Required",
  "Visa Sponsorship Available",
  "Must Have Work Permit",
  "Negotiable",
] as const;