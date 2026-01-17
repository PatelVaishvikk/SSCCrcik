import type { MatchConfig, MatchSnapshot, ScoreEvent } from "@/lib/scoring/v2/types";
import { applyEvent, buildInitialSnapshot } from "@/lib/scoring/v2/engine";

export function rebuildSnapshot(params: {
  matchId: string;
  inningsNo: number;
  events: ScoreEvent[];
  config: MatchConfig;
  previousInnings?: MatchSnapshot["previousInnings"];
  target?: number | null;
}) {
  const { events, config } = params;
  const overrides = new Map<number, ScoreEvent>();
  const voided = new Set<number>();

  events.forEach((event) => {
    if (event.type === "UNDO" && event.targetSeq) {
      voided.add(event.targetSeq);
    }
    if (event.type === "EDIT" && event.targetSeq) {
      overrides.set(event.targetSeq, event);
    }
  });

  const startEvent = events.find((event) => event.type === "INNINGS_START");
  if (!startEvent) {
    throw new Error("Missing innings start event.");
  }

  let snapshot = buildInitialSnapshot({
    matchId: params.matchId,
    inningsNo: params.inningsNo,
    strikerId: startEvent.payload.strikerId || "",
    nonStrikerId: startEvent.payload.nonStrikerId || "",
    bowlerId: startEvent.payload.bowlerId || "",
    battingTeamId: startEvent.payload.battingTeamId || "",
    bowlingTeamId: startEvent.payload.bowlingTeamId || "",
    oversConfig: config.overs,
    settings: config.settings,
    previousInnings: params.previousInnings ?? null,
    target: params.target ?? null,
  });

  for (const event of events) {
    if (event.type === "INNINGS_START" || event.type === "UNDO" || event.type === "EDIT") {
      continue;
    }
    if (voided.has(event.seq)) continue;
    const override = overrides.get(event.seq);
    const applied = override ? { ...event, payload: override.payload } : event;
    snapshot = applyEvent({ snapshot, event: applied, config });
  }

  return snapshot;
}
