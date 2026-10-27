import {
  applyFrozen,
  buildPeriod,
  compareKpis,
  emptyManual,
  type BookedComp,
  type ManualReview,
  type PeriodFacts,
} from "@/lib/sif/engine.ts";
import { shiftPeriod } from "@/lib/sif/money.ts";
import type { Sql } from "@/lib/db";
import { readSettings } from "./context.server.ts";

function num(value: unknown): number {
  return Number(value ?? 0);
}

function dateOf(value: unknown): string | null {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function manualOf(value: unknown): ManualReview {
  const v = (value ?? {}) as Partial<ManualReview>;
  return {
    ventas: Boolean(v.ventas),
    cobros: Boolean(v.cobros),
    gastos: Boolean(v.gastos),
    caja: Boolean(v.caja),
  };
}

export async function loadFacts(sql: Sql, period: string): Promise<PeriodFacts> {
  const settings = await readSettings(sql);
  const names = new Map(
    (await sql<{ user_id: string; name: string }>`select user_id, name from profiles`).map((r) => [
      r.user_id,
      r.name || "Sin nombre",
    ]),
  );
  const name = (id: string | null) => (id ? names.get(id) || "Integrante" : "");
  const sales = await sql<Record<string, unknown>>`select * from sales`;
  const payments = await sql<Record<string, unknown>>`select * from sale_payments`;
  const refunds = await sql<Record<string, unknown>>`select * from refunds`;
  const expenses = await sql<Record<string, unknown>>`select * from expenses`;
  const campaigns = await sql<Record<string, unknown>>`select * from campaigns`;
  const milestones = await sql<Record<string, unknown>>`
    select m.*, p.name as project_name, p.kind as project_kind, p.funding_approved
    from milestones m join projects p on p.id = m.project_id
  `;
  const objectives = await sql<Record<string, unknown>>`select * from performance_objectives`;
  const agreements = await sql<Record<string, unknown>>`
    select * from compensation_agreements where active = true
  `;
  const obligations = await sql<Record<string, unknown>>`select * from obligations`;
  const movements = await sql<Record<string, unknown>>`select * from cash_movements`;
  const allocations = await sql<Record<string, unknown>>`select * from allocations`;
  const booked = await sql<Record<string, unknown>>`select * from compensation_records`;
  const closing = await sql<Record<string, unknown>>`select * from monthly_closings where period = ${period}`;
  const c = closing[0];
  return {
    period,
    settings: {
      reinversionBps: settings.reinversionBps,
      reservaBps: settings.reservaBps,
      fondoBps: settings.fondoBps,
      formacionBps: settings.formacionBps,
      cashInitialized: settings.cashInitialized,
      openingCashCents: settings.openingCashCents,
    },
    sales: sales.map((s) => ({
      id: String(s.id),
      code: String(s.code),
      clientName: String(s.client_name),
      productName: String(s.product_name),
      totalCents: num(s.total_cents),
      status: s.sale_status as PeriodFacts["sales"][number]["status"],
      closedOn: dateOf(s.closed_on),
      directCostActualCents: s.direct_cost_actual_cents == null ? null : num(s.direct_cost_actual_cents),
      directCostEstimatedCents: num(s.direct_cost_estimated_cents),
      commissionRateBps: s.commission_rate_bps == null ? null : num(s.commission_rate_bps),
      commissionLocked: Boolean(s.commission_locked),
      commissionBase: s.commission_base === "facturado" ? "facturado" : "cobrado",
      commissionRuleName: String(s.commission_rule_name || "Política"),
      closerUserId: s.closer_user_id ? String(s.closer_user_id) : null,
      closerName: name(s.closer_user_id ? String(s.closer_user_id) : null),
      originatorUserId: s.originator_user_id ? String(s.originator_user_id) : null,
      originatorName: name(s.originator_user_id ? String(s.originator_user_id) : null),
      campaignId: s.campaign_id ? String(s.campaign_id) : null,
      attributionCriterion: String(s.attribution_criterion ?? ""),
    })),
    payments: payments.map((p) => ({
      id: String(p.id),
      saleId: String(p.sale_id),
      paidOn: dateOf(p.paid_on) || "",
      amountCents: num(p.amount_cents),
    })),
    refunds: refunds.map((r) => ({
      id: String(r.id),
      saleId: String(r.sale_id),
      refundedOn: dateOf(r.refunded_on) || "",
      amountCents: num(r.amount_cents),
    })),
    expenses: expenses.map((e) => ({
      id: String(e.id),
      spentOn: dateOf(e.spent_on) || "",
      category: String(e.category),
      amountCents: num(e.amount_cents),
      isEstimate: Boolean(e.is_estimate),
      status: String(e.status),
      campaignId: e.campaign_id ? String(e.campaign_id) : null,
      description: String(e.description),
      receipt: String(e.receipt ?? ""),
    })),
    campaigns: campaigns.map((c) => ({
      id: String(c.id),
      name: String(c.name),
      budgetCents: num(c.budget_cents),
      actualSpendCents: num(c.actual_spend_cents),
      qualifiedContacts: num(c.qualified_contacts),
      contacts: num(c.contacts),
      meetings: num(c.meetings),
      startsOn: dateOf(c.starts_on) || "",
      endsOn: dateOf(c.ends_on),
    })),
    milestones: milestones.map((m) => ({
      id: String(m.id),
      projectId: String(m.project_id),
      projectName: String(m.project_name),
      title: String(m.title),
      amountCents: num(m.amount_cents),
      assigneeUserId: m.assignee_user_id ? String(m.assignee_user_id) : null,
      assigneeName: name(m.assignee_user_id ? String(m.assignee_user_id) : null),
      status: String(m.status),
      acceptedOn: dateOf(m.accepted_on),
      fundingApproved: Boolean(m.funding_approved),
      projectKind: String(m.project_kind),
    })),
    objectives: objectives.map((o) => ({
      id: String(o.id),
      userId: String(o.user_id),
      userName: name(String(o.user_id)),
      period: String(o.period),
      title: String(o.title),
      incentiveCents: num(o.incentive_cents),
      agreed: Boolean(o.agreed),
      met: o.met == null ? null : Boolean(o.met),
    })),
    agreements: agreements.map((a) => ({
      id: String(a.id),
      userId: String(a.user_id),
      userName: name(String(a.user_id)),
      kind: String(a.kind),
      title: String(a.title),
      fixedCents: num(a.fixed_cents),
      accrue: Boolean(a.accrue),
      effectiveFrom: dateOf(a.effective_from) || "",
      effectiveTo: dateOf(a.effective_to),
    })),
    obligations: obligations.map((o) => ({
      id: String(o.id),
      amountCents: num(o.amount_cents),
      status: String(o.status),
      description: String(o.description),
      dueOn: dateOf(o.due_on),
    })),
    movements: movements.map((m) => ({
      direction: m.direction === "salida" ? "salida" : "entrada",
      amountCents: num(m.amount_cents),
      movedOn: dateOf(m.moved_on) || "",
      category: String(m.category),
    })),
    allocations: allocations.map((a) => ({
      bucket: String(a.bucket),
      amountCents: num(a.amount_cents),
      status: String(a.status),
      period: String(a.period),
    })),
    booked: booked.map((b) => mapBooked(b, name)),
    manual: c ? manualOf(c.manual) : emptyManual(),
    materialized: Boolean(c?.calculated_at),
    proposalReady: c?.proposal != null,
    warningsAcknowledged: Boolean(c?.warnings_ack),
  };
}

export function mapBooked(b: Record<string, unknown>, name: (id: string | null) => string): BookedComp {
  return {
    id: String(b.id),
    userId: String(b.user_id),
    userName: name(String(b.user_id)),
    period: String(b.period),
    kind: String(b.kind),
    sourceType: String(b.source_type),
    sourceId: String(b.source_id),
    formula: String(b.formula),
    calculatedCents: num(b.calculated_cents),
    approvedCents: b.approved_cents == null ? null : num(b.approved_cents),
    paidCents: num(b.paid_cents),
    status: String(b.status),
    reinvested: Boolean(b.reinvested),
  };
}

async function periodView(sql: Sql, period: string) {
  const facts = await loadFacts(sql, period);
  const built = buildPeriod(facts);
  const rows = await sql<{ status: string; snapshot: unknown }>`
    select status, snapshot from monthly_closings where period = ${period}
  `;
  const row = rows[0];
  return applyFrozen(built, row?.status === "cerrado" ? row.snapshot : null);
}

export async function reportPeriod(sql: Sql, period: string) {
  const current = await periodView(sql, period);
  const previous = await periodView(sql, shiftPeriod(period, -1));
  return {
    ...current,
    kpis: compareKpis(current.kpis, previous.kpis),
    closingStatus: await closingStatus(sql, period),
  };
}

export async function closingStatus(sql: Sql, period: string) {
  const rows = await sql<{ status: string; closed_at: string | null; ceo_decision: string }>`
    select status, closed_at::text as closed_at, ceo_decision from monthly_closings where period = ${period}
  `;
  return rows[0] ?? { status: "abierto", closed_at: null, ceo_decision: "" };
}

export async function ensureClosing(sql: Sql, period: string) {
  const id = `close-${period}`;
  await sql`
    insert into monthly_closings (id, period) values (${id}, ${period})
    on conflict (period) do nothing
  `;
  const rows = await sql<Record<string, unknown>>`select * from monthly_closings where period = ${period}`;
  return rows[0];
}
