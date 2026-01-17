import type { ExtraType, ScoringEventType, ScoringPayload } from "@/lib/scoring/engine";

const EXTRA_TYPES = new Set<ExtraType>(["WD", "NB", "LB", "B", "PEN"]);
const MAX_RUNS_OFF_BAT = 6;
const MAX_EXTRA_RUNS = 10;

function toInt(value: unknown, fallback = 0) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.trunc(num);
}

export function parseInningsNo(value: unknown) {
  const inningsNo = toInt(value, 0);
  if (!Number.isFinite(inningsNo) || inningsNo <= 0) return null;
  return inningsNo;
}

export function normalizePayload(input: any) {
  const errors: string[] = [];
  const payload: ScoringPayload = {};

  const runs = toInt(input?.runs ?? 0, 0);
  if (runs < 0 || runs > MAX_RUNS_OFF_BAT) {
    errors.push("runs must be between 0 and 6");
  } else {
    payload.runs = runs;
  }

  if (input?.extras !== undefined) {
    if (input.extras === null || typeof input.extras !== "object") {
      errors.push("extras must be an object when provided");
    } else {
      const extraType = String(input.extras.type || "").trim().toUpperCase() as ExtraType;
      const extraRuns = toInt(input.extras.runs ?? 0, 0);
      if (!EXTRA_TYPES.has(extraType)) {
        errors.push("extras.type must be one of WD, NB, LB, B, PEN");
      }
      if (extraRuns <= 0 || extraRuns > MAX_EXTRA_RUNS) {
        errors.push("extras.runs must be between 1 and 10");
      }
      if (EXTRA_TYPES.has(extraType) && extraRuns > 0) {
        payload.extras = { type: extraType, runs: extraRuns };
      }
    }
  }

  if (input?.dismissal !== undefined) {
    if (input.dismissal === null || typeof input.dismissal !== "object") {
      errors.push("dismissal must be an object when provided");
    } else {
      const dismissalType = String(input.dismissal.type || "").trim();
      if (!dismissalType) {
        errors.push("dismissal.type is required");
      } else {
        payload.dismissal = {
          type: dismissalType,
          playerOutId: String(input.dismissal.playerOutId || "").trim() || undefined,
          fielderId: String(input.dismissal.fielderId || "").trim() || undefined,
          crossed: Boolean(input.dismissal.crossed),
        };
      }
    }
  }

  const strikerId = String(input?.strikerId || "").trim();
  if (strikerId) payload.strikerId = strikerId;

  const nonStrikerId = String(input?.nonStrikerId || "").trim();
  if (nonStrikerId) payload.nonStrikerId = nonStrikerId;

  const bowlerId = String(input?.bowlerId || "").trim();
  if (bowlerId) payload.bowlerId = bowlerId;

  const nextBatterId = String(input?.nextBatterId || "").trim();
  if (nextBatterId) payload.nextBatterId = nextBatterId;

  return { payload, errors };
}

export function mergePayload(base: ScoringPayload, override: any) {
  const next: ScoringPayload = { ...base };

  if (Object.prototype.hasOwnProperty.call(override, "runs")) {
    next.runs = override.runs;
  }
  if (Object.prototype.hasOwnProperty.call(override, "extras")) {
    if (override.extras === null) {
      delete next.extras;
    } else {
      next.extras = { ...(next.extras || {}), ...(override.extras || {}) };
    }
  }
  if (Object.prototype.hasOwnProperty.call(override, "dismissal")) {
    if (override.dismissal === null) {
      delete next.dismissal;
    } else {
      next.dismissal = { ...(next.dismissal || {}), ...(override.dismissal || {}) };
    }
  }
  if (Object.prototype.hasOwnProperty.call(override, "strikerId")) {
    next.strikerId = override.strikerId;
  }
  if (Object.prototype.hasOwnProperty.call(override, "nonStrikerId")) {
    next.nonStrikerId = override.nonStrikerId;
  }
  if (Object.prototype.hasOwnProperty.call(override, "bowlerId")) {
    next.bowlerId = override.bowlerId;
  }
  if (Object.prototype.hasOwnProperty.call(override, "nextBatterId")) {
    next.nextBatterId = override.nextBatterId;
  }

  return next;
}

export function validateEventRules(type: ScoringEventType, payload: ScoringPayload) {
  const errors: string[] = [];

  if (type === "INNINGS_END") {
    if (payload.runs || payload.extras || payload.dismissal) {
      errors.push("innings end cannot include runs, extras, or dismissal");
    }
    return errors;
  }

  if (type === "WICKET" && !payload.dismissal) {
    errors.push("wicket events require dismissal details");
  }

  if (type === "EXTRA" && !payload.extras) {
    errors.push("extra events require extras payload");
  }

  if (type === "BALL_ADDED" && payload.extras) {
    errors.push("ball events cannot include extras; use EXTRA instead");
  }

  if (payload.extras) {
    const extraType = payload.extras.type;
    if ((extraType === "WD" || extraType === "PEN") && (payload.runs || 0) > 0) {
      errors.push("wides or penalty runs cannot include bat runs");
    }
    if ((extraType === "B" || extraType === "LB") && (payload.runs || 0) > 0) {
      errors.push("byes or leg byes cannot include bat runs");
    }
  }

  return errors;
}
