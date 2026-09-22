"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeft, Save, Target } from "lucide-react";

interface FormData {
  name: string;
  description: string;
  location: string;
  event_date: string;
  challenge_name: string;
  challenge_threshold: string;
  max_attempts: string;
}

interface FormErrors {
  [key: string]: string;
}

/**
 * UI defaults only — the challenge configuration always remains editable and
 * is stored on the event. Competition behaviour is never hard-coded globally.
 */
const defaultFormData: FormData = {
  name: "",
  description: "",
  location: "",
  event_date: "",
  challenge_name: "Juggle Challenge",
  challenge_threshold: "30",
  max_attempts: "3",
};

/**
 * COMP-002 / COMP-007 — Competition creation form (client).
 *
 * Access is gated SERVER-SIDE in the parent /competitions/new page (only the
 * configured MULTI_TEAM_ADMIN_USER_ID reaches this component), and the POST is
 * independently authorized again in POST /api/competitions. The client-side
 * session check below is a secondary guard only.
 */
export function NewCompetitionForm() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/login");
    }
  }, [session, status, router]);

  const updateField = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = "Event name is required";
    }

    if (!formData.challenge_name.trim()) {
      newErrors.challenge_name = "Challenge name is required";
    }

    const threshold = parseInt(formData.challenge_threshold, 10);
    if (!Number.isInteger(threshold) || threshold <= 0) {
      newErrors.challenge_threshold = "Threshold must be a positive number";
    }

    const attempts = parseInt(formData.max_attempts, 10);
    if (!Number.isInteger(attempts) || attempts <= 0) {
      newErrors.max_attempts = "Max attempts must be a positive number";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate() || !session?.user.id) return;

    setLoading(true);
    setError(null);

    try {
      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        location: formData.location.trim() || null,
        event_date: formData.event_date || null,
        challenge_name: formData.challenge_name.trim(),
        challenge_threshold: parseInt(formData.challenge_threshold, 10),
        max_attempts: parseInt(formData.max_attempts, 10),
      };

      const res = await fetch("/api/competitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let errorMessage = "Failed to create competition";
        try {
          const errorData = await res.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // keep default
        }
        throw new Error(errorMessage);
      }

      const data = await res.json();
      router.push(`/competitions/${data.event.id}`);
      router.refresh();
    } catch (err) {
      console.error("Failed to create competition:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
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

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <div className="mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/competitions")}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Competitions
            </Button>
          </div>
          <h1 className="mb-2 text-3xl font-bold">Create Competition</h1>
          <p className="text-lg text-muted-foreground">
            Set up the event, challenge and lifecycle
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Event Details</CardTitle>
              <CardDescription>
                Where and when is the competition taking place?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name">
                  Event Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  placeholder="e.g., Downtown Juggle Cup"
                  value={formData.name}
                  onChange={(e) => updateField("name", e.target.value)}
                />
                {errors.name && (
                  <p className="text-sm text-destructive">{errors.name}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Describe the competition, rules, and any relevant details..."
                  rows={4}
                  value={formData.description}
                  onChange={(e) => updateField("description", e.target.value)}
                />
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    placeholder="City, State"
                    value={formData.location}
                    onChange={(e) => updateField("location", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="event_date">Event Date</Label>
                  <Input
                    id="event_date"
                    type="datetime-local"
                    value={formData.event_date}
                    onChange={(e) => updateField("event_date", e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Challenge Configuration
              </CardTitle>
              <CardDescription>
                Configurable per event — nothing is hard-coded.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="challenge_name">
                  Challenge Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="challenge_name"
                  placeholder="e.g., Juggle Challenge"
                  value={formData.challenge_name}
                  onChange={(e) =>
                    updateField("challenge_name", e.target.value)
                  }
                />
                {errors.challenge_name && (
                  <p className="text-sm text-destructive">
                    {errors.challenge_name}
                  </p>
                )}
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="challenge_threshold">
                    Qualification Threshold{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="challenge_threshold"
                    type="number"
                    min={1}
                    value={formData.challenge_threshold}
                    onChange={(e) =>
                      updateField("challenge_threshold", e.target.value)
                    }
                  />
                  {errors.challenge_threshold && (
                    <p className="text-sm text-destructive">
                      {errors.challenge_threshold}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max_attempts">
                    Maximum Attempts{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="max_attempts"
                    type="number"
                    min={1}
                    value={formData.max_attempts}
                    onChange={(e) =>
                      updateField("max_attempts", e.target.value)
                    }
                  />
                  {errors.max_attempts && (
                    <p className="text-sm text-destructive">
                      {errors.max_attempts}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            onClick={() => router.push("/competitions")}
            disabled={loading}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            <Save className="mr-2 h-4 w-4" />
            {loading ? "Creating..." : "Create Competition"}
          </Button>
        </div>
      </div>
    </div>
  );
}