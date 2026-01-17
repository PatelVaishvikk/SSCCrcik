import Link from "next/link";
import styles from "@/app/admin/admin.module.css";

const steps = [
  {
    key: "tournaments",
    label: "Tournament",
    description: "Create ACT/ABCT seasons",
    href: "/admin/tournaments",
  },
  {
    key: "teams",
    label: "Teams",
    description: "Import past teams or build new squads",
    href: "/admin/teams",
  },
  {
    key: "matches",
    label: "Matches",
    description: "Schedule fixtures and overs",
    href: "/admin/matches",
  },
  {
    key: "players",
    label: "Players",
    description: "Add past or new players to match squads",
    href: "/admin/players",
  },
  {
    key: "scoring",
    label: "Scoring",
    description: "Run live smart scoring",
    href: "/admin/scoring",
  },
  {
    key: "live",
    label: "Live",
    description: "Preview scorecards after matches are created",
    href: "/live",
  },
];

export default function AdminFlow({ current }: { current?: string }) {
  return (
    <div className={styles.flowBar}>
      {steps.map((step, index) => {
        const active = current === step.key;
        return (
          <Link
            key={step.key}
            href={step.href}
            className={`${styles.flowStep} ${active ? styles.flowActive : ""}`}
          >
            <span className={styles.flowBadge}>Step {index + 1}</span>
            <span className={styles.flowLabel}>{step.label}</span>
            <span className={styles.flowMeta}>{step.description}</span>
          </Link>
        );
      })}
    </div>
  );
}
