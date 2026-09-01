"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  POSITION_LABELS,
  PLAYING_LEVELS,
  PLAYING_LEVEL_LABELS,
  PREFERRED_FEET,
  PREFERRED_FOOT_LABELS,
  AVAILABILITY_OPTIONS,
  AVAILABILITY_LABELS,
  ROLE_OPTIONS,
  FORMATION_OPTIONS,
  COMPENSATION_OPTIONS,
  HOUSING_OPTIONS,
  CONTRACT_LENGTH_OPTIONS,
  TRAVEL_REQUIREMENTS_OPTIONS,
  VISA_REQUIREMENTS_OPTIONS,
  type Opportunity,
} from "@/types";
import { Save, Send, ArrowLeft, X } from "lucide-react";

interface FormData {
  title: string;
  position: string;
  secondary_positions: string[];
  role: string;
  formation: string;
  age_min: string;
  age_max: string;
  playing_level: string;
  league: string;
  location: string;
  radius: string;
  preferred_foot: string;
  availability: string;
  compensation: string;
  housing: string;
  travel_requirements: string;
  visa_requirements: string;
  contract_length: string;
  tryout_date: string;
  description: string;
}

interface FormErrors {
  [key: string]: string;
}

export default function EditOpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opportunityId, setOpportunityId] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<string>("draft");
  const [formData, setFormData] = useState<FormData>({
    title: "",
    position: "",
    secondary_positions: [],
    role: "",
    formation: "",
    age_min: "",
    age_max: "",
    playing_level: "",
    league: "",
    location: "",
    radius: "",
    preferred_foot: "",
    availability: "",
    compensation: "",
    housing: "",
    travel_requirements: "",
    visa_requirements: "",
    contract_length: "",
    tryout_date: "",
    description: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    async function resolveParams() {
      const resolved = await params;
      setOpportunityId(resolved.id);
    }
    resolveParams();
  }, [params]);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/login");
      return;
    }
    if (!opportunityId) return;

    async function loadOpportunity() {
      try {
        const res = await fetch(`/api/team/opportunities/${opportunityId}`);
        if (!res.ok) throw new Error("Failed to load opportunity");

        const { opportunity } = await res.json();
        if (!opportunity) {
          router.push("/team/opportunities");
          return;
        }

        const opp = opportunity as Opportunity;
        setCurrentStatus(opp.status);
        setFormData({
          title: opp.title || "",
          position: opp.position || "",
          secondary_positions: opp.secondary_positions || [],
          role: opp.role || "",
          formation: opp.formation || "",
          age_min: opp.age_min?.toString() || "",
          age_max: opp.age_max?.toString() || "",
          playing_level: opp.playing_level || "",
          league: opp.league || "",
          location: opp.location || "",
          radius: opp.radius?.toString() || "",
          preferred_foot: opp.preferred_foot || "",
          availability: opp.availability || "",
          compensation: opp.compensation || "",
          housing: opp.housing || "",
          travel_requirements: opp.travel_requirements || "",
          visa_requirements: opp.visa_requirements || "",
          contract_length: opp.contract_length || "",
          tryout_date: opp.tryout_date || "",
          description: opp.description || "",
        });
      } catch (err) {
        console.error("Failed to load opportunity:", err);
        setError("Failed to load opportunity. Please try again.");
      } finally {
        setFetching(false);
      }
    }

    loadOpportunity();
  }, [session, status, router, opportunityId]);

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

  const addSecondaryPosition = (pos: string) => {
    if (!formData.secondary_positions.includes(pos)) {
      updateField("secondary_positions", [
        ...formData.secondary_positions,
        pos,
      ]);
    }
  };

  const removeSecondaryPosition = (pos: string) => {
    updateField(
      "secondary_positions",
      formData.secondary_positions.filter((p) => p !== pos),
    );
  };

  const validate = (_isPublishing: boolean): boolean => {
    void _isPublishing;
    const newErrors: FormErrors = {};

    if (!formData.title.trim()) {
      newErrors.title = "Title is required";
    } else if (formData.title.length > 200) {
      newErrors.title = "Title must be less than 200 characters";
    }

    if (formData.description && formData.description.length > 2000) {
      newErrors.description = "Description must be less than 2000 characters";
    }

    if (formData.age_min) {
      const minAge = parseInt(formData.age_min);
      if (isNaN(minAge) || minAge < 14 || minAge > 60) {
        newErrors.age_min = "Minimum age must be between 14 and 60";
      }
    }

    if (formData.age_max) {
      const maxAge = parseInt(formData.age_max);
      if (isNaN(maxAge) || maxAge < 14 || maxAge > 60) {
        newErrors.age_max = "Maximum age must be between 14 and 60";
      }
    }

    if (formData.age_min && formData.age_max) {
      const minAge = parseInt(formData.age_min);
      const maxAge = parseInt(formData.age_max);
      if (!isNaN(minAge) && !isNaN(maxAge) && minAge > maxAge) {
        newErrors.age_max = "Maximum age must be greater than minimum age";
      }
    }

    if (formData.radius) {
      const radius = parseInt(formData.radius);
      if (isNaN(radius) || radius < 0 || radius > 500) {
        newErrors.radius = "Radius must be between 0 and 500 miles";
      }
    }

    if (formData.tryout_date) {
      const tryoutDate = new Date(formData.tryout_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (tryoutDate < today) {
        newErrors.tryout_date = "Tryout date must be in the future";
      }
    }

    if (formData.position && !POSITIONS.includes(formData.position as typeof POSITIONS[number])) {
      newErrors.position = "Invalid position selected";
    }

    if (
      formData.playing_level &&
      !PLAYING_LEVELS.includes(formData.playing_level as typeof PLAYING_LEVELS[number])
    ) {
      newErrors.playing_level = "Invalid playing level";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSaveDraft = async () => {
    if (!validate(false)) return;
    await submitForm("draft");
  };

  const handlePublish = async () => {
    if (!validate(true)) return;
    if (!formData.title.trim()) {
      setErrors((prev) => ({ ...prev, title: "Title is required to publish" }));
      return;
    }
    await submitForm("active");
  };

  const submitForm = async (status: string) => {
    if (!session?.user.id || !opportunityId) return;

    setLoading(true);
    setError(null);

    try {
      const payload = {
        ...formData,
        age_min: formData.age_min ? parseInt(formData.age_min) : null,
        age_max: formData.age_max ? parseInt(formData.age_max) : null,
        radius: formData.radius ? parseInt(formData.radius) : null,
        tryout_date: formData.tryout_date || null,
        status,
      };

      const res = await fetch(`/api/team/opportunities/${opportunityId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let errorMessage = "Failed to update opportunity";
        try {
          const errorData = await res.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // keep default
        }
        throw new Error(errorMessage);
      }

      router.push(`/team/opportunities/${opportunityId}`);
      router.refresh();
    } catch (err) {
      console.error("Failed to update opportunity:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading" || fetching) {
    return (
      <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                opportunityId
                  ? router.push(`/team/opportunities/${opportunityId}`)
                  : router.push("/team/opportunities")
              }
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </div>
          <h1 className="mb-2 text-3xl font-bold">Edit Opportunity</h1>
          <p className="text-lg text-muted-foreground">
            Update your player opportunity
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-8">
          {/* Section 1: Opportunity */}
          <Card>
            <CardHeader>
              <CardTitle>Opportunity</CardTitle>
              <CardDescription>
                What position are you looking for?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="title">
                  Title <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="title"
                  placeholder="e.g., Starting Striker Needed"
                  value={formData.title}
                  onChange={(e) => updateField("title", e.target.value)}
                />
                {errors.title && (
                  <p className="text-sm text-destructive">{errors.title}</p>
                )}
              </div>

              {/* Position */}
              <div className="space-y-2">
                <Label htmlFor="position">Primary Position</Label>
                <Select
                  value={formData.position}
                  onValueChange={(value) => updateField("position", value)}
                >
                  <SelectTrigger id="position">
                    <SelectValue placeholder="Select primary position" />
                  </SelectTrigger>
                  <SelectContent>
                    {POSITIONS.map((pos) => (
                      <SelectItem key={pos} value={pos}>
                        {pos} - {POSITION_LABELS[pos]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.position && (
                  <p className="text-sm text-destructive">{errors.position}</p>
                )}
              </div>

              {/* Secondary Positions */}
              <div className="space-y-2">
                <Label>Secondary Positions</Label>
                <Select
                  value=""
                  onValueChange={(value) => {
                    if (value) addSecondaryPosition(value);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Add secondary position" />
                  </SelectTrigger>
                  <SelectContent>
                    {POSITIONS.filter(
                      (p) =>
                        p !== formData.position &&
                        !formData.secondary_positions.includes(p),
                    ).map((pos) => (
                      <SelectItem key={pos} value={pos}>
                        {pos} - {POSITION_LABELS[pos]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formData.secondary_positions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {formData.secondary_positions.map((pos) => (
                      <span
                        key={pos}
                        className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-medium"
                      >
                        {pos}
                        <button
                          type="button"
                          onClick={() => removeSecondaryPosition(pos)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Role */}
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  value={formData.role}
                  onValueChange={(value) => updateField("role", value)}
                >
                  <SelectTrigger id="role">
                    <SelectValue placeholder="Select role (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Formation */}
              <div className="space-y-2">
                <Label htmlFor="formation">Formation</Label>
                <Select
                  value={formData.formation}
                  onValueChange={(value) => updateField("formation", value)}
                >
                  <SelectTrigger id="formation">
                    <SelectValue placeholder="Select formation (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {FORMATION_OPTIONS.map((formation) => (
                      <SelectItem key={formation} value={formation}>
                        {formation}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Describe the opportunity, what you're looking for in a player, and any other relevant details..."
                  rows={4}
                  value={formData.description}
                  onChange={(e) => updateField("description", e.target.value)}
                />
                {errors.description && (
                  <p className="text-sm text-destructive">
                    {errors.description}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Section 2: Player Requirements */}
          <Card>
            <CardHeader>
              <CardTitle>Player Requirements</CardTitle>
              <CardDescription>
                What are you looking for in a player?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 sm:grid-cols-2">
                {/* Min Age */}
                <div className="space-y-2">
                  <Label htmlFor="age_min">Minimum Age</Label>
                  <Input
                    id="age_min"
                    type="number"
                    min={14}
                    max={60}
                    placeholder="e.g., 18"
                    value={formData.age_min}
                    onChange={(e) => updateField("age_min", e.target.value)}
                  />
                  {errors.age_min && (
                    <p className="text-sm text-destructive">
                      {errors.age_min}
                    </p>
                  )}
                </div>

                {/* Max Age */}
                <div className="space-y-2">
                  <Label htmlFor="age_max">Maximum Age</Label>
                  <Input
                    id="age_max"
                    type="number"
                    min={14}
                    max={60}
                    placeholder="e.g., 35"
                    value={formData.age_max}
                    onChange={(e) => updateField("age_max", e.target.value)}
                  />
                  {errors.age_max && (
                    <p className="text-sm text-destructive">
                      {errors.age_max}
                    </p>
                  )}
                </div>
              </div>

              {/* Playing Level */}
              <div className="space-y-2">
                <Label htmlFor="playing_level">Playing Level</Label>
                <Select
                  value={formData.playing_level}
                  onValueChange={(value) => updateField("playing_level", value)}
                >
                  <SelectTrigger id="playing_level">
                    <SelectValue placeholder="Select required level (optional)" />
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

              {/* League */}
              <div className="space-y-2">
                <Label htmlFor="league">League</Label>
                <Input
                  id="league"
                  placeholder="e.g., UPSL, NPSL (optional)"
                  value={formData.league}
                  onChange={(e) => updateField("league", e.target.value)}
                />
              </div>

              {/* Preferred Foot */}
              <div className="space-y-2">
                <Label htmlFor="preferred_foot">Preferred Foot</Label>
                <Select
                  value={formData.preferred_foot}
                  onValueChange={(value) => updateField("preferred_foot", value)}
                >
                  <SelectTrigger id="preferred_foot">
                    <SelectValue placeholder="Select preference (optional)" />
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

          {/* Section 3: Location */}
          <Card>
            <CardHeader>
              <CardTitle>Location</CardTitle>
              <CardDescription>
                Where is the opportunity based?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Location */}
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  placeholder="City, State (e.g., Phoenix, AZ)"
                  value={formData.location}
                  onChange={(e) => updateField("location", e.target.value)}
                />
              </div>

              {/* Radius */}
              <div className="space-y-2">
                <Label htmlFor="radius">Travel Radius (miles)</Label>
                <Input
                  id="radius"
                  type="number"
                  min={0}
                  max={500}
                  placeholder="e.g., 50"
                  value={formData.radius}
                  onChange={(e) => updateField("radius", e.target.value)}
                />
                {errors.radius && (
                  <p className="text-sm text-destructive">{errors.radius}</p>
                )}
              </div>

              {/* Travel Requirements */}
              <div className="space-y-2">
                <Label htmlFor="travel_requirements">Travel Requirements</Label>
                <Select
                  value={formData.travel_requirements}
                  onValueChange={(value) =>
                    updateField("travel_requirements", value)
                  }
                >
                  <SelectTrigger id="travel_requirements">
                    <SelectValue placeholder="Select travel requirements (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {TRAVEL_REQUIREMENTS_OPTIONS.map((req) => (
                      <SelectItem key={req} value={req}>
                        {req}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Section 4: Availability */}
          <Card>
            <CardHeader>
              <CardTitle>Availability</CardTitle>
              <CardDescription>
                When do you need the player?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Availability */}
              <div className="space-y-2">
                <Label htmlFor="availability">Availability Needed</Label>
                <Select
                  value={formData.availability}
                  onValueChange={(value) => updateField("availability", value)}
                >
                  <SelectTrigger id="availability">
                    <SelectValue placeholder="Select when needed (optional)" />
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

              {/* Tryout Date */}
              <div className="space-y-2">
                <Label htmlFor="tryout_date">Tryout Date</Label>
                <Input
                  id="tryout_date"
                  type="date"
                  value={formData.tryout_date}
                  onChange={(e) => updateField("tryout_date", e.target.value)}
                />
                {errors.tryout_date && (
                  <p className="text-sm text-destructive">
                    {errors.tryout_date}
                  </p>
                )}
              </div>

              {/* Contract Length */}
              <div className="space-y-2">
                <Label htmlFor="contract_length">Contract Length</Label>
                <Select
                  value={formData.contract_length}
                  onValueChange={(value) =>
                    updateField("contract_length", value)
                  }
                >
                  <SelectTrigger id="contract_length">
                    <SelectValue placeholder="Select contract length (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTRACT_LENGTH_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Section 5: Compensation & Logistics */}
          <Card>
            <CardHeader>
              <CardTitle>Compensation & Logistics</CardTitle>
              <CardDescription>
                What do you offer and what are the requirements?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Compensation */}
              <div className="space-y-2">
                <Label htmlFor="compensation">Compensation</Label>
                <Select
                  value={formData.compensation}
                  onValueChange={(value) => updateField("compensation", value)}
                >
                  <SelectTrigger id="compensation">
                    <SelectValue placeholder="Select compensation (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPENSATION_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Housing */}
              <div className="space-y-2">
                <Label htmlFor="housing">Housing</Label>
                <Select
                  value={formData.housing}
                  onValueChange={(value) => updateField("housing", value)}
                >
                  <SelectTrigger id="housing">
                    <SelectValue placeholder="Select housing (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {HOUSING_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Visa Requirements */}
              <div className="space-y-2">
                <Label htmlFor="visa_requirements">Visa Requirements</Label>
                <Select
                  value={formData.visa_requirements}
                  onValueChange={(value) =>
                    updateField("visa_requirements", value)
                  }
                >
                  <SelectTrigger id="visa_requirements">
                    <SelectValue placeholder="Select visa requirements (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {VISA_REQUIREMENTS_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Action Buttons */}
        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            onClick={() =>
              opportunityId
                ? router.push(`/team/opportunities/${opportunityId}`)
                : router.push("/team/opportunities")
            }
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          <div className="flex flex-col gap-3 sm:flex-row">
            {currentStatus !== "closed" && (
              <Button
                variant="outline"
                onClick={handleSaveDraft}
                disabled={loading}
              >
                <Save className="mr-2 h-4 w-4" />
                {loading ? "Saving..." : "Save as Draft"}
              </Button>
            )}
            {currentStatus !== "closed" && (
              <Button onClick={handlePublish} disabled={loading}>
                <Send className="mr-2 h-4 w-4" />
                {loading
                  ? "Saving..."
                  : currentStatus === "draft"
                    ? "Publish Opportunity"
                    : "Save Changes"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}