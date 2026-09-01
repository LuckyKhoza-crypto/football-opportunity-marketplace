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
  type PlayerProfile,
  type PreviousClub,
} from "@/types";
import { Upload, X, Plus, Trash2, ChevronLeft } from "lucide-react";
import Link from "next/link";

async function uploadProfilePhoto(
  file: File,
  userId: string,
): Promise<string> {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[upload-photo ${requestId}] Starting client-side upload`, {
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

export default function EditPlayerProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Form state
  const [profilePhotoUrl, setProfilePhotoUrl] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  const [positions, setPositions] = useState<Position[]>([]);
  const [preferredRole, setPreferredRole] = useState("");
  const [playingLevel, setPlayingLevel] = useState("");
  const [preferredFoot, setPreferredFoot] = useState("");
  const [availability, setAvailability] = useState("");
  const [willingToTravel, setWillingToTravel] = useState(false);
  const [travelRadius, setTravelRadius] = useState("");
  const [willingToRelocate, setWillingToRelocate] = useState(false);
  const [previousClubs, setPreviousClubs] = useState<PreviousClub[]>([]);
  const [statsAppearances, setStatsAppearances] = useState("");
  const [statsGoals, setStatsGoals] = useState("");
  const [statsAssists, setStatsAssists] = useState("");
  const [statsCleanSheets, setStatsCleanSheets] = useState("");
  const [statsMotm, setStatsMotm] = useState("");
  const [achievementsText, setAchievementsText] = useState("");
  const [preferredLeagues, setPreferredLeagues] = useState("");
  const [compensationExpectation, setCompensationExpectation] = useState("");
  const [highlightVideoUrl, setHighlightVideoUrl] = useState("");

  // New club input
  const [newClub, setNewClub] = useState<PreviousClub>({
    name: "",
    startDate: "",
    endDate: "",
    position: "",
    achievements: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

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

    async function loadProfile() {
      if (!session?.user.email || !session.user.id) return;

      // Fetch player profile via admin-backed API route (bypasses RLS)
      const res = await fetch("/api/player/profile-data");
      if (!res.ok) {
        router.push("/onboarding");
        return;
      }
      const { playerProfile } = await res.json();
      if (!playerProfile) {
        router.push("/player/onboarding");
        return;
      }

      const pp = playerProfile as unknown as PlayerProfile;
      setProfilePhotoUrl(pp.profile_photo_url || "");
      if (pp.profile_photo_url) setPhotoPreview(pp.profile_photo_url);
      setDateOfBirth(pp.date_of_birth || "");
      setLocation(pp.location || "");
      setBio(pp.bio || "");
      setPositions(pp.positions || []);
      setPreferredRole(pp.preferred_role || "");
      setPlayingLevel(pp.playing_level || "");
      setPreferredFoot(pp.preferred_foot || "");
      setAvailability(pp.availability || "");
      setWillingToTravel(pp.willing_to_travel || false);
      setTravelRadius(pp.travel_radius?.toString() || "");
      setWillingToRelocate(pp.willing_to_relocate || false);
      setPreviousClubs(pp.previous_clubs || []);
      if (pp.stats) {
        setStatsAppearances(pp.stats.appearances?.toString() || "");
        setStatsGoals(pp.stats.goals?.toString() || "");
        setStatsAssists(pp.stats.assists?.toString() || "");
        setStatsCleanSheets(pp.stats.cleanSheets?.toString() || "");
        setStatsMotm(pp.stats.manOfTheMatch?.toString() || "");
      }
      setAchievementsText((pp.achievements || []).join("\n"));
      setPreferredLeagues((pp.preferred_leagues || []).join(", "));
      setCompensationExpectation(pp.compensation_expectation || "");
      setHighlightVideoUrl(pp.highlight_video_url || "");

      setInitialLoading(false);
    }

    loadProfile();
  }, [session, status, router]);

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (dateOfBirth) {
      const dob = new Date(dateOfBirth);
      const now = new Date();
      if (isNaN(dob.getTime())) {
        newErrors.dateOfBirth = "Invalid date";
      } else if (dob > now) {
        newErrors.dateOfBirth = "Date of birth cannot be in the future";
      }
    }

    if (willingToTravel && (!travelRadius || parseInt(travelRadius) <= 0)) {
      newErrors.travelRadius = "Enter a valid travel radius (miles)";
    }

    if (highlightVideoUrl) {
      try {
        new URL(highlightVideoUrl);
      } catch {
        newErrors.highlightVideoUrl = "Enter a valid URL";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [dateOfBirth, willingToTravel, travelRadius, highlightVideoUrl]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.user.id) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setErrors((prev) => ({ ...prev, photo: "Only JPG, PNG, and WebP files are allowed" }));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, photo: "File size must be less than 5MB" }));
      return;
    }

    setUploadingPhoto(true);
    console.log(`[photo-upload] handlePhotoUpload: starting upload for`, {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
    });
    try {
      const url = await uploadProfilePhoto(file, session.user.id);
      console.log(`[photo-upload] handlePhotoUpload: success, url=`, url);
      setProfilePhotoUrl(url);
      setPhotoPreview(URL.createObjectURL(file));
    } catch (err) {
      console.error(`[photo-upload] handlePhotoUpload: failed`, err);
      setErrors((prev) => ({ ...prev, photo: "Failed to upload photo" }));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const togglePosition = (pos: Position) => {
    setPositions((prev) =>
      prev.includes(pos)
        ? prev.filter((p) => p !== pos)
        : [...prev, pos],
    );
  };

  const addClub = () => {
    if (!newClub.name || !newClub.startDate || !newClub.position) return;
    setPreviousClubs((prev) => [...prev, { ...newClub }]);
    setNewClub({ name: "", startDate: "", endDate: "", position: "", achievements: "" });
  };

  const removeClub = (index: number) => {
    setPreviousClubs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    if (!session?.user.id) return;

    setSaving(true);
    setError(null);

    try {
      const achievementsList = achievementsText
        .split("\n")
        .map((a) => a.trim())
        .filter((a) => a.length > 0);

      const preferredLeaguesList = preferredLeagues
        .split(",")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const stats = {
        ...(statsAppearances && { appearances: parseInt(statsAppearances) }),
        ...(statsGoals && { goals: parseInt(statsGoals) }),
        ...(statsAssists && { assists: parseInt(statsAssists) }),
        ...(statsCleanSheets && { cleanSheets: parseInt(statsCleanSheets) }),
        ...(statsMotm && { manOfTheMatch: parseInt(statsMotm) }),
      };

      const profileData = {
        profile_photo_url: profilePhotoUrl || null,
        date_of_birth: dateOfBirth || null,
        location: location || null,
        positions,
        preferred_role: preferredRole || null,
        playing_level: playingLevel || null,
        preferred_foot: preferredFoot || null,
        availability: availability || null,
        willing_to_travel: willingToTravel,
        willing_to_relocate: willingToRelocate,
        travel_radius: travelRadius ? parseInt(travelRadius) : null,
        compensation_expectation: compensationExpectation || null,
        previous_clubs: previousClubs,
        stats,
        achievements: achievementsList,
        highlight_video_url: highlightVideoUrl || null,
        preferred_leagues: preferredLeaguesList,
        bio: bio || null,
      };

      const res = await fetch("/api/player/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileData),
      });

      if (!res.ok) {
        let errorMessage = "Failed to update profile";
        try {
          const errorData = await res.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // Keep default message if the response body isn't JSON
        }
        throw new Error(errorMessage);
      }

      setSuccess(true);
      router.refresh();
    } catch (err) {
      console.error("Failed to update profile:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (initialLoading || status === "loading") {
    return (
      <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session) return null;

  if (success) {
    return (
      <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle className="text-2xl">Profile Updated!</CardTitle>
            <CardDescription className="text-base">
              Your profile has been saved successfully.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/player/profile">
              <Button>View Profile</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <Link
            href="/player/profile"
            className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> Back to Profile
          </Link>
          <h1 className="text-3xl font-bold">Edit Profile</h1>
          <p className="text-lg text-muted-foreground">
            Update your player information
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-8">
          {/* Photo */}
          <Card>
            <CardHeader>
              <CardTitle>Profile Photo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                {photoPreview ? (
                  <div className="relative h-24 w-24 overflow-hidden rounded-full">
                    <img
                      src={photoPreview}
                      alt="Profile"
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setPhotoPreview(null);
                        setProfilePhotoUrl("");
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
                    htmlFor="edit-photo-upload"
                    className="cursor-pointer rounded-md bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/80"
                  >
                    {uploadingPhoto ? "Uploading..." : "Change Photo"}
                  </Label>
                  <input
                    id="edit-photo-upload"
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
              {errors.photo && (
                <p className="mt-2 text-sm text-destructive">{errors.photo}</p>
              )}
            </CardContent>
          </Card>

          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-dob">Date of Birth</Label>
                <Input
                  id="edit-dob"
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-location">Location</Label>
                <Input
                  id="edit-location"
                  placeholder="City, State"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-bio">Bio</Label>
                <Textarea
                  id="edit-bio"
                  rows={3}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Football Info */}
          <Card>
            <CardHeader>
              <CardTitle>Football Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Positions</Label>
                <div className="flex flex-wrap gap-2">
                  {POSITIONS.map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => togglePosition(pos)}
                      className={`rounded-full border px-3 py-1 text-sm font-medium ${
                        positions.includes(pos)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-role">Preferred Role</Label>
                <Select value={preferredRole} onValueChange={setPreferredRole}>
                  <SelectTrigger id="edit-role">
                    <SelectValue placeholder="Select role" />
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
              <div className="space-y-2">
                <Label htmlFor="edit-level">Playing Level</Label>
                <Select value={playingLevel} onValueChange={setPlayingLevel}>
                  <SelectTrigger id="edit-level">
                    <SelectValue placeholder="Select level" />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAYING_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {PLAYING_LEVEL_LABELS[level]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-foot">Preferred Foot</Label>
                <Select value={preferredFoot} onValueChange={setPreferredFoot}>
                  <SelectTrigger id="edit-foot">
                    <SelectValue placeholder="Select foot" />
                  </SelectTrigger>
                  <SelectContent>
                    {PREFERRED_FEET.map((foot) => (
                      <SelectItem key={foot} value={foot}>
                        {PREFERRED_FOOT_LABELS[foot]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Availability */}
          <Card>
            <CardHeader>
              <CardTitle>Availability & Mobility</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-availability">Availability</Label>
                <Select
                  value={availability}
                  onValueChange={setAvailability}
                >
                  <SelectTrigger id="edit-availability">
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
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="edit-travel"
                  type="checkbox"
                  checked={willingToTravel}
                  onChange={(e) => setWillingToTravel(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary"
                />
                <Label htmlFor="edit-travel" className="cursor-pointer">
                  Willing to travel
                </Label>
              </div>
              {willingToTravel && (
                <div className="space-y-2">
                  <Label htmlFor="edit-radius">Travel Radius (miles)</Label>
                  <Input
                    id="edit-radius"
                    type="number"
                    min="1"
                    value={travelRadius}
                    onChange={(e) => setTravelRadius(e.target.value)}
                  />
                  {errors.travelRadius && (
                    <p className="text-sm text-destructive">
                      {errors.travelRadius}
                    </p>
                  )}
                </div>
              )}
              <div className="flex items-center gap-3">
                <input
                  id="edit-relocate"
                  type="checkbox"
                  checked={willingToRelocate}
                  onChange={(e) => setWillingToRelocate(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary"
                />
                <Label htmlFor="edit-relocate" className="cursor-pointer">
                  Willing to relocate
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Experience */}
          <Card>
            <CardHeader>
              <CardTitle>Experience</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
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
                    placeholder="Position played"
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
                    disabled={
                      !newClub.name || !newClub.startDate || !newClub.position
                    }
                  >
                    <Plus className="mr-1 h-4 w-4" /> Add Club
                  </Button>
                </div>
                {previousClubs.length > 0 && (
                  <div className="space-y-2">
                    {previousClubs.map((club, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <div>
                          <p className="font-medium">{club.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {club.position} &middot; {club.startDate}
                            {club.endDate
                              ? ` - ${club.endDate}`
                              : " - Present"}
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

              <div className="space-y-2">
                <Label>Career Stats</Label>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs">Appearances</Label>
                    <Input
                      type="number"
                      min="0"
                      value={statsAppearances}
                      onChange={(e) => setStatsAppearances(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Goals</Label>
                    <Input
                      type="number"
                      min="0"
                      value={statsGoals}
                      onChange={(e) => setStatsGoals(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Assists</Label>
                    <Input
                      type="number"
                      min="0"
                      value={statsAssists}
                      onChange={(e) => setStatsAssists(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Clean Sheets</Label>
                    <Input
                      type="number"
                      min="0"
                      value={statsCleanSheets}
                      onChange={(e) => setStatsCleanSheets(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Man of the Match</Label>
                    <Input
                      type="number"
                      min="0"
                      value={statsMotm}
                      onChange={(e) => setStatsMotm(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-achievements">Achievements (one per line)</Label>
                <Textarea
                  id="edit-achievements"
                  rows={3}
                  value={achievementsText}
                  onChange={(e) => setAchievementsText(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Opportunities */}
          <Card>
            <CardHeader>
              <CardTitle>Opportunities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-leagues">
                  Preferred Leagues (comma-separated)
                </Label>
                <Input
                  id="edit-leagues"
                  value={preferredLeagues}
                  onChange={(e) => setPreferredLeagues(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-compensation">
                  Compensation Expectations
                </Label>
                <Input
                  id="edit-compensation"
                  value={compensationExpectation}
                  onChange={(e) => setCompensationExpectation(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-video">Highlight Video URL</Label>
                <Input
                  id="edit-video"
                  type="url"
                  placeholder="https://..."
                  value={highlightVideoUrl}
                  onChange={(e) => setHighlightVideoUrl(e.target.value)}
                />
                {errors.highlightVideoUrl && (
                  <p className="text-sm text-destructive">
                    {errors.highlightVideoUrl}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-between gap-4">
            <Link href="/player/profile">
              <Button variant="outline">Cancel</Button>
            </Link>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}