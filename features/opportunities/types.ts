export interface Opportunity {
  id: string;
  teamId: string;
  title: string;
  description: string;
  position: string;
  location: string;
  postedAt: string;
  status: "open" | "closed" | "filled";
}