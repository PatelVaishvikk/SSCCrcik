import MatchLiveView from "@/components/matches/MatchLiveView";

export default async function MatchLivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MatchLiveView matchId={id} />;
}
