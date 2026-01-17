import type { Metadata } from "next";
import { Barlow_Condensed, Manrope } from "next/font/google";
import MobileNav from "@/components/MobileNav";
import SidebarNav from "@/components/SidebarNav";
import SiteFooter from "@/components/SiteFooter";
import TopBar from "@/components/TopBar";
import BackBar from "@/components/BackBar";
import QueryProvider from "@/components/QueryProvider";
import { getRecentMatches } from "@/lib/data";
import { getAdminSession } from "@/lib/admin-session";
import "./globals.css";

const displayFont = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const bodyFont = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Suhrad Sports Club",
    template: "%s | Suhrad Sports Club",
  },
  description:
    "Cricket tournament management with scoring, analytics, player history, and admin tools.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const recentMatches = await getRecentMatches(4);
  const session = await getAdminSession();
  const isAdmin = Boolean(session);
  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${bodyFont.variable}`}>
        <div className="app-shell">
          <SidebarNav isAdmin={isAdmin} />
          <div className="app-main">
            <TopBar recentMatches={recentMatches} isAdmin={isAdmin} />
            <main className="content">
              <BackBar />
              <QueryProvider>{children}</QueryProvider>
            </main>
            <SiteFooter />
          </div>
          <MobileNav isAdmin={isAdmin} />
        </div>
      </body>
    </html>
  );
}
