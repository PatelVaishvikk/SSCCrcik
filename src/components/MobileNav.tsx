import Link from "next/link";

const baseLinks = [
  { href: "/", label: "Home", key: "home" },
  { href: "/live", label: "Live", key: "live" },
  { href: "/tournaments", label: "Seasons", key: "seasons" },
  { href: "/players", label: "Players", key: "players" },
];

export default function MobileNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const adminLink = isAdmin
    ? { href: "/admin", label: "Admin", key: "admin" }
    : { href: "/admin/login", label: "Admin", key: "admin-login" };
  const links = [...baseLinks, adminLink];

  return (
    <nav className="mobile-nav">
      {links.map((link) => (
        <Link key={link.key} href={link.href} className="mobile-link">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
