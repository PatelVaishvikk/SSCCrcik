import Link from "next/link";

export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link className="logo" href="/">
          Atmiya Cricket Hub
        </Link>
        <nav className="nav">
          <Link href="/tournaments">Tournaments</Link>
          <Link href="/players">Players</Link>
          <Link href="/tournaments/hub?view=leaderboards">Leaderboards</Link>
          <Link className="cta" href="/tournaments/hub?view=matches">
            Match Center
          </Link>
        </nav>
      </div>
    </header>
  );
}
