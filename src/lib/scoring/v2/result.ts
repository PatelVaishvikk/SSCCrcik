export function buildResultSummary(params: {
  battingTeamName?: string;
  bowlingTeamName?: string;
  runs: number;
  wickets: number;
  target?: number | null;
}) {
  if (params.target) {
    if (params.runs >= params.target) {
      const wicketsLeft = Math.max(10 - params.wickets, 0);
      return `${params.battingTeamName || "Team"} won by ${wicketsLeft} wickets`;
    }
    const marginRuns = Math.max((params.target - 1) - params.runs, 0);
    return `${params.bowlingTeamName || "Team"} won by ${marginRuns} runs`;
  }
  return "Match completed";
}
