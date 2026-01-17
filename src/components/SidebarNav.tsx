import Link from "next/link";

const mainLinks = [
  { href: "/", label: "Home", key: "home" },
  { href: "/live", label: "Live Center", key: "live" },
  { href: "/tournaments", label: "Seasons", key: "seasons" },
  { href: "/tournaments/hub?view=leaderboards", label: "Leaderboards", key: "leaderboards" },
  { href: "/tournaments/hub?view=matches", label: "Match Center", key: "match-center" },
  { href: "/players", label: "Players", key: "players" },
];

const adminLinks = [
  { href: "/admin", label: "Admin Center", key: "admin-center" },
  { href: "/admin/tournaments", label: "Tournament Builder", key: "admin-tournaments" },
  { href: "/admin/teams", label: "Team Builder", key: "admin-teams" },
  { href: "/admin/matches", label: "Match Control", key: "admin-matches" },
  { href: "/admin/players", label: "Player Assignment", key: "admin-players" },
  { href: "/admin/scoring", label: "Smart Scoring", key: "admin-scoring" },
  { href: "/admin/scoring-v2", label: "Scoring Console v2", key: "admin-scoring-v2" },
];

export default function SidebarNav({ isAdmin = false }: { isAdmin?: boolean }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        {/* <span className="badge">SSC</span>
        <strong>Suhrad Sports Club</strong>
        <span className="text-muted">Cricket command center</span> */}
        <img
          src="/suhrad-logo.png"
          alt="Suhrad Sports Club"
          style={{ maxWidth: "100%", height: "auto" }}
        />
      </div>
      <nav className="sidebar-nav">
        <div className="nav-group">
          <span className="nav-title">Explore</span>
          {mainLinks.map((link) => (
            <Link key={link.key} href={link.href} className="nav-link">
              {link.label}
            </Link>
          ))}
        </div>
        <div className="nav-group">
          <span className="nav-title">Admin</span>
          {isAdmin ? (
            adminLinks.map((link) => (
              <Link key={link.key} href={link.href} className="nav-link">
                {link.label}
              </Link>
            ))
          ) : (
            <Link href="/admin/login" className="nav-link">
              Admin login
            </Link>
          )}
        </div>
      </nav>
    </aside>
  );
}
