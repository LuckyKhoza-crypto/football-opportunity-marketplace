import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function PlayersPage() {
  return (
    <div className="container mx-auto px-4 py-12">
      <h1 className="mb-8 text-3xl font-bold">Players</h1>
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>Discover Players</CardTitle>
          <CardDescription>
            Browse football players looking for team opportunities
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Player discovery will be available in a future MVP. Teams will be
            able to search for players by position, skill level, and location.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}