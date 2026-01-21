export function buildResultSummary(params: {
  battingTeamName?: string;
  bowlingTeamName?: string;
  runs: number;
  wickets: number;
  target?: number | null;
  playersPerSide?: number | null;
}) {
  if (params.target) {
    if (params.runs >= params.target) {
      const wicketsLimit = params.playersPerSide && params.playersPerSide > 1
        ? params.playersPerSide - 1
        : 10;
      const wicketsLeft = Math.max(wicketsLimit - params.wickets, 0);
      return `${params.battingTeamName || "Team"} won by ${wicketsLeft} wickets`;
    }
    if (params.runs === params.target - 1) {
      return "Match Tied";
    }
    const marginRuns = Math.max((params.target - 1) - params.runs, 0);
    return `${params.bowlingTeamName || "Team"} won by ${marginRuns} runs`;
  }
  return "Match completed";
}
