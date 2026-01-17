import Link from "next/link";

const STAT_MAP = {
  batting: { label: "Runs", key: "total_runs" },
  bowling: { label: "Wkts", key: "total_wickets" },
  fielding: { label: "Dismissals", key: "total_dismissal" },
  mvp: { label: "Points", key: "total" },
};

function resolveStat(entry: Record<string, unknown>, type: keyof typeof STAT_MAP) {
  const { label, key } = STAT_MAP[type];
  let value = entry[key] as number | string | undefined;
  if (value === undefined) {
    if (type === "bowling") value = entry.wickets as number | string | undefined;
    if (type === "fielding") value = entry.catches as number | string | undefined;
    if (type === "mvp") value = entry.total_points as number | string | undefined;
  }
  return { label, value: value ?? "-" };
}

export type LeaderboardCardProps = {
  title: string;
  type: "batting" | "bowling" | "fielding" | "mvp";
  entries: Array<Record<string, unknown>>;
};

export default function LeaderboardCard({ title, type, entries }: LeaderboardCardProps) {
  const topEntries = entries.slice(0, 6);
  return (
    <div className="card">
      <div className="list">
        <div className="pill">{title}</div>
        <div className="list">
          {topEntries.map((entry) => {
            const { label, value } = resolveStat(entry, type);
            const name = String(entry.name || "Unknown");
            const team = String(entry.team_name || "");
            const playerId = entry.player_id ? String(entry.player_id) : null;
            return (
              <div key={playerId ? `${playerId}-${team}` : `${name}-${team}`} className="grid two">
                <div className="list">
                  {playerId ? (
                    <Link href={`/players/${playerId}`}>{name}</Link>
                  ) : (
                    <span>{name}</span>
                  )}
                  <span className="text-muted">{team}</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{value}</span>
                  <span className="stat-label">{label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
