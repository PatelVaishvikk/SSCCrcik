import MatchScorer from "@/components/matches/MatchScorer";

export default async function MatchScorePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MatchScorer matchId={id} />;
}
