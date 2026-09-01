"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  POSITIONS,
  PLAYING_LEVELS,
  PREFERRED_FEET,
  AVAILABILITY_OPTIONS,
  PREFERRED_ROLES,
  PLAYING_LEVEL_LABELS,
  PREFERRED_FOOT_LABELS,
  AVAILABILITY_LABELS,
  PREFERRED_ROLE_LABELS,
  type Position,
  type PreviousClub,
} from "@/types";
import { Upload, X, Plus, Trash2, Check, ChevronLeft, ChevronRight } from "lucide-react";

const TOTAL_STEPS = 5;

interface FormData {
  profile_photo_url: string;
  date_of_birth: string;
  location: string;
  bio: string;
  positions: Position[];
  preferred_role: string;
  playing_level: string;
  preferred_foot: string;
  availability: string;
  willing_to_travel: boolean;
  travel_radius: string;
  willing_to_relocate: boolean;
  previous_clubs: PreviousClub[];
  stats_appearances: string;
  stats_goals: string;
  stats_assists: string;
  stats_clean_sheets: string;
  stats_motm: string;
  achievements: string;
  preferred_leagues: string;
  compensation_expectation: string;
  highlight_video_url: string;
}

interface FormErrors {
  [key: string]: string;
}

const emptyFormData: FormData = {
  profile_photo_url: "",
  date_of_birth: "",
  location: "",
  bio: "",
  positions: [],
  preferred_role: "",
  playing_level: "",
  preferred_foot: "",
  availability: "",
  willing_to_travel: false,
  travel_radius: "",
  willing_to_relocate: false,
  previous_clubs: [],
  stats_appearances: "",
  stats_goals: "",
  stats_assists: "",
  stats_clean_sheets: "",
  stats_motm: "",
  achievements: "",
  preferred_leagues: "",
  compensation_expectation: "",
  highlight_video_url: "",
};

async function uploadProfilePhoto(
  file: File,
  userId: string,
): Promise<string> {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[upload-photo ${requestId}] Starting client-side upload (onboarding)`, {
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    userId,
  });

  const formData = new FormData();
  formData.append("file", file);

  console.log(`[upload-photo ${requestId}] POSTing to /api/player/upload-photo`);
  const res = await fetch("/api/player/upload-photo", {
    method: "POST",
    body: formData,
  });

  console.log(`[upload-photo ${requestId}] Response status:`, res.status);

  if (!res.ok) {
    let errorMessage = "Failed to upload photo";
    try {
      const errorData = await res.json();
      errorMessage = errorData.error || errorMessage;
      console.error(`[upload-photo ${requestId}] Server error:`, errorData);
    } catch {
      console.error(
        `[upload-photo ${requestId}] Non-JSON error response:`,
        res.statusText,
      );
    }
    throw new Error(errorMessage);
  }

  const data = await res.json();
  console.log(`[upload-photo ${requestId}] Upload successful:`, {
    url: data.url,
  });

  return data.url;
}

export default function PlayerOnboardingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [formData, setFormData] = useState<FormData>({ ...emptyFormData });
  const [errors, setErrors] = useState<FormErrors>({});
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [newClub, setNewClub] = useState<PreviousClub>({
    name: "",
    startDate: "",
    endDate: "",
    position: "",
    achievements: "",
  });

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/login");
      return;
    }
    const userRoles = session.user.roles as string[] | undefined;
    if (!userRoles || !userRoles.includes("player")) {
      if (userRoles?.includes("team")) {
        router.push("/team");
      } else {
        router.push("/onboarding");
      }
      return;
    }

    // Check if player profile already exists via the admin-backed API route
    // (the browser Supabase client can't read player_profiles due to RLS).
    async function checkExistingProfile() {
      if (!session?.user.id) return;
      const res = await fetch("/api/player/profile-data");
      if (!res.ok) return;
      const { playerProfile } = await res.json();

      if (playerProfile) {
        // Already has profile, go to dashboard
        router.push("/player");
      }
    }
    checkExistingProfile();
  }, [session, status, router]);

  const validateStep = useCallback(
    (stepNumber: number): boolean => {
      const newErrors: FormErrors = {};

      switch (stepNumber) {
        case 1: {
          if (!formData.date_of_birth) {
            newErrors.date_of_birth = "Date of birth is required";
          } else {
            const dob = new Date(formData.date_of_birth);
            const now = new Date();
            if (isNaN(dob.getTime())) {
              newErrors.date_of_birth = "Invalid date";
            } else if (dob > now) {
              newErrors.date_of_birth = "Date of birth cannot be in the future";
            } else {
              const age = now.getFullYear() - dob.getFullYear();
              if (age < 16) newErrors.date_of_birth = "You must be at least 16";
              if (age > 100) newErrors.date_of_birth = "Invalid date of birth";
            }
          }
          if (!formData.location) {
            newErrors.location = "Location is required";
          }
          break;
        }
        case 2: {
          if (formData.positions.length === 0) {
            newErrors.positions = "Select at least one position";
          }
          if (!formData.playing_level) {
            newErrors.playing_level = "Playing level is required";
          }
          if (!formData.preferred_foot) {
            newErrors.preferred_foot = "Preferred foot is required";
          }
          break;
        }
        case 3: {
          if (!formData.availability) {
            newErrors.availability = "Availability is required";
          }
          if (
            formData.willing_to_travel &&
            (!formData.travel_radius || parseInt(formData.travel_radius) <= 0)
          ) {
            newErrors.travel_radius = "Enter a valid travel radius (miles)";
          }
          break;
        }
        case 5: {
          if (formData.highlight_video_url) {
            try {
              new URL(formData.highlight_video_url);
            } catch {
              newErrors.highlight_video_url = "Enter a valid URL";
            }
          }
          break;
        }
      }

      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    },
    [formData],
  );

  const handleNext = () => {
    if (validateStep(step)) {
      setStep((prev) => Math.min(prev + 1, TOTAL_STEPS));
    }
  };

  const handleBack = () => {
    setStep((prev) => Math.max(prev - 1, 1));
    setErrors({});
  };

  const updateField = (field: keyof FormData, value: unknown) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const togglePosition = (pos: Position) => {
    setFormData((prev) => ({
      ...prev,
      positions: prev.positions.includes(pos)
        ? prev.positions.filter((p) => p !== pos)
        : [...prev.positions, pos],
    }));
  };

  const addClub = () => {
    if (!newClub.name || !newClub.startDate || !newClub.position) return;
    setFormData((prev) => ({
      ...prev,
      previous_clubs: [...prev.previous_clubs, { ...newClub }],
    }));
    setNewClub({ name: "", startDate: "", endDate: "", position: "", achievements: "" });
  };

  const removeClub = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      previous_clubs: prev.previous_clubs.filter((_, i) => i !== index),
    }));
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setErrors((prev) => ({
        ...prev,
        profile_photo: "Only JPG, PNG, and WebP files are allowed",
      }));
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setErrors((prev) => ({
        ...prev,
        profile_photo: "File size must be less than 5MB",
      }));
      return;
    }

    if (!session?.user.id) return;

    setUploadingPhoto(true);
    console.log(`[photo-upload] onboarding handlePhotoUpload: starting upload`, {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
    });
    try {
      const url = await uploadProfilePhoto(file, session.user.id);
      console.log(`[photo-upload] onboarding handlePhotoUpload: success, url=`, url);
      updateField("profile_photo_url", url);
      setPhotoPreview(URL.createObjectURL(file));
    } catch (err) {
      console.error(`[photo-upload] onboarding handlePhotoUpload: failed`, err);
      setErrors((prev) => ({
        ...prev,
        profile_photo: "Failed to upload photo. Please try again.",
      }));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSubmit = async () => {
    // Validate all steps
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      if (!validateStep(i)) {
        setStep(i);
        return;
      }
    }

    if (!session?.user.id) return;

    setLoading(true);
    setError(null);

    try {
      const achievementsList = formData.achievements
        .split("\n")
        .map((a) => a.trim())
        .filter((a) => a.length > 0);

      const preferredLeaguesList = formData.preferred_leagues
        .split(",")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const stats = {
        appearances: formData.stats_appearances
          ? parseInt(formData.stats_appearances)
          : undefined,
        goals: formData.stats_goals ? parseInt(formData.stats_goals) : undefined,
        assists: formData.stats_assists
          ? parseInt(formData.stats_assists)
          : undefined,
        cleanSheets: formData.stats_clean_sheets
          ? parseInt(formData.stats_clean_sheets)
          : undefined,
        manOfTheMatch: formData.stats_motm
          ? parseInt(formData.stats_motm)
          : undefined,
      };

      const profileData = {
        // user_id is intentionally omitted — the server forces it from the
        // authenticated session (see app/api/player/profile/route.ts).
        profile_photo_url: formData.profile_photo_url || null,
        date_of_birth: formData.date_of_birth || null,
        location: formData.location || null,
        positions: formData.positions,
        preferred_role: formData.preferred_role || null,
        playing_level: formData.playing_level || null,
        preferred_foot: formData.preferred_foot || null,
        availability: formData.availability || null,
        willing_to_travel: formData.willing_to_travel,
        willing_to_relocate: formData.willing_to_relocate,
        travel_radius: formData.travel_radius
          ? parseInt(formData.travel_radius)
          : null,
        compensation_expectation:
          formData.compensation_expectation || null,
        previous_clubs: formData.previous_clubs,
        stats,
        achievements: achievementsList,
        highlight_video_url: formData.highlight_video_url || null,
        preferred_leagues: preferredLeaguesList,
        bio: formData.bio || null,
      };

      const res = await fetch("/api/player/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileData),
      });

      if (!res.ok) {
        let errorMessage = "Failed to create player profile";
        try {
          const errorData = await res.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // Keep default message if the response body isn't JSON
        }
        throw new Error(errorMessage);
      }

      setSuccess(true);

      // Redirect after a brief delay
      setTimeout(() => {
        router.push("/player");
        router.refresh();
      }, 1500);
    } catch (err) {
      console.error("Failed to create player profile:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const userRoles = session?.user?.roles as string[] | undefined;
  if (!session || !userRoles?.includes("player")) {
    return null;
  }

  if (success) {
    return (
      <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Check className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Profile Created!</CardTitle>
            <CardDescription className="text-base">
              Your player profile has been created successfully. Redirecting you
              to your dashboard...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">Complete Your Player Profile</h1>
          <p className="text-lg text-muted-foreground">
            Step {step} of {TOTAL_STEPS}
          </p>
          {/* Progress indicator */}
          <div className="mt-4 flex gap-2">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-full ${
                  i + 1 <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>
              {step === 1 && "Basic Information"}
              {step === 2 && "Football Information"}
              {step === 3 && "Availability & Mobility"}
              {step === 4 && "Experience"}
              {step === 5 && "Opportunities"}
            </CardTitle>
            <CardDescription>
              {step === 1 && "Tell us about yourself"}
              {step === 2 && "Your football profile"}
              {step === 3 && "When and where can you play?"}
              {step === 4 && "Your football career so far"}
              {step === 5 && "What are you looking for?"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Step 1: Basic Information */}
            {step === 1 && (
              <>
                {/* Profile Photo */}
                <div className="space-y-2">
                  <Label>Profile Photo</Label>
                  <div className="flex items-center gap-4">
                    {photoPreview ? (
                      <div className="relative h-24 w-24 overflow-hidden rounded-full">
                        <img
                          src={photoPreview}
                          alt="Profile preview"
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setPhotoPreview(null);
                            updateField("profile_photo_url", "");
                          }}
                          className="absolute right-0 top-0 rounded-full bg-destructive p-1 text-destructive-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/50">
                        <Upload className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                    <div>
                      <Label
                        htmlFor="photo-upload"
                        className="cursor-pointer rounded-md bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/80"
                      >
                        {uploadingPhoto ? "Uploading..." : "Choose Photo"}
                      </Label>
                      <input
                        id="photo-upload"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={handlePhotoUpload}
                        disabled={uploadingPhoto}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        JPG, PNG, or WebP. Max 5MB.
                      </p>
                    </div>
                  </div>
                  {errors.profile_photo && (
                    <p className="text-sm text-destructive">
                      {errors.profile_photo}
                    </p>
                  )}
                </div>

                {/* Date of Birth */}
                <div className="space-y-2">
                  <Label htmlFor="date_of_birth">
                    Date of Birth <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="date_of_birth"
                    type="date"
                    value={formData.date_of_birth}
                    onChange={(e) =>
                      updateField("date_of_birth", e.target.value)
                    }
                  />
                  {errors.date_of_birth && (
                    <p className="text-sm text-destructive">
                      {errors.date_of_birth}
                    </p>
                  )}
                </div>

                {/* Location */}
                <div className="space-y-2">
                  <Label htmlFor="location">
                    Location <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="location"
                    placeholder="City, State (e.g., Phoenix, AZ)"
                    value={formData.location}
                    onChange={(e) => updateField("location", e.target.value)}
                  />
                  {errors.location && (
                    <p className="text-sm text-destructive">
                      {errors.location}
                    </p>
                  )}
                </div>

                {/* Bio */}
                <div className="space-y-2">
                  <Label htmlFor="bio">Short Bio</Label>
                  <Textarea
                    id="bio"
                    placeholder="Tell teams about yourself, your playing style, and what makes you unique..."
                    rows={4}
                    value={formData.bio}
                    onChange={(e) => updateField("bio", e.target.value)}
                  />
                </div>
              </>
            )}

            {/* Step 2: Football Information */}
            {step === 2 && (
              <>
                {/* Positions */}
                <div className="space-y-2">
                  <Label>
                    Positions <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Select your primary and secondary positions
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {POSITIONS.map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        onClick={() => togglePosition(pos)}
                        className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                          formData.positions.includes(pos)
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                  {errors.positions && (
                    <p className="text-sm text-destructive">
                      {errors.positions}
                    </p>
                  )}
                </div>

                {/* Preferred Role */}
                <div className="space-y-2">
                  <Label htmlFor="preferred_role">Preferred Role</Label>
                  <Select
                    value={formData.preferred_role}
                    onValueChange={(value) =>
                      updateField("preferred_role", value)
                    }
                  >
                    <SelectTrigger id="preferred_role">
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {PREFERRED_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {PREFERRED_ROLE_LABELS[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Playing Level */}
                <div className="space-y-2">
                  <Label htmlFor="playing_level">
                    Playing Level <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={formData.playing_level}
                    onValueChange={(value) =>
                      updateField("playing_level", value)
                    }
                  >
                    <SelectTrigger id="playing_level">
                      <SelectValue placeholder="Select your level" />
                    </SelectTrigger>
                    <SelectContent>
                      {PLAYING_LEVELS.map((level) => (
                        <SelectItem key={level} value={level}>
                          {PLAYING_LEVEL_LABELS[level]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.playing_level && (
                    <p className="text-sm text-destructive">
                      {errors.playing_level}
                    </p>
                  )}
                </div>

                {/* Preferred Foot */}
                <div className="space-y-2">
                  <Label htmlFor="preferred_foot">
                    Preferred Foot <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={formData.preferred_foot}
                    onValueChange={(value) =>
                      updateField("preferred_foot", value)
                    }
                  >
                    <SelectTrigger id="preferred_foot">
                      <SelectValue placeholder="Select your preferred foot" />
                    </SelectTrigger>
                    <SelectContent>
                      {PREFERRED_FEET.map((foot) => (
                        <SelectItem key={foot} value={foot}>
                          {PREFERRED_FOOT_LABELS[foot]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.preferred_foot && (
                    <p className="text-sm text-destructive">
                      {errors.preferred_foot}
                    </p>
                  )}
                </div>
              </>
            )}

            {/* Step 3: Availability & Mobility */}
            {step === 3 && (
              <>
                {/* Availability */}
                <div className="space-y-2">
                  <Label htmlFor="availability">
                    Availability <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={formData.availability}
                    onValueChange={(value) =>
                      updateField("availability", value)
                    }
                  >
                    <SelectTrigger id="availability">
                      <SelectValue placeholder="When can you start?" />
                    </SelectTrigger>
                    <SelectContent>
                      {AVAILABILITY_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {AVAILABILITY_LABELS[opt]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.availability && (
                    <p className="text-sm text-destructive">
                      {errors.availability}
                    </p>
                  )}
                </div>

                {/* Willing to Travel */}
                <div className="flex items-center gap-3">
                  <input
                    id="willing_to_travel"
                    type="checkbox"
                    checked={formData.willing_to_travel}
                    onChange={(e) =>
                      updateField("willing_to_travel", e.target.checked)
                    }
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <Label htmlFor="willing_to_travel" className="cursor-pointer">
                    Willing to travel for opportunities
                  </Label>
                </div>

                {formData.willing_to_travel && (
                  <div className="space-y-2">
                    <Label htmlFor="travel_radius">
                      Travel Radius (miles)
                    </Label>
                    <Input
                      id="travel_radius"
                      type="number"
                      min="1"
                      placeholder="e.g., 50"
                      value={formData.travel_radius}
                      onChange={(e) =>
                        updateField("travel_radius", e.target.value)
                      }
                    />
                    {errors.travel_radius && (
                      <p className="text-sm text-destructive">
                        {errors.travel_radius}
                      </p>
                    )}
                  </div>
                )}

                {/* Willing to Relocate */}
                <div className="flex items-center gap-3">
                  <input
                    id="willing_to_relocate"
                    type="checkbox"
                    checked={formData.willing_to_relocate}
                    onChange={(e) =>
                      updateField("willing_to_relocate", e.target.checked)
                    }
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <Label
                    htmlFor="willing_to_relocate"
                    className="cursor-pointer"
                  >
                    Willing to relocate for the right opportunity
                  </Label>
                </div>
              </>
            )}

            {/* Step 4: Experience */}
            {step === 4 && (
              <>
                {/* Previous Clubs */}
                <div className="space-y-4">
                  <Label>Previous Clubs</Label>
                  <div className="rounded-lg border p-4 space-y-3">
                    <Input
                      placeholder="Club name"
                      value={newClub.name}
                      onChange={(e) =>
                        setNewClub((prev) => ({ ...prev, name: e.target.value }))
                      }
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Start Date</Label>
                        <Input
                          type="date"
                          value={newClub.startDate}
                          onChange={(e) =>
                            setNewClub((prev) => ({
                              ...prev,
                              startDate: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">End Date (optional)</Label>
                        <Input
                          type="date"
                          value={newClub.endDate || ""}
                          onChange={(e) =>
                            setNewClub((prev) => ({
                              ...prev,
                              endDate: e.target.value || null,
                            }))
                          }
                        />
                      </div>
                    </div>
                    <Input
                      placeholder="Position played (e.g., CM)"
                      value={newClub.position}
                      onChange={(e) =>
                        setNewClub((prev) => ({
                          ...prev,
                          position: e.target.value,
                        }))
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addClub}
                      disabled={!newClub.name || !newClub.startDate || !newClub.position}
                    >
                      <Plus className="mr-1 h-4 w-4" /> Add Club
                    </Button>
                  </div>

                  {formData.previous_clubs.length > 0 && (
                    <div className="space-y-2">
                      {formData.previous_clubs.map((club, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between rounded-lg border p-3"
                        >
                          <div>
                            <p className="font-medium">{club.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {club.position} &middot; {club.startDate}
                              {club.endDate ? ` - ${club.endDate}` : " - Present"}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeClub(index)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Stats */}
                <div className="space-y-2">
                  <Label>Career Stats (optional)</Label>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div>
                      <Label className="text-xs">Appearances</Label>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={formData.stats_appearances}
                        onChange={(e) =>
                          updateField("stats_appearances", e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Goals</Label>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={formData.stats_goals}
                        onChange={(e) =>
                          updateField("stats_goals", e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Assists</Label>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={formData.stats_assists}
                        onChange={(e) =>
                          updateField("stats_assists", e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Clean Sheets</Label>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={formData.stats_clean_sheets}
                        onChange={(e) =>
                          updateField("stats_clean_sheets", e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Man of the Match</Label>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={formData.stats_motm}
                        onChange={(e) =>
                          updateField("stats_motm", e.target.value)
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* Achievements */}
                <div className="space-y-2">
                  <Label htmlFor="achievements">
                    Achievements (one per line)
                  </Label>
                  <Textarea
                    id="achievements"
                    placeholder="e.g.,&#10;League Champion 2024&#10;Best Midfielder Award&#10;50 Appearances Milestone"
                    rows={4}
                    value={formData.achievements}
                    onChange={(e) => updateField("achievements", e.target.value)}
                  />
                </div>
              </>
            )}

            {/* Step 5: Opportunities */}
            {step === 5 && (
              <>
                {/* Preferred Leagues */}
                <div className="space-y-2">
                  <Label htmlFor="preferred_leagues">
                    Preferred Leagues (comma-separated)
                  </Label>
                  <Input
                    id="preferred_leagues"
                    placeholder="e.g., MLS, USL Championship, NPSL"
                    value={formData.preferred_leagues}
                    onChange={(e) =>
                      updateField("preferred_leagues", e.target.value)
                    }
                  />
                </div>

                {/* Compensation Expectation */}
                <div className="space-y-2">
                  <Label htmlFor="compensation_expectation">
                    Compensation Expectations
                  </Label>
                  <Input
                    id="compensation_expectation"
                    placeholder="e.g., Negotiable, $X,XXX/month, etc."
                    value={formData.compensation_expectation}
                    onChange={(e) =>
                      updateField("compensation_expectation", e.target.value)
                    }
                  />
                </div>

                {/* Highlight Video */}
                <div className="space-y-2">
                  <Label htmlFor="highlight_video_url">
                    Highlight Video URL
                  </Label>
                  <Input
                    id="highlight_video_url"
                    type="url"
                    placeholder="https://youtube.com/watch?v=..."
                    value={formData.highlight_video_url}
                    onChange={(e) =>
                      updateField("highlight_video_url", e.target.value)
                    }
                  />
                  {errors.highlight_video_url && (
                    <p className="text-sm text-destructive">
                      {errors.highlight_video_url}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Paste a link to your YouTube, Vimeo, or other highlight reel
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Navigation Buttons */}
        <div className="mt-6 flex justify-between">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={step === 1 || loading}
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> Back
          </Button>

          {step < TOTAL_STEPS ? (
            <Button onClick={handleNext}>
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? "Saving..." : "Complete Profile"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}