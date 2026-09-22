"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { ArrowLeft, Save, Target, Loader2 } from "lucide-react";
import type { CompetitionEvent } from "@/types";

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
 * Convert a stored TIMESTAMPTZ string into the value format expected by an
 * <input type="datetime-local"> (local time, no timezone suffix / seconds).
 */
function toDateTimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toFormData(event: CompetitionEvent): FormData {
  return {
    name: event.name,
    description: event.description ?? "",
    location: event.location ?? "",
    event_date: toDateTimeLocal(event.event_date),
    challenge_name: event.challenge_name,
    challenge_threshold: String(event.challenge_threshold),
    max_attempts: String(event.max_attempts),
  };
}

export function EditCompetitionForm({ event }: { event: CompetitionEvent }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(toFormData(event));
  const [errors, setErrors] = useState<FormErrors>({});

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
    if (!validate()) return;

    setLoading(true);
    setError(null);

    try {
      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        location: formData.location.trim() || null,
        event_date: formData.event_date
          ? new Date(formData.event_date).toISOString()
          : null,
        challenge_name: formData.challenge_name.trim(),
        challenge_threshold: parseInt(formData.challenge_threshold, 10),
        max_attempts: parseInt(formData.max_attempts, 10),
      };

      const res = await fetch(`/api/competitions/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let errorMessage = "Failed to update competition";
        try {
          const errorData = await res.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // keep default
        }
        throw new Error(errorMessage);
      }

      router.push(`/competitions/${event.id}`);
      router.refresh();
    } catch (err) {
      console.error("Failed to update competition:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <div className="mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/competitions/${event.id}`)}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Event
            </Button>
          </div>
          <h1 className="mb-2 text-3xl font-bold">Edit Competition</h1>
          <p className="text-lg text-muted-foreground">{event.name}</p>
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
            onClick={() => router.push(`/competitions/${event.id}`)}
            disabled={loading}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {loading ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}