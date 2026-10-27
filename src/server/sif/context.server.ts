import { getSql, type Sql } from "@/lib/db";
import { periodEditDecision } from "@/lib/sif/engine.ts";
import { isDate, periodOf } from "@/lib/sif/money.ts";
import { can, parseRoles, type Perm, type Role } from "@/lib/sif/permissions.ts";

export class SifError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SifError";
  }
}

export function nid(): string {
  return crypto.randomUUID();
}

export async function db(): Promise<Sql> {
  return getSql();
}

export type Actor = {
  userId: string;
  email: string;
  name: string;
  roles: Role[];
  active: boolean;
  hasProfile: boolean;
  needsBootstrap: boolean;
};

type ProfileRow = { user_id: string; email: string; name: string; roles: string; active: boolean };

export async function loadActor(userId: string): Promise<Actor> {
  const sql = await db();
  const users = await sql<{ id: string; name: string; email: string }>`
    select id, name, email from "user" where id = ${userId}
  `;
  const account = users[0];
  if (!account) throw new SifError("No se encontró la cuenta autenticada.");
  const profiles = await sql<ProfileRow>`
    select user_id, email, name, roles, active from profiles where user_id = ${userId}
  `;
  const counts = await sql<{ n: number }>`select count(*)::int as n from profiles`;
  const n = counts[0]?.n ?? 0;
  const row = profiles[0];
  if (!row) {
    return {
      userId,
      email: account.email,
      name: account.name,
      roles: ["pendiente"],
      active: true,
      hasProfile: false,
      needsBootstrap: n === 0,
    };
  }
  return {
    userId,
    email: row.email || account.email,
    name: row.name || account.name,
    roles: parseRoles(row.roles),
    active: row.active,
    hasProfile: true,
    needsBootstrap: false,
  };
}

export function assertMember(actor: Actor) {
  if (!actor.hasProfile) throw new SifError("Tu acceso todavía no está activo.");
  if (!actor.active) throw new SifError("Tu usuario está inactivo.");
  if (actor.roles.includes("pendiente") && actor.roles.length === 1) {
    throw new SifError("Tu rol todavía no fue asignado.");
  }
}

export function assertPerm(actor: Actor, perm: Perm) {
  assertMember(actor);
  if (!can(actor.roles, perm)) throw new SifError("No tenés permiso para esta operación.");
}

export async function audit(
  sql: Sql,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  before?: unknown,
  after?: unknown,
) {
  await sql`
    insert into audit_logs (id, actor_id, action, entity_type, entity_id, summary, before_json, after_json)
    values (
      ${nid()}, ${actorId}, ${action}, ${entityType}, ${entityId}, ${summary},
      ${before == null ? null : JSON.stringify(before)}::jsonb,
      ${after == null ? null : JSON.stringify(after)}::jsonb
    )
  `;
}

export async function guardPeriod(
  sql: Sql,
  actorId: string,
  date: string,
  reason: string,
  entityType: string,
  entityId: string,
  summary: string,
) {
  if (!isDate(date)) throw new SifError("La fecha no es válida.");
  const period = periodOf(date);
  const rows = await sql<{ status: string }>`select status from monthly_closings where period = ${period}`;
  const decision = periodEditDecision((rows[0]?.status as "cerrado" | "abierto" | null) ?? null, reason ?? "");
  if (decision === "needs_reason") {
    throw new SifError(
      "Ese período ya está cerrado. Indicá el motivo de la corrección (mínimo 8 caracteres). El informe cerrado no se reescribe.",
    );
  }
  if (decision === "allow_with_adjustment") {
    await sql`
      insert into closing_adjustments (id, period, entity_type, entity_id, reason, summary, created_by)
      values (${nid()}, ${period}, ${entityType}, ${entityId}, ${reason.trim()}, ${summary}, ${actorId})
    `;
    await audit(sql, actorId, "ajuste_post_cierre", entityType, entityId, summary, null, { reason: reason.trim(), period });
  }
}

export type Settings = {
  companyName: string;
  currency: string;
  reinversionBps: number;
  reservaBps: number;
  fondoBps: number;
  formacionBps: number;
  commissionStandardBps: number;
  commissionSuperiorBps: number;
  superiorMinMarginBps: number;
  commissionBase: "cobrado" | "facturado";
  partialPaymentRule: string;
  refundRule: string;
  independentApproval: boolean;
  cashInitialized: boolean;
  openingCashCents: number;
};

export async function readSettings(sql: Sql): Promise<Settings> {
  const rows = await sql<Record<string, unknown>>`select * from org_settings where id = 1`;
  const r = rows[0];
  if (!r) throw new SifError("Falta la configuración de la firma.");
  return {
    companyName: String(r.company_name),
    currency: String(r.currency),
    reinversionBps: Number(r.reinversion_bps),
    reservaBps: Number(r.reserva_bps),
    fondoBps: Number(r.fondo_bps),
    formacionBps: Number(r.formacion_bps),
    commissionStandardBps: Number(r.commission_standard_bps),
    commissionSuperiorBps: Number(r.commission_superior_bps),
    superiorMinMarginBps: Number(r.superior_min_margin_bps),
    commissionBase: r.commission_base === "facturado" ? "facturado" : "cobrado",
    partialPaymentRule: String(r.partial_payment_rule),
    refundRule: String(r.refund_rule),
    independentApproval: Boolean(r.independent_approval),
    cashInitialized: Boolean(r.cash_initialized),
    openingCashCents: Number(r.opening_cash_cents),
  };
}

export function isUniqueError(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  return e?.code === "23505" || /unique|duplicate|already exists/i.test(e?.message ?? "");
}

export async function otherApprovers(sql: Sql, actorId: string): Promise<number> {
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from profiles
    where active = true and user_id <> ${actorId} and roles like '%ceo%'
  `;
  return rows[0]?.n ?? 0;
}

export async function otherReviewers(sql: Sql, actorId: string): Promise<number> {
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from profiles
    where active = true and user_id <> ${actorId}
      and (roles like '%ceo%' or roles like '%cto%')
  `;
  return rows[0]?.n ?? 0;
}
