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
  TEAM_PLAYING_LEVELS,
  TEAM_PLAYING_LEVEL_LABELS,
} from "@/types";
import { Upload, X, Check } from "lucide-react";

const TOTAL_STEPS = 3;

interface FormData {
  team_name: string;
  logo_url: string;
  location: string;
  description: string;
  league: string;
  playing_level: string;
  contact_name: string;
  website_url: string;
  social_links: string;
}

interface FormErrors {
  [key: string]: string;
}

const emptyFormData: FormData = {
  team_name: "",
  logo_url: "",
  location: "",
  description: "",
  league: "",
  playing_level: "",
  contact_name: "",
  website_url: "",
  social_links: "",
};

async function uploadTeamLogo(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/team/upload-logo", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    let errorMessage = "Failed to upload logo";
    try {
      const errorData = await res.json();
      errorMessage = errorData.error || errorMessage;
    } catch {
      // keep default
    }
    throw new Error(errorMessage);
  }

  const data = await res.json();
  return data.url;
}

export default function TeamOnboardingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [formData, setFormData] = useState<FormData>({ ...emptyFormData });
  const [errors, setErrors] = useState<FormErrors>({});
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/login");
      return;
    }

    // Check if team profile already exists
    async function checkExistingProfile() {
      if (!session?.user.id) return;
      const res = await fetch("/api/team/profile-data");
      if (!res.ok) return;
      const { teamProfile } = await res.json();

      if (teamProfile) {
        // Already has profile, go to team dashboard
        router.push("/team");
      }
    }
    checkExistingProfile();
  }, [session, status, router]);

  const validateStep = useCallback(
    (stepNumber: number): boolean => {
      const newErrors: FormErrors = {};

      switch (stepNumber) {
        case 1: {
          if (!formData.team_name.trim()) {
            newErrors.team_name = "Team name is required";
          } else if (formData.team_name.length > 100) {
            newErrors.team_name = "Team name must be less than 100 characters";
          }
          if (!formData.location.trim()) {
            newErrors.location = "Location is required";
          }
          break;
        }
        case 2: {
          if (!formData.playing_level) {
            newErrors.playing_level = "Playing level ist required";
          }
          break;
        }
        case 3: {
          if (formData.website_url) {
            try {
              new URL(formData.website_url);
            } catch {
              newErrors.website_url = "Enter a valid URL (https://...)";
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

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setErrors((prev) => ({
        ...prev,
        logo: "Only JPG, PNG, and WebP files are allowed",
      }));
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setErrors((prev) => ({
        ...prev,
        logo: "File size must be less than 5MB",
      }));
      return;
    }

    if (!session?.user.id) return;

    setUploadingLogo(true);
    try {
      const url = await uploadTeamLogo(file);
      updateField("logo_url", url);
      setLogoPreview(URL.createObjectURL(file));
    } catch (err) {
      console.error("Logo upload failed:", err);
      setErrors((prev) => ({
        ...prev,
        logo: "Failed to upload logo. Please try again.",
      }));
    } finally {
      setUploadingLogo(false);
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
      const socialLinksList = formData.social_links
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const profileData = {
        team_name: formData.team_name,
        logo_url: formData.logo_url || null,
        location: formData.location || null,
        description: formData.description || null,
        league: formData.league || null,
        playing_level: formData.playing_level || null,
        contact_name: formData.contact_name || null,
        website_url: formData.website_url || null,
        social_links: socialLinksList,
      };

      const res = await fetch("/api/team/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileData),
      });

      if (!res.ok) {
        let errorMessage = "Failed to create team profile";
        try {
          const errorData = await res.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // keep default
        }
        throw new Error(errorMessage);
      }

      setSuccess(true);

      // Redirect after a brief delay
      setTimeout(() => {
        router.push("/team");
        router.refresh();
      }, 1500);
    } catch (err) {
      console.error("Failed to create team profile:", err);
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

  if (!session) {
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
            <CardTitle className="text-2xl">Team Profile Created!</CardTitle>
            <CardDescription className="text-base">
              Your team profile has been created successfully. Redirecting you
              to your team dashboard...
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
          <h1 className="mb-2 text-3xl font-bold">Create Your Team Profile</h1>
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
              {step === 3 && "Contact & Links"}
            </CardTitle>
            <CardDescription>
              {step === 1 && "Tell us about your team"}
              {step === 2 && "Your team's football details"}
              {step === 3 && "How can players reach you?"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Step 1: Basic Information */}
            {step === 1 && (
              <>
                {/* Team Logo */}
                <div className="space-y-2">
                  <Label>Team Logo</Label>
                  <div className="flex items-center gap-4">
                    {logoPreview ? (
                      <div className="relative h-24 w-24 overflow-hidden rounded-xl">
                        <img
                          src={logoPreview}
                          alt="Logo preview"
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setLogoPreview(null);
                            updateField("logo_url", "");
                          }}
                          className="absolute right-0 top-0 rounded-full bg-destructive p-1 text-destructive-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/50">
                        <Upload className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                    <div>
                      <Label
                        htmlFor="logo-upload"
                        className="cursor-pointer rounded-md bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/80"
                      >
                        {uploadingLogo ? "Uploading..." : "Choose Logo"}
                      </Label>
                      <input
                        id="logo-upload"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={handleLogoUpload}
                        disabled={uploadingLogo}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        JPG, PNG, or WebP. Max 5MB.
                      </p>
                    </div>
                  </div>
                  {errors.logo && (
                    <p className="text-sm text-destructive">{errors.logo}</p>
                  )}
                </div>

                {/* Team Name */}
                <div className="space-y-2">
                  <Label htmlFor="team_name">
                    Team Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="team_name"
                    placeholder="e.g., Phoenix FC"
                    value={formData.team_name}
                    onChange={(e) =>
                      updateField("team_name", e.target.value)
                    }
                  />
                  {errors.team_name && (
                    <p className="text-sm text-destructive">
                      {errors.team_name}
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

                {/* Description */}
                <div className="space-y-2">
                  <Label htmlFor="description">Team Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Tell players about your team, its history, culture, and what you're looking for..."
                    rows={4}
                    value={formData.description}
                    onChange={(e) => updateField("description", e.target.value)}
                  />
                </div>
              </>
            )}

            {/* Step 2: Football Information */}
            {step === 2 && (
              <>
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
                      <SelectValue placeholder="Select your team's level" />
                    </SelectTrigger>
                    <SelectContent>
                      {TEAM_PLAYING_LEVELS.map((level) => (
                        <SelectItem key={level} value={level}>
                          {TEAM_PLAYING_LEVEL_LABELS[level]}
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

                {/* League */}
                <div className="space-y-2">
                  <Label htmlFor="league">League</Label>
                  <Input
                    id="league"
                    placeholder="e.g., UPSL, NPSL, Local League"
                    value={formData.league}
                    onChange={(e) => updateField("league", e.target.value)}
                  />
                </div>
              </>
            )}

            {/* Step 3: Contact & Links */}
            {step === 3 && (
              <>
                {/* Contact Name */}
                <div className="space-y-2">
                  <Label htmlFor="contact_name">Contact Name</Label>
                  <Input
                    id="contact_name"
                    placeholder="e.g., John Smith"
                    value={formData.contact_name}
                    onChange={(e) =>
                      updateField("contact_name", e.target.value)
                    }
                  />
                </div>

                {/* Website */}
                <div className="space-y-2">
                  <Label htmlFor="website_url">Website</Label>
                  <Input
                    id="website_url"
                    type="url"
                    placeholder="https://..."
                    value={formData.website_url}
                    onChange={(e) =>
                      updateField("website_url", e.target.value)
                    }
                  />
                  {errors.website_url && (
                    <p className="text-sm text-destructive">
                      {errors.website_url}
                    </p>
                  )}
                </div>

                {/* Social Links */}
                <div className="space-y-2">
                  <Label htmlFor="social_links">Social Links</Label>
                  <p className="text-xs text-muted-foreground">
                    One link per line (e.g., https://instagram.com/team)
                  </p>
                  <Textarea
                    id="social_links"
                    placeholder="https://instagram.com/team&#10;https://twitter.com/team"
                    rows={3}
                    value={formData.social_links}
                    onChange={(e) =>
                      updateField("social_links", e.target.value)
                    }
                  />
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
            disabled={step === 1}
          >
            Back
          </Button>
          {step < TOTAL_STEPS ? (
            <Button onClick={handleNext}>Next</Button>
          ) : (
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? "Creating..." : "Create Team Profile"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}