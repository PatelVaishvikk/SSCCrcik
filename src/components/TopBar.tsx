import Link from "next/link";
import GlobalSearch from "@/components/GlobalSearch";

type RecentMatch = {
  year: number;
  match: Record<string, any>;
};

function shortTeam(name?: string) {
  if (!name) return "TBD";
  const parts = name.split(" ").filter(Boolean);
  if (!parts.length) return name;
  const initials = parts.map((part) => part[0]).join("");
  return initials.slice(0, 4).toUpperCase();
}

export default function TopBar({
  recentMatches,
  isAdmin = false,
}: {
  recentMatches: RecentMatch[];
  isAdmin?: boolean;
}) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        <Link href="/" className="mobile-logo">
          <img src="/suhrad-logo.png" alt="SSC" height={32} style={{ height: "32px", width: "auto" }} />
        </Link>
        <div className="score-strip">
          {recentMatches.length ? (
            recentMatches.map((item) => {
              const match = item.match;
              const matchId = match.match_id;
              const tournamentId = match.tournament_id;
              const link = matchId && tournamentId ? `/match/${tournamentId}/${matchId}` : "/";
              return (
                <Link
                  key={`${matchId}-${tournamentId}`}
                  href={link}
                  className="score-chip"
                  prefetch={false}
                >
                  <div className="chip-title">
                    {shortTeam(match.team_a)} vs {shortTeam(match.team_b)}
                  </div>
                  <div className="chip-meta">
                    {match.team_a_summary || "-"} • {match.team_b_summary || "-"}
                  </div>
                </Link>
              );
            })
          ) : (
            <span className="text-muted">Score strip loading...</span>
          )}
        </div>
      </div>
      <div className="topbar-right">
        <GlobalSearch isAdmin={isAdmin} />
        <Link className="pill" href={isAdmin ? "/admin" : "/admin/login"}>
          {isAdmin ? "Admin" : "Admin Login"}
        </Link>
      </div>
    </div>
  );
}
