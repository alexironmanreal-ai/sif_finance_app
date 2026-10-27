import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyFrozen,
  buildPeriod,
  campaignAssessment,
  cashPosition,
  closeGate,
  commissionBeneficiaries,
  distribute,
  effectiveRateBps,
  emptyManual,
  netCollected,
  paymentDuplicate,
  periodEditDecision,
  registerAdjustment,
  reinvestEffect,
  suggestCommissions,
  suggestMilestones,
  type PeriodFacts,
  type SaleFact,
} from "./engine.ts";
import { applyBps } from "./money.ts";
import { canSeeGlobalFinance, canSelfApprove, parseRoles } from "./permissions.ts";

function sale(partial: Partial<SaleFact> & Pick<SaleFact, "id" | "totalCents" | "status">): SaleFact {
  return {
    code: partial.id,
    clientName: "Cliente",
    productName: "Servicio",
    closedOn: "2026-10-10",
    directCostActualCents: 0,
    directCostEstimatedCents: 0,
    commissionRateBps: 1000,
    commissionLocked: true,
    commissionBase: "cobrado",
    commissionRuleName: "Comisión estándar",
    closerUserId: "closer-1",
    closerName: "Closer",
    originatorUserId: "setter-1",
    originatorName: "Setter",
    campaignId: null,
    attributionCriterion: "",
    ...partial,
  };
}

function baseFacts(partial: Partial<PeriodFacts> = {}): PeriodFacts {
  return {
    period: "2026-10",
    settings: {
      reinversionBps: 5000,
      reservaBps: 2000,
      fondoBps: 2500,
      formacionBps: 500,
      cashInitialized: true,
      openingCashCents: 0,
    },
    sales: [],
    payments: [],
    refunds: [],
    expenses: [],
    campaigns: [],
    milestones: [],
    objectives: [],
    agreements: [],
    obligations: [],
    movements: [],
    allocations: [],
    booked: [],
    manual: { ventas: true, cobros: true, gastos: true, caja: true },
    materialized: true,
    proposalReady: true,
    warningsAcknowledged: true,
    ...partial,
  };
}

describe("comisiones", () => {
  it("1. venta cerrada sin cobro no genera comisión", () => {
    const lines = suggestCommissions(
      [sale({ id: "s1", totalCents: 15_000_000, status: "cerrada_pendiente" })],
      [],
      [],
      "2026-10",
    );
    assert.equal(lines.length, 0);
    assert.equal(netCollected("s1", [], []), 0);
  });

  it("2 y 4. cobro parcial al 10%", () => {
    const lines = suggestCommissions(
      [sale({ id: "s1", totalCents: 15_000_000, status: "parcial" })],
      [{ id: "p1", saleId: "s1", paidOn: "2026-10-12", amountCents: 6_000_000 }],
      [],
      "2026-10",
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0].calculatedCents, 600_000);
    assert.match(lines[0].formula, /10,00%/);
  });

  it("3 y 5. cobro total al 15%", () => {
    const lines = suggestCommissions(
      [sale({ id: "s1", totalCents: 15_000_000, status: "cobrada", commissionRateBps: 1500, commissionRuleName: "Comisión superior" })],
      [{ id: "p1", saleId: "s1", paidOn: "2026-10-12", amountCents: 15_000_000 }],
      [],
      "2026-10",
    );
    assert.equal(lines[0].calculatedCents, applyBps(15_000_000, 1500));
    assert.equal(lines[0].calculatedCents, 2_250_000);
  });

  it("6. reembolso parcial reduce la comisión sin borrar el original", () => {
    const lines = suggestCommissions(
      [sale({ id: "s1", totalCents: 15_000_000, status: "parcial" })],
      [{ id: "p1", saleId: "s1", paidOn: "2026-10-12", amountCents: 15_000_000 }],
      [{ id: "r1", saleId: "s1", refundedOn: "2026-10-20", amountCents: 4_000_000 }],
      "2026-10",
    );
    assert.equal(lines.length, 2);
    assert.equal(lines[0].calculatedCents + lines[1].calculatedCents, 1_100_000);
  });

  it("19. dos personas en la venta: una sola comisión, para el closer", () => {
    const row = sale({ id: "s1", totalCents: 15_000_000, status: "cobrada" });
    const who = commissionBeneficiaries(row);
    assert.deepEqual(who, ["closer-1"]);
    const lines = suggestCommissions(
      [row],
      [{ id: "p1", saleId: "s1", paidOn: "2026-10-12", amountCents: 15_000_000 }],
      [],
      "2026-10",
    );
    assert.equal(lines.length, 1);
    assert.equal(lines[0].userId, "closer-1");
  });

  it("14. cambiar la regla viva no altera la tasa bloqueada", () => {
    const row = sale({ id: "s1", totalCents: 100, status: "cobrada", commissionLocked: true, commissionRateBps: 1000 });
    assert.equal(effectiveRateBps(row, 1500), 1000);
  });

  it("una venta cancelada no genera comisión nueva", () => {
    const lines = suggestCommissions(
      [sale({ id: "s1", totalCents: 15_000_000, status: "cancelada" })],
      [{ id: "p1", saleId: "s1", paidOn: "2026-10-12", amountCents: 15_000_000 }],
      [],
      "2026-10",
    );
    assert.equal(lines.length, 0);
  });
});

describe("hitos y remuneraciones", () => {
  it("7. hito aceptado devenga el importe acordado", () => {
    const lines = suggestMilestones(
      [
        {
          id: "m1",
          projectId: "p",
          projectName: "App",
          title: "Arquitectura",
          amountCents: 2_400_000,
          assigneeUserId: "dev-1",
          assigneeName: "Dev",
          status: "aceptado",
          acceptedOn: "2026-10-18",
          fundingApproved: true,
          projectKind: "cliente",
        },
      ],
      "2026-10",
    );
    assert.equal(lines[0].calculatedCents, 2_400_000);
  });

  it("8. hito rechazado no devenga", () => {
    const lines = suggestMilestones(
      [
        {
          id: "m1",
          projectId: "p",
          projectName: "App",
          title: "Arquitectura",
          amountCents: 2_400_000,
          assigneeUserId: "dev-1",
          assigneeName: "Dev",
          status: "rechazado",
          acceptedOn: null,
          fundingApproved: true,
          projectKind: "cliente",
        },
      ],
      "2026-10",
    );
    assert.equal(lines.length, 0);
  });

  it("9. aprobado y no pagado sigue como obligación", () => {
    const report = buildPeriod(
      baseFacts({
        booked: [
          {
            id: "c1",
            userId: "closer-1",
            userName: "Closer",
            period: "2026-10",
            kind: "comision",
            sourceType: "payment",
            sourceId: "p1",
            formula: "10%",
            calculatedCents: 1_500_000,
            approvedCents: 1_500_000,
            paidCents: 0,
            status: "aprobado",
            reinvested: false,
          },
        ],
      }),
    );
    const pending = report.kpis.find((k) => k.id === "remu_aprob");
    assert.equal(pending?.cents, 1_500_000);
    assert.equal(report.distribution.accruedUnpaidCents, 1_500_000);
  });

  it("17. reinvertir la remuneración del CEO no la elimina", () => {
    const effect = reinvestEffect({
      id: "c",
      userId: "ceo",
      userName: "CEO",
      period: "2026-10",
      kind: "ceo",
      sourceType: "agreement",
      sourceId: "a",
      formula: "acuerdo",
      calculatedCents: 800_000,
      approvedCents: 800_000,
      paidCents: 0,
      status: "reinvertido",
      reinvested: true,
    });
    assert.equal(effect.exists, true);
    assert.equal(effect.pendingPayoutCents, 0);
    assert.equal(effect.designatedReinvestmentCents, 800_000);
  });
});

describe("resultado, caja y cierre", () => {
  it("10. mes con resultado negativo", () => {
    const report = buildPeriod(
      baseFacts({
        payments: [{ id: "p", saleId: "s", paidOn: "2026-10-02", amountCents: 1_000_000 }],
        sales: [sale({ id: "s", totalCents: 1_000_000, status: "cobrada", directCostActualCents: 3_000_000, commissionRateBps: 0 })],
        expenses: [
          {
            id: "e",
            spentOn: "2026-10-03",
            category: "operativo",
            amountCents: 500_000,
            isEstimate: false,
            status: "pagado",
            campaignId: null,
            description: "Alquiler",
            receipt: "F-1",
          },
        ],
      }),
    );
    assert.ok(report.resultado < 0);
    assert.ok(report.warnings.some((w) => w.message.includes("negativo")));
  });

  it("11. caja insuficiente no recorta lo devengado y no parte de la facturación", () => {
    const dist = distribute({
      cashCents: 4_000_000,
      accruedUnpaidCents: 10_000_000,
      otherObligationsCents: 0,
      reinversionBps: 5000,
      reservaBps: 2000,
      fondoBps: 2500,
      formacionBps: 500,
      reinvestedCents: 0,
    });
    assert.equal(dist.deficitCents, 6_000_000);
    assert.equal(dist.surplusCents, 0);
    assert.equal(dist.buckets.reinversion, 0);
    assert.equal(dist.accruedUnpaidCents, 10_000_000);
    const notOnGross = distribute({
      cashCents: 20_000_000,
      accruedUnpaidCents: 15_000_000,
      otherObligationsCents: 0,
      reinversionBps: 5000,
      reservaBps: 2000,
      fondoBps: 2500,
      formacionBps: 500,
      reinvestedCents: 0,
    });
    assert.equal(notOnGross.surplusCents, 5_000_000);
    assert.equal(notOnGross.buckets.reinversion, 2_500_000);
    assert.notEqual(notOnGross.buckets.reinversion, applyBps(100_000_000, 5000));
  });

  it("12. mes sin ventas", () => {
    const report = buildPeriod(baseFacts());
    assert.equal(report.facturacion, 0);
    assert.equal(report.cobrado, 0);
    assert.equal(report.comisiones, 0);
    assert.ok(report.warnings.some((w) => w.message.includes("No hay ventas")));
  });

  it("13. un desarrollador no ve finanzas globales", () => {
    assert.equal(canSeeGlobalFinance(parseRoles("desarrollador")), false);
    assert.equal(canSeeGlobalFinance(parseRoles("ceo")), true);
    assert.equal(canSeeGlobalFinance(parseRoles("closer,setter")), false);
  });

  it("15. cierre con información faltante: bloquea lo obligatorio y conserva advertencias", () => {
    const report = buildPeriod(
      baseFacts({
        manual: emptyManual(),
        materialized: false,
        proposalReady: false,
        warningsAcknowledged: false,
        settings: {
          reinversionBps: 5000,
          reservaBps: 2000,
          fondoBps: 2500,
          formacionBps: 500,
          cashInitialized: false,
          openingCashCents: 0,
        },
        sales: [sale({ id: "s", totalCents: 1000, status: "cobrada", directCostActualCents: null })],
      }),
    );
    assert.equal(report.close.ok, false);
    assert.ok(report.warnings.some((w) => w.level === "advertencia"));
    const forced = closeGate(report.checklist.map((item) => ({ ...item, ok: item.id === "advertencias" ? false : true })));
    assert.equal(forced.ok, false);
  });

  it("16. una corrección posterior no muta la foto del cierre", () => {
    assert.equal(periodEditDecision("cerrado", "corto"), "needs_reason");
    assert.equal(periodEditDecision("cerrado", "se corrigió el cobro"), "allow_with_adjustment");
    assert.equal(periodEditDecision("abierto", ""), "allow");
    const snapshot = { facturacion: 100 };
    const result = registerAdjustment(snapshot, "se corrigió el cobro", "sale-1");
    assert.equal(result.snapshot, snapshot);
    assert.equal(result.snapshot.facturacion, 100);
    assert.equal(result.adjustment.snapshotUntouched, true);
  });

  it("20. el mismo pago no se registra dos veces", () => {
    const existing = [{ saleId: "s", paidOn: "2026-10-01", amountCents: 100, method: "transferencia", reference: "OP-1" }];
    assert.equal(paymentDuplicate(existing, { ...existing[0] }), true);
    assert.equal(paymentDuplicate(existing, { ...existing[0], reference: "OP-2" }), false);
  });

  it("la autoaprobación se rechaza si hay otro autorizador", () => {
    const denied = canSelfApprove({
      actorId: "a",
      beneficiaryId: "a",
      independent: true,
      otherApprovers: 1,
      justification: "soy el único",
    });
    assert.equal(denied.ok, false);
    const sole = canSelfApprove({
      actorId: "a",
      beneficiaryId: "a",
      independent: true,
      otherApprovers: 0,
      justification: "único firmante del período",
    });
    assert.equal(sole.ok, true);
    assert.equal(sole.sole, true);
  });
});

describe("marketing", () => {
  it("18. contactos sin ventas no generan premio ni CAC inventado como venta", () => {
    const assessment = campaignAssessment(
      {
        id: "c",
        name: "Lanzamiento",
        budgetCents: 500_000,
        actualSpendCents: 200_000,
        qualifiedContacts: 4,
        contacts: 20,
        meetings: 1,
        startsOn: "2026-10-01",
        endsOn: "2026-10-31",
      },
      [sale({ id: "s", totalCents: 9_000_000, status: "cobrada", campaignId: null, attributionCriterion: "" })],
      [{ id: "p", saleId: "s", paidOn: "2026-10-11", amountCents: 9_000_000 }],
      [],
    );
    assert.equal(assessment.attributedSales, 0);
    assert.equal(assessment.collectedCents, 0);
    assert.equal(assessment.rewardCents, 0);
    assert.equal(assessment.verdict, "insuficiente");
    assert.equal(assessment.cacCents, 50_000);
  });
});

describe("caja", () => {
  it("no presenta cero como caja real si no fue inicializada", () => {
    assert.equal(cashPosition(0, false, []), null);
    assert.equal(cashPosition(0, true, []), 0);
  });
});

describe("cierre", () => {
  it("la foto congelada no se reemplaza con un recálculo posterior", () => {
    const live = buildPeriod(
      baseFacts({
        sales: [sale({ id: "s", totalCents: 1_000_000, status: "cobrada" })],
        payments: [{ id: "p", saleId: "s", paidOn: "2026-10-12", amountCents: 1_000_000 }],
      }),
    );
    const frozen = applyFrozen(live, {
      kpis: [{ id: "facturacion", label: "Facturación", cents: 111, status: "real", note: "foto" }],
      resultado: 111,
      distribution: live.distribution,
      warnings: [{ level: "advertencia", message: "Advertencia del cierre." }],
      suggestions: [],
      marketing: [],
    });
    assert.equal(frozen.frozen, true);
    assert.equal(frozen.kpis[0]?.cents, 111);
    assert.equal(frozen.resultado, 111);
    assert.equal(frozen.warnings[0]?.message, "Advertencia del cierre.");
    assert.notEqual(live.resultado, 111);
    assert.equal(applyFrozen(live, null).frozen, false);
  });
});
