import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { decideCompensation, fetchCompensation, materialize, payCompensation } from "@/lib/sif/api";
import { parseArsToCents } from "@/lib/sif/money";
import { can } from "@/lib/sif/permissions";
import { useSif } from "@/components/sif/shell";
import { Badge, Button, Empty, Money, Panel, control, run, statusLabel, useLoad } from "@/components/sif/ui";

export const Route = createFileRoute("/_app/remuneraciones")({ component: Remuneraciones });

function Remuneraciones() {
  const { period, tick, refresh, session } = useSif();
  const state = useLoad(() => fetchCompensation({ data: { period } }), [period, tick]);
  const [pay, setPay] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const global = can(session.actor.roles, "remuneracionesTodas");

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium">Remuneraciones</h1>
          <p className="text-sm text-muted">Comisión, hito, incentivo y dirección no se mezclan. Calcular no es pagar.</p>
        </div>
        {can(session.actor.roles, "panelGlobal") ? (
          <Button onClick={async () => {
            const result = await run(() => materialize({ data: { period } }), "Cálculo registrado como pendiente.");
            if (result.ok) refresh();
          }}>Calcular período</Button>
        ) : null}
      </header>
      {!global ? <p className="text-sm text-muted">Estás viendo solo tus registros.</p> : null}
      {state.loading ? <p className="text-sm text-muted">Cargando…</p> : null}
      {state.error ? <p className="text-sm text-neg">{state.error}</p> : null}
      {state.data && state.data.length === 0 ? (
        <Empty title="Sin remuneraciones en el período" body="Ejecutá el cálculo después de cargar cobros, hitos aceptados u objetivos cumplidos. No se inventan importes." />
      ) : null}
      <div className="space-y-3">
        {state.data?.map((row: any) => (
          <Panel key={String(row.id)}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{String(row.user_name)} · {statusLabel(String(row.kind))}</p>
                <p className="mt-1 text-sm text-muted">{String(row.formula)}</p>
                <p className="mt-1 text-xs text-muted">{String(row.provenance)}</p>
              </div>
              <div className="text-right">
                <Badge>{statusLabel(String(row.status))}</Badge>
                <p className="mt-2">Calculado <Money cents={Number(row.calculated_cents)} /></p>
                <p className="text-sm text-muted">Aprobado {row.approved_cents == null ? "—" : <Money cents={Number(row.approved_cents)} />}</p>
                <p className="text-sm text-muted">Pagado <Money cents={Number(row.paid_cents)} /></p>
              </div>
            </div>
            {can(session.actor.roles, "aprobarPagos") && (row.status === "pendiente" || row.status === "calculado") ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <input className={control} placeholder="Justificación, obligatoria si sos la única firma o es tu propio pago" value={note[String(row.id)] ?? ""} onChange={(e) => setNote({ ...note, [String(row.id)]: e.target.value })} />
                <Button onClick={async () => {
                  const result = await run(() => decideCompensation({ data: { id: row.id, decision: "aprobar", justification: note[String(row.id)] ?? "" } }), "Aprobado. Todavía no está pagado.");
                  if (result.ok) refresh();
                }}>Aprobar</Button>
                <Button tone="ghost" onClick={async () => {
                  const result = await run(() => decideCompensation({ data: { id: row.id, decision: "rechazar", justification: note[String(row.id)] ?? "" } }), "Rechazado.");
                  if (result.ok) refresh();
                }}>Rechazar</Button>
              </div>
            ) : null}
            {session.actor.roles.includes("ceo") && row.kind === "ceo" && String(row.user_id) === session.actor.userId && row.status !== "rechazado" && !row.reinvested ? (
              <div className="mt-3">
                <Button tone="ghost" onClick={async () => {
                  const result = await run(() => decideCompensation({ data: { id: row.id, decision: "reinvertir", justification: "El CEO reinvierte su remuneración. El importe sigue registrado." } }), "Remuneración reinvertida. Sigue existiendo.");
                  if (result.ok) refresh();
                }}>Reinvertir mi remuneración</Button>
              </div>
            ) : null}
            {can(session.actor.roles, "registrarPagos") && (row.status === "aprobado" || row.status === "parcial") ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <input className={control + " max-w-xs"} placeholder="Importe a pagar" value={pay[String(row.id)] ?? ""} onChange={(e) => setPay({ ...pay, [String(row.id)]: e.target.value })} />
                <Button onClick={async () => {
                  const amountCents = parseArsToCents(pay[String(row.id)] ?? "");
                  if (amountCents == null) return;
                  const result = await run(() => payCompensation({ data: { id: row.id, amountCents, paidOn: new Date().toISOString().slice(0, 10), reason: note[String(row.id)] ?? "" } }), "Pago registrado.");
                  if (result.ok) refresh();
                }}>Registrar pago</Button>
              </div>
            ) : null}
          </Panel>
        ))}
      </div>
    </div>
  );
}
