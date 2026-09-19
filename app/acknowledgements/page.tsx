import Link from "next/link";
import { ArrowLeft, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Acknowledgements | Football Opportunity Marketplace",
  description: "Photo credits and acknowledgements for Football Opportunity Marketplace",
};

export default function AcknowledgementsPage() {
  return (
    <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
            <Camera className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Acknowledgements</CardTitle>
          <CardDescription className="text-base">
            Thank you to the photographers who made this site possible
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border bg-muted/50 p-4">
            <h2 className="mb-2 font-semibold">Photos</h2>
            <p className="text-sm text-muted-foreground">
              Photo by{" "}
              <a
                href="https://unsplash.com/@concoyne?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Connor Coyne
              </a>{" "}
              on{" "}
              <a
                href="https://unsplash.com/photos/white-and-blue-soccer-ball-on-green-grass-field-OgqWLzWRSaI?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Unsplash
              </a>
            </p>
          </div>

          <div className="flex justify-center">
            <Button asChild variant="outline">
              <Link href="/">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Home
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}