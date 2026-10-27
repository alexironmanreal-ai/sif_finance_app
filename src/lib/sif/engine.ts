import { applyBps, formatArs, formatBps, inPeriod } from "./money.ts";

export type SaleStatus =
  | "prospecto"
  | "negociacion"
  | "cerrada_pendiente"
  | "parcial"
  | "cobrada"
  | "cancelada"
  | "reembolsada";

export type CommissionBase = "cobrado" | "facturado";

export type SaleFact = {
  id: string;
  code: string;
  clientName: string;
  productName: string;
  totalCents: number;
  status: SaleStatus;
  closedOn: string | null;
  directCostActualCents: number | null;
  directCostEstimatedCents: number;
  commissionRateBps: number | null;
  commissionLocked: boolean;
  commissionBase: CommissionBase;
  commissionRuleName: string;
  closerUserId: string | null;
  closerName: string;
  originatorUserId: string | null;
  originatorName: string;
  campaignId: string | null;
  attributionCriterion: string;
};

export type PaymentFact = {
  id: string;
  saleId: string;
  paidOn: string;
  amountCents: number;
};

export type RefundFact = {
  id: string;
  saleId: string;
  refundedOn: string;
  amountCents: number;
};

export type ExpenseFact = {
  id: string;
  spentOn: string;
  category: string;
  amountCents: number;
  isEstimate: boolean;
  status: string;
  campaignId: string | null;
  description: string;
  receipt: string;
};

export type CampaignFact = {
  id: string;
  name: string;
  budgetCents: number;
  actualSpendCents: number;
  qualifiedContacts: number;
  contacts: number;
  meetings: number;
  startsOn: string;
  endsOn: string | null;
};

export type MilestoneFact = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  amountCents: number;
  assigneeUserId: string | null;
  assigneeName: string;
  status: string;
  acceptedOn: string | null;
  fundingApproved: boolean;
  projectKind: string;
};

export type ObjectiveFact = {
  id: string;
  userId: string;
  userName: string;
  period: string;
  title: string;
  incentiveCents: number;
  agreed: boolean;
  met: boolean | null;
};

export type AgreementFact = {
  id: string;
  userId: string;
  userName: string;
  kind: string;
  title: string;
  fixedCents: number;
  accrue: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type ObligationFact = {
  id: string;
  amountCents: number;
  status: string;
  description: string;
  dueOn: string | null;
};

export type MovementFact = {
  direction: "entrada" | "salida";
  amountCents: number;
  movedOn: string;
  category: string;
};

export type AllocationFact = {
  bucket: string;
  amountCents: number;
  status: string;
  period: string;
};

export type BookedComp = {
  id: string;
  userId: string;
  userName: string;
  period: string;
  kind: string;
  sourceType: string;
  sourceId: string;
  formula: string;
  calculatedCents: number;
  approvedCents: number | null;
  paidCents: number;
  status: string;
  reinvested: boolean;
};

export type SuggestedLine = {
  idempotencyKey: string;
  userId: string;
  userName: string;
  period: string;
  kind: "comision" | "proyecto" | "incentivo" | "ceo" | "cto";
  sourceType: string;
  sourceId: string;
  calculatedCents: number;
  formula: string;
  provenance: string;
};

export type ManualReview = {
  ventas: boolean;
  cobros: boolean;
  gastos: boolean;
  caja: boolean;
};

export type Kpi = {
  id: string;
  label: string;
  cents: number | null;
  status: "real" | "propuesto" | "insuficiente" | "sin_dato";
  note: string;
};

export type Warning = { level: "bloqueo" | "advertencia"; message: string };

export type CheckItem = {
  id: string;
  label: string;
  mandatory: boolean;
  ok: boolean;
  detail: string;
};

export type Distribution = {
  cashCents: number | null;
  accruedUnpaidCents: number;
  otherObligationsCents: number;
  deficitCents: number;
  surplusCents: number;
  appliedOn: "excedente_de_caja";
  buckets: {
    reinversion: number;
    reserva: number;
    fondoRemuneraciones: number;
    formacion: number;
  };
  policyOk: boolean;
  note: string;
};

export type PeriodFacts = {
  period: string;
  settings: {
    reinversionBps: number;
    reservaBps: number;
    fondoBps: number;
    formacionBps: number;
    cashInitialized: boolean;
    openingCashCents: number;
  };
  sales: SaleFact[];
  payments: PaymentFact[];
  refunds: RefundFact[];
  expenses: ExpenseFact[];
  campaigns: CampaignFact[];
  milestones: MilestoneFact[];
  objectives: ObjectiveFact[];
  agreements: AgreementFact[];
  obligations: ObligationFact[];
  movements: MovementFact[];
  allocations: AllocationFact[];
  booked: BookedComp[];
  manual: ManualReview;
  materialized: boolean;
  proposalReady: boolean;
  warningsAcknowledged: boolean;
};

const CLOSED = new Set<SaleStatus>(["cerrada_pendiente", "parcial", "cobrada", "reembolsada"]);

export function netCollected(saleId: string, payments: PaymentFact[], refunds: RefundFact[]): number {
  const paid = payments.filter((p) => p.saleId === saleId).reduce((s, p) => s + p.amountCents, 0);
  const back = refunds.filter((r) => r.saleId === saleId).reduce((s, r) => s + r.amountCents, 0);
  return paid - back;
}

export function commissionBeneficiaries(sale: SaleFact): string[] {
  if (!sale.closerUserId || sale.commissionRateBps == null) return [];
  return [sale.closerUserId];
}

export function effectiveRateBps(sale: SaleFact, liveRuleBps: number): number | null {
  if (sale.commissionLocked) return sale.commissionRateBps;
  return liveRuleBps;
}

export function paymentDuplicate(
  existing: Array<{ saleId: string; paidOn: string; amountCents: number; method: string; reference: string }>,
  incoming: { saleId: string; paidOn: string; amountCents: number; method: string; reference: string },
): boolean {
  return existing.some(
    (row) =>
      row.saleId === incoming.saleId &&
      row.paidOn === incoming.paidOn &&
      row.amountCents === incoming.amountCents &&
      row.method === incoming.method &&
      row.reference === incoming.reference,
  );
}

export function periodEditDecision(
  status: "abierto" | "en_revision" | "cerrado" | null,
  reason: string,
): "allow" | "needs_reason" | "allow_with_adjustment" {
  if (status !== "cerrado") return "allow";
  if (reason.trim().length < 8) return "needs_reason";
  return "allow_with_adjustment";
}

export function registerAdjustment<T extends object>(snapshot: T, reason: string, entityId: string) {
  return {
    snapshot,
    adjustment: {
      reason: reason.trim(),
      entityId,
      snapshotUntouched: true,
    },
  };
}

export function remunerationStillExists(record: {
  calculatedCents: number;
  status: string;
  reinvested: boolean;
}): boolean {
  return record.calculatedCents > 0 && record.status !== "rechazado";
}

export function reinvestEffect(record: BookedComp): {
  exists: boolean;
  pendingPayoutCents: number;
  designatedReinvestmentCents: number;
} {
  const exists = remunerationStillExists(record);
  if (!exists) return { exists: false, pendingPayoutCents: 0, designatedReinvestmentCents: 0 };
  if (record.reinvested) {
    return { exists: true, pendingPayoutCents: 0, designatedReinvestmentCents: record.approvedCents ?? record.calculatedCents };
  }
  const approved = record.approvedCents ?? 0;
  return { exists: true, pendingPayoutCents: Math.max(0, approved - record.paidCents), designatedReinvestmentCents: 0 };
}

function line(partial: SuggestedLine): SuggestedLine {
  return partial;
}

export function suggestCommissions(
  sales: SaleFact[],
  payments: PaymentFact[],
  refunds: RefundFact[],
  period: string,
): SuggestedLine[] {
  const byId = new Map(sales.map((s) => [s.id, s]));
  const out: SuggestedLine[] = [];
  for (const sale of sales) {
    if (!sale.closerUserId || sale.commissionRateBps == null || !sale.commissionLocked) continue;
    if (sale.status === "cancelada" || sale.status === "prospecto" || sale.status === "negociacion") continue;
    if (sale.commissionBase === "facturado" && sale.closedOn && inPeriod(sale.closedOn, period)) {
      const amount = applyBps(sale.totalCents, sale.commissionRateBps);
      out.push(
        line({
          idempotencyKey: `comision:factura:${sale.id}`,
          userId: sale.closerUserId,
          userName: sale.closerName,
          period,
          kind: "comision",
          sourceType: "sale",
          sourceId: sale.id,
          calculatedCents: amount,
          formula: `${formatArs(sale.totalCents)} × ${formatBps(sale.commissionRateBps)} = ${formatArs(amount)}. Base facturada, devengada al cierre.`,
          provenance: `${sale.code} · ${sale.clientName} · regla «${sale.commissionRuleName}» · tasa bloqueada, no la vigente.`,
        }),
      );
    }
  }
  if (payments.length || refunds.length) {
    for (const payment of payments) {
      if (!inPeriod(payment.paidOn, period)) continue;
      const sale = byId.get(payment.saleId);
      if (!sale || !sale.closerUserId || sale.commissionRateBps == null || !sale.commissionLocked) continue;
      if (sale.commissionBase !== "cobrado") continue;
      if (sale.status === "cancelada" || sale.status === "prospecto" || sale.status === "negociacion") continue;
      const amount = applyBps(payment.amountCents, sale.commissionRateBps);
      out.push(
        line({
          idempotencyKey: `comision:pago:${payment.id}`,
          userId: sale.closerUserId,
          userName: sale.closerName,
          period,
          kind: "comision",
          sourceType: "payment",
          sourceId: payment.id,
          calculatedCents: amount,
          formula: `${formatArs(payment.amountCents)} × ${formatBps(sale.commissionRateBps)} = ${formatArs(amount)}. Base: importe cobrado. Pago ${payment.paidOn}.`,
          provenance: `${sale.code} · ${sale.clientName} · closer ${sale.closerName} · regla «${sale.commissionRuleName}». El originador no cobra esta comisión.`,
        }),
      );
    }
    for (const refund of refunds) {
      if (!inPeriod(refund.refundedOn, period)) continue;
      const sale = byId.get(refund.saleId);
      if (!sale || !sale.closerUserId || sale.commissionRateBps == null || !sale.commissionLocked) continue;
      if (sale.status === "prospecto" || sale.status === "negociacion") continue;
      const amount = -applyBps(refund.amountCents, sale.commissionRateBps);
      out.push(
        line({
          idempotencyKey: `comision:reembolso:${refund.id}`,
          userId: sale.closerUserId,
          userName: sale.closerName,
          period,
          kind: "comision",
          sourceType: "refund",
          sourceId: refund.id,
          calculatedCents: amount,
          formula: `Reembolso ${formatArs(refund.amountCents)} × ${formatBps(sale.commissionRateBps)} = ${formatArs(amount)}. Clawback sobre la tasa bloqueada.`,
          provenance: `${sale.code} · reembolso ${refund.refundedOn}. No se borra la comisión original.`,
        }),
      );
    }
  }
  return out;
}

export function suggestMilestones(milestones: MilestoneFact[], period: string): SuggestedLine[] {
  const out: SuggestedLine[] = [];
  for (const m of milestones) {
    if (m.status !== "aceptado" || !m.assigneeUserId || !m.acceptedOn || !inPeriod(m.acceptedOn, period)) continue;
    if (m.amountCents <= 0) continue;
    if (m.projectKind === "interno" && !m.fundingApproved) continue;
    out.push(
      line({
        idempotencyKey: `proyecto:${m.id}`,
        userId: m.assigneeUserId,
        userName: m.assigneeName,
        period,
        kind: "proyecto",
        sourceType: "milestone",
        sourceId: m.id,
        calculatedCents: m.amountCents,
        formula: `Hito aceptado «${m.title}» = ${formatArs(m.amountCents)}. Presupuesto del hito, no un porcentaje del proyecto.`,
        provenance: `${m.projectName} · aceptado el ${m.acceptedOn}. Un rechazo no devenga. El avance porcentual no reemplaza la aceptación.`,
      }),
    );
  }
  return out;
}

export function suggestIncentives(objectives: ObjectiveFact[]): SuggestedLine[] {
  const out: SuggestedLine[] = [];
  for (const o of objectives) {
    if (!o.agreed || o.met !== true || o.incentiveCents <= 0) continue;
    out.push(
      line({
        idempotencyKey: `incentivo:${o.id}:${o.period}`,
        userId: o.userId,
        userName: o.userName,
        period: o.period,
        kind: "incentivo",
        sourceType: "objective",
        sourceId: o.id,
        calculatedCents: o.incentiveCents,
        formula: `Objetivo acordado cumplido «${o.title}» = ${formatArs(o.incentiveCents)}.`,
        provenance: "Solo objetivos previos, verificables y marcados como cumplidos. La cantidad de tareas no genera pago.",
      }),
    );
  }
  return out;
}

export function suggestDirection(agreements: AgreementFact[], period: string, milestones: MilestoneFact[]): SuggestedLine[] {
  const start = `${period}-01`;
  const end = `${period}-31`;
  const out: SuggestedLine[] = [];
  for (const a of agreements) {
    if (!a.accrue || a.fixedCents <= 0) continue;
    if (a.kind !== "ceo" && a.kind !== "cto") continue;
    if (a.effectiveFrom > end) continue;
    if (a.effectiveTo && a.effectiveTo < start) continue;
    out.push(
      line({
        idempotencyKey: `acuerdo:${a.id}:${period}`,
        userId: a.userId,
        userName: a.userName,
        period,
        kind: a.kind,
        sourceType: "agreement",
        sourceId: a.id,
        calculatedCents: a.fixedCents,
        formula: `Acuerdo de ${a.kind.toUpperCase()} «${a.title}» = ${formatArs(a.fixedCents)} en ${period}. No es comisión sobre ventas.`,
        provenance:
          a.kind === "cto" && milestones.some((m) => m.assigneeUserId === a.userId && m.status === "aceptado")
            ? "Hay hitos aceptados a nombre de esta persona. No se duplicó el pago: son conceptos distintos y deben revisarse."
            : "Remuneración de dirección separada de comisiones, hitos y reinversión.",
      }),
    );
  }
  return out;
}

export function campaignAssessment(campaign: CampaignFact, sales: SaleFact[], payments: PaymentFact[], refunds: RefundFact[]) {
  const attributed = sales.filter((s) => s.campaignId === campaign.id && s.attributionCriterion.trim().length > 0);
  const collected = attributed.reduce((sum, sale) => sum + Math.max(0, netCollected(sale.id, payments, refunds)), 0);
  const costsKnown = attributed.every((s) => s.directCostActualCents != null);
  const direct = costsKnown
    ? attributed.reduce((sum, s) => sum + (s.directCostActualCents ?? 0), 0)
    : null;
  const contribution = direct == null ? null : collected - direct - campaign.actualSpendCents;
  const cac =
    campaign.qualifiedContacts > 0 ? Math.floor(campaign.actualSpendCents / campaign.qualifiedContacts) : null;
  let verdict: "rentable" | "insuficiente" | "sin_dato" = "sin_dato";
  if (attributed.length === 0) verdict = "insuficiente";
  else if (contribution == null) verdict = "sin_dato";
  else verdict = contribution > 0 ? "rentable" : "insuficiente";
  return {
    campaignId: campaign.id,
    name: campaign.name,
    attributedSales: attributed.length,
    collectedCents: collected,
    contributionCents: contribution,
    cacCents: cac,
    rewardCents: 0,
    verdict,
    note:
      attributed.length === 0
        ? "Contactos o actividad sin ventas atribuibles. No se premia alcance ni impresiones."
        : "Solo entran ventas con criterio de atribución registrado. Coincidir en fechas no alcanza.",
  };
}

export function cashPosition(opening: number, initialized: boolean, movements: MovementFact[]): number | null {
  if (!initialized) return null;
  const delta = movements.reduce((sum, m) => sum + (m.direction === "entrada" ? m.amountCents : -m.amountCents), 0);
  return opening + delta;
}

export function distribute(input: {
  cashCents: number | null;
  accruedUnpaidCents: number;
  otherObligationsCents: number;
  reinversionBps: number;
  reservaBps: number;
  fondoBps: number;
  formacionBps: number;
  reinvestedCents: number;
}): Distribution {
  const policySum = input.reinversionBps + input.reservaBps + input.fondoBps + input.formacionBps;
  const policyOk = policySum === 10000;
  const obligations = input.accruedUnpaidCents + input.otherObligationsCents;
  if (input.cashCents == null || !policyOk) {
    return {
      cashCents: input.cashCents,
      accruedUnpaidCents: input.accruedUnpaidCents,
      otherObligationsCents: input.otherObligationsCents,
      deficitCents: input.cashCents == null ? obligations : Math.max(0, obligations - input.cashCents),
      surplusCents: 0,
      appliedOn: "excedente_de_caja",
      buckets: { reinversion: input.reinvestedCents, reserva: 0, fondoRemuneraciones: 0, formacion: 0 },
      policyOk,
      note: !policyOk
        ? "Los porcentajes de política no suman 100%. No se aplicó la distribución."
        : "La caja no está inicializada. No se presenta un disponible real.",
    };
  }
  const deficit = Math.max(0, obligations - input.cashCents);
  const surplus = Math.max(0, input.cashCents - obligations);
  const buckets = {
    reinversion: applyBps(surplus, input.reinversionBps) + input.reinvestedCents,
    reserva: applyBps(surplus, input.reservaBps),
    fondoRemuneraciones: applyBps(surplus, input.fondoBps),
    formacion: applyBps(surplus, input.formacionBps),
  };
  const allocated = applyBps(surplus, input.reinversionBps) + applyBps(surplus, input.reservaBps) + applyBps(surplus, input.fondoBps) + applyBps(surplus, input.formacionBps);
  const dust = surplus - allocated;
  if (dust !== 0) buckets.reserva += dust;
  return {
    cashCents: input.cashCents,
    accruedUnpaidCents: input.accruedUnpaidCents,
    otherObligationsCents: input.otherObligationsCents,
    deficitCents: deficit,
    surplusCents: surplus,
    appliedOn: "excedente_de_caja",
    buckets,
    policyOk,
    note:
      deficit > 0
        ? "Caja insuficiente. Las remuneraciones ya devengadas no se reducen para forzar los porcentajes."
        : "Los porcentajes se aplican solo al excedente de caja después de obligaciones y remuneraciones devengadas. No sobre la facturación.",
  };
}

function bookedUnpaid(rows: BookedComp[], period: string): { accrued: number; reinvested: number } {
  let net = 0;
  let reinvested = 0;
  for (const row of rows) {
    if (row.period !== period || row.status === "rechazado") continue;
    if (row.reinvested) {
      reinvested += row.approvedCents ?? row.calculatedCents;
      continue;
    }
    if (row.status === "aprobado" || row.status === "parcial" || row.status === "pagado") {
      net += (row.approvedCents ?? 0) - row.paidCents;
    } else {
      net += row.calculatedCents - row.paidCents;
    }
  }
  return { accrued: Math.max(0, net), reinvested };
}

export function buildChecklist(facts: PeriodFacts, warnings: Warning[]): CheckItem[] {
  const policySum =
    facts.settings.reinversionBps + facts.settings.reservaBps + facts.settings.fondoBps + facts.settings.formacionBps;
  const paidSales = new Set(facts.payments.filter((p) => inPeriod(p.paidOn, facts.period)).map((p) => p.saleId));
  const unlocked = facts.sales.filter(
    (s) => paidSales.has(s.id) && s.status !== "cancelada" && (!s.commissionLocked || s.commissionRateBps == null) && s.closerUserId,
  );
  const cancelledWithCash = facts.sales.filter(
    (s) => s.status === "cancelada" && netCollected(s.id, facts.payments, facts.refunds) > 0,
  );
  return [
    {
      id: "ventas",
      label: "Ventas del período revisadas",
      mandatory: true,
      ok: facts.manual.ventas,
      detail: facts.manual.ventas ? "Revisión marcada." : "Confirmá la revisión, aunque no haya ventas.",
    },
    {
      id: "cobros",
      label: "Cobros verificados",
      mandatory: true,
      ok: facts.manual.cobros,
      detail: facts.manual.cobros ? "Revisión marcada." : "Verificá cada cobro contra su comprobante.",
    },
    {
      id: "gastos",
      label: "Costos y gastos revisados",
      mandatory: true,
      ok: facts.manual.gastos,
      detail: facts.manual.gastos ? "Revisión marcada." : "Revisá gastos, estimados y costos directos.",
    },
    {
      id: "comisiones",
      label: "Comisiones calculadas y registradas",
      mandatory: true,
      ok: facts.materialized,
      detail: facts.materialized ? "Hay un cálculo registrado." : "Ejecutá el cálculo antes de cerrar.",
    },
    {
      id: "tasas",
      label: "Tasas bloqueadas en ventas cobradas",
      mandatory: true,
      ok: unlocked.length === 0,
      detail: unlocked.length ? `${unlocked.length} venta(s) cobrada(s) sin tasa bloqueada.` : "Sin tasas pendientes.",
    },
    {
      id: "canceladas",
      label: "Ventas canceladas sin cobro neto",
      mandatory: true,
      ok: cancelledWithCash.length === 0,
      detail: cancelledWithCash.length
        ? "Hay ventas canceladas con dinero neto cobrado. Reembolsá o corregí el estado."
        : "Sin inconsistencias de cancelación.",
    },
    {
      id: "politica",
      label: "Política de distribución suma 100%",
      mandatory: true,
      ok: policySum === 10000,
      detail: policySum === 10000 ? "100,00%." : `Suma actual: ${formatBps(policySum)}.`,
    },
    {
      id: "caja",
      label: "Caja inicializada y revisada",
      mandatory: true,
      ok: facts.settings.cashInitialized && facts.manual.caja,
      detail: !facts.settings.cashInitialized
        ? "Inicializá la caja, aunque el saldo sea cero."
        : facts.manual.caja
          ? "Caja revisada."
          : "Falta marcar la revisión de caja.",
    },
    {
      id: "propuesta",
      label: "Propuesta de distribución generada",
      mandatory: true,
      ok: facts.proposalReady,
      detail: facts.proposalReady ? "Propuesta guardada." : "Generá la propuesta en Distribución.",
    },
  ].concat(
    warnings.length
      ? [
          {
            id: "advertencias",
            label: "Advertencias reconocidas",
            mandatory: true,
            ok: facts.warningsAcknowledged,
            detail: "Podés cerrar con advertencias solo si las reconocés. Siguen visibles.",
          },
        ]
      : [],
  );
}

export function closeGate(items: CheckItem[]): { ok: boolean; message: string } {
  const pending = items.filter((i) => i.mandatory && !i.ok);
  if (pending.length === 0) return { ok: true, message: "Los controles obligatorios están cumplidos." };
  return { ok: false, message: `No se puede cerrar: ${pending.map((p) => p.label).join("; ")}.` };
}

function kpi(id: string, label: string, cents: number | null, status: Kpi["status"], note: string): Kpi {
  return { id, label, cents, status, note };
}

export function buildPeriod(facts: PeriodFacts) {
  const period = facts.period;
  const invoicedSales = facts.sales.filter((s) => s.closedOn && inPeriod(s.closedOn, period) && CLOSED.has(s.status));
  const facturacion = invoicedSales.reduce((s, sale) => s + sale.totalCents, 0);
  const periodPayments = facts.payments.filter((p) => inPeriod(p.paidOn, period));
  const periodRefunds = facts.refunds.filter((r) => inPeriod(r.refundedOn, period));
  const cobradoBruto = periodPayments.reduce((s, p) => s + p.amountCents, 0);
  const reembolsos = periodRefunds.reduce((s, r) => s + r.amountCents, 0);
  const cobrado = cobradoBruto - reembolsos;
  const pendiente = invoicedSales.reduce((s, sale) => s + Math.max(0, sale.totalCents - netCollected(sale.id, facts.payments, facts.refunds)), 0);
  const missingCost = invoicedSales.filter((s) => s.directCostActualCents == null);
  const costos = invoicedSales.reduce((s, sale) => s + (sale.directCostActualCents ?? 0), 0);
  const opexRows = facts.expenses.filter(
    (e) => inPeriod(e.spentOn, period) && !e.isEstimate && e.status !== "estimado" && e.category !== "directo",
  );
  const gastos = opexRows.reduce((s, e) => s + e.amountCents, 0);
  const suggestions = [
    ...suggestCommissions(facts.sales, facts.payments, facts.refunds, period),
    ...suggestMilestones(facts.milestones, period),
    ...suggestIncentives(facts.objectives).filter((l) => l.period === period),
    ...suggestDirection(facts.agreements, period, facts.milestones),
  ];
  const bookedPeriod = facts.booked.filter((b) => b.period === period && b.status !== "rechazado");
  const useBooked = facts.materialized && bookedPeriod.length > 0;
  const comisiones = (useBooked ? bookedPeriod.filter((b) => b.kind === "comision") : suggestions.filter((s) => s.kind === "comision")).reduce(
    (s, row) => s + row.calculatedCents,
    0,
  );
  const proyectos = (useBooked ? bookedPeriod.filter((b) => b.kind === "proyecto") : suggestions.filter((s) => s.kind === "proyecto")).reduce(
    (s, row) => s + row.calculatedCents,
    0,
  );
  const incentivos = (useBooked ? bookedPeriod.filter((b) => b.kind === "incentivo") : suggestions.filter((s) => s.kind === "incentivo")).reduce(
    (s, row) => s + row.calculatedCents,
    0,
  );
  const direccion = (
    useBooked ? bookedPeriod.filter((b) => b.kind === "ceo" || b.kind === "cto") : suggestions.filter((s) => s.kind === "ceo" || s.kind === "cto")
  ).reduce((s, row) => s + row.calculatedCents, 0);
  const remuStatus: Kpi["status"] = facts.materialized ? "real" : suggestions.length ? "propuesto" : "real";
  const resultadoOperativo = cobrado - costos - gastos;
  const resultado = resultadoOperativo - comisiones - proyectos - incentivos - direccion;
  const cash = cashPosition(facts.settings.openingCashCents, facts.settings.cashInitialized, facts.movements);
  const unpaidExp = facts.expenses
    .filter((e) => e.status === "pendiente_pago" && !e.isEstimate)
    .reduce((s, e) => s + e.amountCents, 0);
  const unpaidObl = facts.obligations.filter((o) => o.status === "pendiente").reduce((s, o) => s + o.amountCents, 0);
  const { accrued, reinvested } = facts.materialized
    ? bookedUnpaid(facts.booked, period)
    : {
        accrued: suggestions.reduce((s, row) => s + Math.max(0, row.calculatedCents), 0),
        reinvested: 0,
      };
  const distribution = distribute({
    cashCents: cash,
    accruedUnpaidCents: accrued,
    otherObligationsCents: unpaidExp + unpaidObl,
    reinversionBps: facts.settings.reinversionBps,
    reservaBps: facts.settings.reservaBps,
    fondoBps: facts.settings.fondoBps,
    formacionBps: facts.settings.formacionBps,
    reinvestedCents: reinvested,
  });
  const approvedReserve = facts.allocations
    .filter((a) => a.bucket === "reserva" && (a.status === "aprobado" || a.status === "ejecutado"))
    .reduce((s, a) => s + a.amountCents, 0);
  const approvedReinvest = facts.allocations
    .filter((a) => a.bucket === "reinversion" && (a.status === "aprobado" || a.status === "ejecutado"))
    .reduce((s, a) => s + a.amountCents, 0);
  const pendingApproval = facts.booked
    .filter((b) => b.period === period && (b.status === "pendiente" || b.status === "calculado"))
    .reduce((s, b) => s + b.calculatedCents, 0);
  const approvedUnpaid = Math.max(
    0,
    facts.booked
      .filter((b) => b.period === period && (b.status === "aprobado" || b.status === "parcial" || b.status === "pagado") && !b.reinvested)
      .reduce((s, b) => s + ((b.approvedCents ?? 0) - b.paidCents), 0),
  );

  const warnings: Warning[] = [];
  if (!facts.sales.some((s) => (s.closedOn && inPeriod(s.closedOn, period)) || facts.payments.some((p) => p.saleId === s.id && inPeriod(p.paidOn, period)))) {
    warnings.push({ level: "advertencia", message: "No hay ventas ni cobros en el período." });
  }
  if (missingCost.length) {
    warnings.push({
      level: "advertencia",
      message: `${missingCost.length} venta(s) cerrada(s) sin costo real. El margen no se estima como si fuera real.`,
    });
  }
  if (facts.expenses.some((e) => inPeriod(e.spentOn, period) && !e.receipt.trim() && !e.isEstimate)) {
    warnings.push({ level: "advertencia", message: "Hay gastos del período sin referencia de comprobante." });
  }
  if (facts.milestones.some((m) => m.status === "en_revision" || m.status === "en_progreso")) {
    warnings.push({ level: "advertencia", message: "Hay hitos sin aceptación. No se devengan hasta aprobarse." });
  }
  if (facts.objectives.some((o) => o.period === period && o.agreed && o.met == null)) {
    warnings.push({ level: "advertencia", message: "Hay objetivos acordados sin resultado cargado." });
  }
  if (resultado < 0) warnings.push({ level: "advertencia", message: "El resultado provisional del período es negativo." });
  if (distribution.deficitCents > 0) warnings.push({ level: "advertencia", message: "La caja no alcanza para cubrir obligaciones y remuneraciones devengadas." });
  for (const sale of facts.sales) {
    if (sale.status === "cancelada" && netCollected(sale.id, facts.payments, facts.refunds) > 0) {
      warnings.push({ level: "bloqueo", message: `${sale.code} está cancelada pero tiene cobro neto.` });
    }
  }
  const divergences = facts.materialized
    ? suggestions.filter((s) => {
        const booked = facts.booked.find(
          (b) => b.period === period && b.kind === s.kind && b.sourceId === s.sourceId,
        );
        return (
          !!booked &&
          (booked.status === "aprobado" || booked.status === "pagado" || booked.status === "reinvertido") &&
          booked.calculatedCents !== s.calculatedCents
        );
      })
    : [];
  if (divergences.length) {
    warnings.push({
      level: "advertencia",
      message: `${divergences.length} remuneración(es) aprobada(s) no coinciden con un recálculo. No se modificaron.`,
    });
  }

  const kpis: Kpi[] = [
    kpi("facturacion", "Facturación", facturacion, "real", "Ventas cerradas del período, sin descontar reembolsos."),
    kpi("cobrado", "Cobrado neto", cobrado, "real", "Pagos del período menos reembolsos del período."),
    kpi("pendiente", "Pendiente de cobro", pendiente, "real", "Saldo de las ventas cerradas en el período."),
    kpi(
      "costos",
      "Costos directos",
      costos,
      missingCost.length ? "insuficiente" : "real",
      missingCost.length ? "Suma solo costos reales cargados. Los estimados no entran." : "Costos reales de las ventas cerradas.",
    ),
    kpi("gastos", "Gastos operativos", gastos, "real", "Gastos no estimados, sin repetir el costo directo de la venta."),
    kpi("comisiones", "Comisiones", comisiones, remuStatus, facts.materialized ? "Registros del cálculo." : "Propuesta todavía no registrada."),
    kpi("proyectos", "Remuneraciones por proyectos", proyectos, remuStatus, "Solo hitos aceptados."),
    kpi("resultado", "Resultado provisional", resultado, missingCost.length ? "insuficiente" : remuStatus, "Cobrado − costos reales − gastos − remuneraciones consideradas."),
    kpi("obligaciones", "Obligaciones pendientes", unpaidExp + unpaidObl + approvedUnpaid, "real", "Gastos a pagar, obligaciones y remuneraciones aprobadas sin pagar."),
    kpi("caja", "Caja disponible", cash, cash == null ? "insuficiente" : "real", cash == null ? "Caja no inicializada. No es un saldo cero real." : "Saldo inicial más movimientos registrados."),
    kpi("reserva", "Reserva aprobada", approvedReserve, approvedReserve ? "real" : "sin_dato", "Solo asignaciones ya decididas, no el porcentaje propuesto."),
    kpi("reinversion", "Reinversión aprobada", approvedReinvest + reinvested, "real", "Incluye remuneración del CEO marcada como reinvertida, que sigue existiendo."),
    kpi("remu_pend", "Remuneraciones por aprobar", facts.materialized ? pendingApproval : null, facts.materialized ? "real" : "sin_dato", "Pendientes de aprobación."),
    kpi("remu_aprob", "Aprobadas sin pagar", approvedUnpaid, "real", "Aprobadas y todavía no ejecutadas."),
  ];

  const marketing = facts.campaigns.map((c) => campaignAssessment(c, facts.sales, facts.payments, facts.refunds));
  const items = buildChecklist(facts, warnings.filter((w) => w.level === "advertencia"));
  return {
    period,
    kpis,
    facturacion,
    cobrado,
    pendiente,
    costos,
    gastos,
    comisiones,
    proyectos,
    incentivos,
    direccion,
    resultadoOperativo,
    resultado,
    cash,
    distribution,
    suggestions,
    warnings,
    checklist: items,
    close: closeGate(items),
    marketing,
    invoicedSales,
    missingCost: missingCost.length,
    manual: facts.manual,
  };
}

export function compareKpis(current: Kpi[], previous: Kpi[] | null) {
  return current.map((item) => {
    const prev = previous?.find((p) => p.id === item.id);
    if (!prev || prev.cents == null || item.cents == null) return { ...item, deltaCents: null as number | null };
    return { ...item, deltaCents: item.cents - prev.cents };
  });
}

export function emptyManual(): ManualReview {
  return { ventas: false, cobros: false, gastos: false, caja: false };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** La foto del cierre reemplaza el recálculo. Un mes cerrado no se reescribe. */
export function applyFrozen<T extends {
  kpis: Kpi[];
  resultado: number;
  distribution: Distribution;
  warnings: Warning[];
  suggestions: SuggestedLine[];
  marketing: ReturnType<typeof campaignAssessment>[];
}>(current: T, snapshot: unknown): T & { frozen: boolean } {
  const snap = asRecord(snapshot);
  if (!snap || !Array.isArray(snap.kpis)) return { ...current, frozen: false };
  const distribution = asRecord(snap.distribution);
  return {
    ...current,
    frozen: true,
    kpis: snap.kpis as Kpi[],
    resultado: typeof snap.resultado === "number" ? snap.resultado : current.resultado,
    distribution: distribution && asRecord(distribution.buckets) ? (distribution as Distribution) : current.distribution,
    warnings: Array.isArray(snap.warnings) ? (snap.warnings as Warning[]) : current.warnings,
    suggestions: Array.isArray(snap.suggestions) ? (snap.suggestions as SuggestedLine[]) : current.suggestions,
    marketing: Array.isArray(snap.marketing) ? (snap.marketing as T["marketing"]) : current.marketing,
  };
}
