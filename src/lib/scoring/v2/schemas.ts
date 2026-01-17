import { z } from "zod";

export const extraSchema = z.object({
  type: z.enum(["WD", "NB", "LB", "B", "PEN"]),
  runs: z.number().int().min(1).max(10),
});

export const dismissalSchema = z.object({
  type: z.string().min(1),
  playerOutId: z.string().optional(),
  fielderId: z.string().optional(),
  crossed: z.boolean().optional(),
});

export const ballPayloadSchema = z.object({
  runs: z.number().int().min(0).max(6).optional(),
  extras: extraSchema.optional(),
  dismissal: dismissalSchema.optional(),
  strikerId: z.string().optional(),
  nonStrikerId: z.string().optional(),
  bowlerId: z.string().optional(),
});

const clientSyncSchema = z.object({
  clientId: z.string().min(4).optional(),
  clientSeq: z.number().int().min(1).optional(),
  expectedVersion: z.number().int().min(0).optional(),
});

export const ballEventSchema = z.object({
  inningsNo: z.number().int().positive(),
  type: z.enum(["BALL_ADDED", "EXTRA", "WICKET"]),
  idempotencyKey: z.string().min(6),
  payload: ballPayloadSchema,
}).merge(clientSyncSchema);

export const inningsStartSchema = z.object({
  inningsNo: z.number().int().positive(),
  idempotencyKey: z.string().min(6),
  strikerId: z.string().min(1),
  nonStrikerId: z.string().min(1),
  bowlerId: z.string().min(1),
  battingTeamId: z.string().min(1),
  bowlingTeamId: z.string().min(1),
}).merge(clientSyncSchema);

export const bowlerSelectSchema = z.object({
  inningsNo: z.number().int().positive(),
  idempotencyKey: z.string().min(6),
  bowlerId: z.string().min(1),
}).merge(clientSyncSchema);

export const batsmanSelectSchema = z.object({
  inningsNo: z.number().int().positive(),
  idempotencyKey: z.string().min(6),
  batsmanId: z.string().min(1),
  slot: z.enum(["striker", "nonStriker"]).optional(),
}).merge(clientSyncSchema);

export const inningsEndSchema = z.object({
  inningsNo: z.number().int().positive(),
  idempotencyKey: z.string().min(6),
  reason: z.string().optional(),
}).merge(clientSyncSchema);

export const matchEndSchema = z.object({
  idempotencyKey: z.string().min(6),
  reason: z.string().optional(),
}).merge(clientSyncSchema);

export const undoSchema = z.object({
  inningsNo: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(6),
  targetSeq: z.number().int().positive().optional(),
}).merge(clientSyncSchema);

export const editSchema = z.object({
  inningsNo: z.number().int().positive(),
  idempotencyKey: z.string().min(6),
  targetSeq: z.number().int().positive(),
  payload: ballPayloadSchema,
}).merge(clientSyncSchema);

export const lockSchema = z.object({
  idempotencyKey: z.string().min(6),
  unlock: z.boolean().optional(),
}).merge(clientSyncSchema);
