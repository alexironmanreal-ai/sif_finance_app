import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { decideDistribution, fetchDistribution, storeProposal } from "@/lib/sif/api";
import { formatBps } from "@/lib/sif/money";
import { can } from "@/lib/sif/permissions";
import { useSif } from "@/components/sif/shell";
import { Button, Money, Panel, control, run, useLoad } from "@/components/sif/ui";

export const Route = createFileRoute("/_app/distribucion")({ component: Distribucion });

function Distribucion() {
  const { period, tick, refresh, session } = useSif();
  const state = useLoad(() => fetchDistribution({ data: { period } }), [period, tick]);
  const [decision, setDecision] = useState("");
  const dist = state.data?.report.distribution;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Distribución financiera</h1>
        <p className="text-sm text-muted">Los porcentajes se aplican al excedente de caja, después de obligaciones y remuneraciones devengadas. Nunca a la facturación bruta.</p>
      </header>
      {state.loading ? <p className="text-sm text-muted">Calculando…</p> : null}
      {state.error ? <p className="text-sm text-neg">{state.error}</p> : null}
      {dist ? (
        <Panel title="Propuesta">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>Caja {dist.cashCents == null ? <span className="text-warn">no inicializada</span> : <Money cents={dist.cashCents} />}</div>
            <div>Remuneraciones devengadas sin pagar <Money cents={dist.accruedUnpaidCents} /></div>
            <div>Otras obligaciones <Money cents={dist.otherObligationsCents} /></div>
            <div>Déficit <Money cents={dist.deficitCents} /></div>
            <div>Excedente distribuible <Money cents={dist.surplusCents} /></div>
            <div>Política {dist.policyOk ? "válida" : "no suma 100%"}</div>
          </dl>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="flex justify-between"><span>Reinversión</span><Money cents={dist.buckets.reinversion} /></li>
            <li className="flex justify-between"><span>Reserva</span><Money cents={dist.buckets.reserva} /></li>
            <li className="flex justify-between"><span>Fondo de remuneraciones</span><Money cents={dist.buckets.fondoRemuneraciones} /></li>
            <li className="flex justify-between"><span>Formación e innovación</span><Money cents={dist.buckets.formacion} /></li>
          </ul>
          <p className="mt-3 text-sm text-muted">{dist.note}</p>
          <p className="mt-1 text-xs text-muted">Política inicial de referencia: reinversión {formatBps(5000)}, reserva {formatBps(2000)}, fondo {formatBps(2500)}, formación {formatBps(500)}.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button tone="ghost" onClick={async () => {
              const result = await run(() => storeProposal({ data: { period } }), "Propuesta guardada para el cierre.");
              if (result.ok) refresh();
            }}>Guardar propuesta</Button>
          </div>
        </Panel>
      ) : null}
      {can(session.actor.roles, "cerrarMes") ? (
        <Panel title="Decisión del CEO">
          <textarea className={control + " min-h-28"} value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="Qué se paga, qué se reserva y qué se reinvierte." />
          <div className="mt-3">
            <Button onClick={async () => {
              const result = await run(() => decideDistribution({ data: { period, decision } }), "Decisión registrada. No ejecuta los pagos por sí sola.");
              if (result.ok) refresh();
            }}>Registrar decisión</Button>
          </div>
        </Panel>
      ) : null}
      <Panel title="Asignaciones del período">
        {state.data && state.data.allocations.length === 0 ? <p className="text-sm text-muted">Todavía no hay una decisión aprobada. Los porcentajes de arriba son propuesta, no dinero asignado.</p> : null}
        <ul className="space-y-2 text-sm">
          {state.data?.allocations.map((row: any) => (
            <li key={String(row.id)} className="flex justify-between gap-3">
              <span>{String(row.bucket)} · {String(row.status)}</span>
              <Money cents={Number(row.amount_cents)} />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
