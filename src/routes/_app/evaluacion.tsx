import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { closeMonth, fetchClosing, materialize, saveChecklist, storeProposal } from "@/lib/sif/api";
import { can } from "@/lib/sif/permissions";
import { useSif } from "@/components/sif/shell";
import { Badge, Button, Money, Panel, control, run, useLoad } from "@/components/sif/ui";

export const Route = createFileRoute("/_app/evaluacion")({ component: Evaluacion });

const steps = [
  "Período",
  "Ventas",
  "Cobros",
  "Costos y gastos",
  "Comisiones",
  "Campañas",
  "Hitos",
  "CTO",
  "CEO",
  "Tareas financieras",
  "Información faltante",
  "Remuneraciones",
  "Caja y obligaciones",
  "Distribución",
  "Aprobación",
  "Cierre",
];

function Evaluacion() {
  const { period, tick, refresh, session } = useSif();
  const state = useLoad(() => fetchClosing({ data: { period } }), [period, tick]);
  const [step, setStep] = useState(0);
  const [decision, setDecision] = useState("");
  const [ack, setAck] = useState(false);
  const report = state.data?.report;
  const manual = report?.manual ?? { ventas: false, cobros: false, gastos: false, caja: false };

  async function mark(partial: Partial<typeof manual>, acknowledged = ack) {
    const next = { ...manual, ...partial };
    const result = await run(() => saveChecklist({ data: { period, manual: next, warningsAcknowledged: acknowledged, ackNote: decision } }), "Revisión guardada.");
    if (result.ok) refresh();
  }

  const done = report ? report.checklist.filter((i: any) => i.ok).length : 0;
  const total = report?.checklist.length ?? 1;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Evaluación mensual</h1>
        <p className="text-sm text-muted">Abrir mes, revisar, calcular, mirar la caja, aprobar y cerrar. El cierre deja una foto que no se reescribe.</p>
        <div className="mt-3 h-2 overflow-hidden rounded-sm bg-raised">
          <div className="h-full bg-primary" style={{ width: `${Math.round((done / total) * 100)}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted">{done} de {total} controles obligatorios</p>
      </header>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {steps.map((label, index) => (
          <button key={label} type="button" className={`shrink-0 rounded-md border px-3 py-2 text-xs ${step === index ? "border-primary text-fg" : "border-line text-muted"}`} onClick={() => setStep(index)}>
            {index + 1}. {label}
          </button>
        ))}
      </div>
      {state.loading ? <p className="text-sm text-muted">Armando el cierre…</p> : null}
      {state.error ? <p className="text-sm text-neg">{state.error}</p> : null}
      {report ? (
        <Panel title={steps[step]}>
          {step === 0 ? (
            <div className="space-y-2 text-sm">
              <p>Estás revisando {period}. Estado: {report.closingStatus.status}.{report.frozen ? " Los importes son la foto del cierre." : " Los importes se recalculan hasta que cierres."}</p>
              <ul className="space-y-1">
                {state.data?.history.length ? state.data.history.map((row: any) => (
                  <li key={row.period}>{row.period} · {row.status}{row.ceo_decision ? ` · ${row.ceo_decision}` : ""}</li>
                )) : <li>Todavía no hay meses en el historial.</li>}
              </ul>
            </div>
          ) : null}
          {step === 1 ? (
            <div className="space-y-2 text-sm">
              <p>Facturación del período <Money cents={report.facturacion} />. {report.invoicedSales.length} ventas cerradas.</p>
              <ul>{report.invoicedSales.map((s: any) => <li key={s.id}>{s.code} · {s.clientName} · {s.productName} · <Money cents={s.totalCents} /></li>)}</ul>
              {report.invoicedSales.length === 0 ? <p>No hay ventas cerradas. Igual tenés que marcar la revisión.</p> : null}
            </div>
          ) : null}
          {step === 2 ? (
            <div className="space-y-2 text-sm">
              <p>Cobrado neto <Money cents={report.cobrado} />. Pendiente de esas ventas <Money cents={report.pendiente} />.</p>
              <ul>
                {state.data?.payments.map((row: any) => <li key={row.id}>Cobro {row.paidOn} · <Money cents={row.amountCents} /></li>)}
                {state.data?.refunds.map((row: any) => <li key={row.id}>Reembolso {row.refundedOn} · <Money cents={-row.amountCents} /></li>)}
              </ul>
              {(state.data?.payments.length ?? 0) + (state.data?.refunds.length ?? 0) === 0 ? <p>No hay cobros ni reembolsos en el período.</p> : null}
            </div>
          ) : null}
          {step === 3 ? (
            <div className="space-y-2 text-sm">
              <p>Costos directos reales <Money cents={report.costos} />. Gastos operativos <Money cents={report.gastos} />. {report.missingCost} ventas sin costo real.</p>
              <ul>
                {state.data?.expenses.map((row: any) => <li key={row.id}>{row.spentOn} · {row.description} · {row.isEstimate ? "estimado, no entra" : row.category} · <Money cents={row.amountCents} /></li>)}
                {state.data?.obligations.map((row: any) => <li key={row.id}>Obligación {row.description} · {row.status} · <Money cents={row.amountCents} /></li>)}
              </ul>
            </div>
          ) : null}
          {step === 4 ? (
            <div className="space-y-2 text-sm">
              <p>Comisiones consideradas <Money cents={report.comisiones} />.</p>
              <ul>{report.suggestions.filter((row: any) => row.kind === "comision").map((row: any) => <li key={row.idempotencyKey}>{row.userName}: {row.formula}</li>)}</ul>
              <Button tone="ghost" onClick={async () => { const result = await run(() => materialize({ data: { period } }), "Comisiones registradas."); if (result.ok) refresh(); }}>Calcular y registrar</Button>
            </div>
          ) : null}
          {step === 5 ? (
            <ul className="space-y-2 text-sm">
              {report.marketing.length === 0 ? <li>No hay campañas.</li> : report.marketing.map((c: any) => <li key={c.campaignId}>{c.name}: {c.verdict}, ventas atribuibles {c.attributedSales}, cobrado <Money cents={c.collectedCents} />.</li>)}
            </ul>
          ) : null}
          {step === 6 ? (
            <div className="space-y-2 text-sm">
              <p>Remuneraciones de hitos <Money cents={report.proyectos} />. Los rechazados no entran.</p>
              <ul>{state.data?.milestones.map((m: any) => <li key={m.id}>{m.projectName} · {m.title} · {m.status} · <Money cents={m.amountCents} /></li>)}</ul>
            </div>
          ) : null}
          {step === 7 ? <p className="text-sm">Dirección técnica y CEO considerados en conjunto <Money cents={report.direccion} />. No hay comisión automática por el cargo.</p> : null}
          {step === 8 ? (
            <div className="space-y-2 text-sm">
              <p>Contribuciones registradas en el período: {state.data?.contributions.length ?? 0}. La cantidad de tareas no premia.</p>
              <ul>{state.data?.contributions.map((c: any) => <li key={String(c.id)}>{String(c.category)}: {String(c.title)}</li>)}</ul>
            </div>
          ) : null}
          {step === 9 ? (
            <div className="space-y-2 text-sm">
              <p>Objetivos del período. Si no hay responsable financiero, las tareas quedan a nombre de quien las cargó.</p>
              <ul>{state.data?.objectives.map((o: any) => <li key={o.id}>{o.userName} · {o.title} · {o.met == null ? "sin resultado" : o.met ? "cumplido" : "no cumplido"}</li>)}</ul>
            </div>
          ) : null}
          {step === 10 ? (
            <ul className="space-y-1 text-sm">
              {report.warnings.length === 0 ? <li>No hay advertencias.</li> : report.warnings.map((w: any) => <li key={w.message} className={w.level === "bloqueo" ? "text-neg" : "text-warn"}>{w.message}</li>)}
            </ul>
          ) : null}
          {step === 11 ? (
            <div className="space-y-2 text-sm">
              <p>Incentivos <Money cents={report.incentivos} />. Resultado provisional <Money cents={report.resultado} />.</p>
              <ul>{report.suggestions.filter((row: any) => row.kind !== "comision").map((row: any) => <li key={row.idempotencyKey}>{row.userName} · {row.kind}: {row.formula}</li>)}</ul>
            </div>
          ) : null}
          {step === 12 ? (
            <div className="space-y-2 text-sm">
              <p>Caja <Money cents={report.cash} />. Déficit <Money cents={report.distribution.deficitCents} />.</p>
              <ul>{state.data?.movements.map((m: any, index: any) => <li key={`${m.movedOn}-${index}`}>{m.movedOn} · {m.direction} · {m.category} · <Money cents={m.direction === "salida" ? -m.amountCents : m.amountCents} /></li>)}</ul>
            </div>
          ) : null}
          {step === 13 ? (
            <div className="space-y-2 text-sm">
              <p>{report.distribution.note}</p>
              <p>Reinversión <Money cents={report.distribution.buckets.reinversion} /> · reserva <Money cents={report.distribution.buckets.reserva} /> · fondo <Money cents={report.distribution.buckets.fondoRemuneraciones} /> · formación <Money cents={report.distribution.buckets.formacion} /></p>
              <Button tone="ghost" onClick={async () => { const result = await run(() => storeProposal({ data: { period } }), "Propuesta generada."); if (result.ok) refresh(); }}>Generar propuesta</Button>
            </div>
          ) : null}
          {step === 14 ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ack} onChange={async (e) => { setAck(e.target.checked); await mark({}, e.target.checked); }} />
              Reconozco las advertencias. Siguen visibles en el informe.
            </label>
          ) : null}
          {step === 15 ? (
            <div className="space-y-3">
              <textarea className={control + " min-h-28"} value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="Decisión final del CEO" />
              <p className="text-sm">{report.close.message}</p>
              {can(session.actor.roles, "cerrarMes") && report.closingStatus.status !== "cerrado" ? (
                <Button onClick={async () => {
                  const result = await run(() => closeMonth({ data: { period, decision } }), "Mes cerrado. La foto quedó inmutable.");
                  if (result.ok) refresh();
                }}>Cerrar mes</Button>
              ) : report.closingStatus.status === "cerrado" ? (
                <p className="text-sm">Este mes ya está cerrado. La foto no se vuelve a escribir.</p>
              ) : <p className="text-sm text-muted">Solo el CEO cierra el mes.</p>}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {step === 1 ? <Button tone="ghost" onClick={() => mark({ ventas: true })}>Marcar ventas revisadas</Button> : null}
            {step === 2 ? <Button tone="ghost" onClick={() => mark({ cobros: true })}>Marcar cobros verificados</Button> : null}
            {step === 3 ? <Button tone="ghost" onClick={() => mark({ gastos: true })}>Marcar gastos revisados</Button> : null}
            {step === 12 ? <Button tone="ghost" onClick={() => mark({ caja: true })}>Marcar caja revisada</Button> : null}
          </div>
          <ul className="mt-4 space-y-1 text-xs text-muted">
            {report.checklist.map((item: any) => (
              <li key={item.id}><Badge tone={item.ok ? "ok" : "warn"}>{item.ok ? "Listo" : "Pendiente"}</Badge> {item.label}. {item.detail}</li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
