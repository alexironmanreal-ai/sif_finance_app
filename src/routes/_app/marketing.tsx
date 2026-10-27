import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { fetchCampaigns, saveCampaign } from "@/lib/sif/api";
import { parseArsToCents } from "@/lib/sif/money";
import { can } from "@/lib/sif/permissions";
import { useSif } from "@/components/sif/shell";
import { Badge, Button, Empty, Field, Money, Panel, control, run, useLoad } from "@/components/sif/ui";

export const Route = createFileRoute("/_app/marketing")({ component: Marketing });

function Marketing() {
  const { tick, refresh, session } = useSif();
  const state = useLoad(() => fetchCampaigns(), [tick]);
  const writable = can(session.actor.roles, "marketingEscribir");
  const [form, setForm] = useState({ name: "", startsOn: new Date().toISOString().slice(0, 10), endsOn: "", objective: "", budget: "", spend: "", channels: "", contacts: "0", qualifiedContacts: "0", meetings: "0", notes: "", evidence: "", contentNotes: "" });

  async function submit() {
    const result = await run(
      () =>
        saveCampaign({
          data: {
            ...form,
            budgetCents: parseArsToCents(form.budget) ?? 0,
            actualSpendCents: parseArsToCents(form.spend) ?? 0,
            contacts: Number(form.contacts),
            qualifiedContacts: Number(form.qualifiedContacts),
            meetings: Number(form.meetings),
          },
        }),
      "Campaña guardada.",
    );
    if (result.ok) refresh();
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Marketing</h1>
        <p className="text-sm text-muted">Una venta no se atribuye solo porque ocurrió durante la campaña. El criterio queda registrado en la venta.</p>
      </header>
      {writable ? (
        <Panel title="Nueva campaña">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre"><input className={control} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Objetivo"><input className={control} value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} /></Field>
            <Field label="Inicio"><input type="date" className={control} value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></Field>
            <Field label="Fin"><input type="date" className={control} value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></Field>
            <Field label="Presupuesto"><input className={control} value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></Field>
            <Field label="Gasto declarado"><input className={control} value={form.spend} onChange={(e) => setForm({ ...form, spend: e.target.value })} /></Field>
            <Field label="Canales"><input className={control} value={form.channels} onChange={(e) => setForm({ ...form, channels: e.target.value })} /></Field>
            <Field label="Contenido"><input className={control} value={form.contentNotes} onChange={(e) => setForm({ ...form, contentNotes: e.target.value })} /></Field>
            <Field label="Contactos"><input className={control} value={form.contacts} onChange={(e) => setForm({ ...form, contacts: e.target.value })} /></Field>
            <Field label="Cualificados"><input className={control} value={form.qualifiedContacts} onChange={(e) => setForm({ ...form, qualifiedContacts: e.target.value })} /></Field>
            <Field label="Reuniones"><input className={control} value={form.meetings} onChange={(e) => setForm({ ...form, meetings: e.target.value })} /></Field>
            <Field label="Evidencias"><input className={control} value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} /></Field>
          </div>
          <div className="mt-3"><Button onClick={submit}>Guardar campaña</Button></div>
        </Panel>
      ) : null}
      {state.data && state.data.campaigns.length === 0 ? <Empty title="Sin campañas" body="Cargá una campaña para evaluar costo por contacto cualificado y ventas realmente atribuibles." /> : null}
      <div className="grid gap-3">
        {state.data?.campaigns.map((row: any) => {
          const assessment = state.data?.assessments.find((a: any) => a.campaignId === String(row.id));
          return (
            <Panel key={String(row.id)} title={String(row.name)}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={assessment?.verdict === "rentable" ? "ok" : assessment?.verdict === "insuficiente" ? "warn" : "neutral"}>
                  {assessment?.verdict === "rentable" ? "Rentable" : assessment?.verdict === "insuficiente" ? "Resultado insuficiente" : "Sin dato de margen"}
                </Badge>
                <span className="text-muted">{String(row.channels)}</span>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>Presupuesto <Money cents={Number(row.budget_cents)} /></div>
                <div>Gasto declarado <Money cents={Number(row.actual_spend_cents)} /></div>
                <div>Contactos {String(row.contacts)} · cualificados {String(row.qualified_contacts)} · reuniones {String(row.meetings)}</div>
                <div>Ventas atribuibles {assessment?.attributedSales ?? 0}</div>
                <div>Cobrado atribuible <Money cents={assessment?.collectedCents ?? 0} /></div>
                <div>Costo por cualificado {assessment?.cacCents == null ? "No calculable" : <Money cents={assessment.cacCents} />}</div>
                <div>Margen atribuible {assessment?.contributionCents == null ? "Faltan costos reales" : <Money cents={assessment.contributionCents} />}</div>
              </dl>
              <p className="mt-2 text-xs text-muted">{assessment?.note} Premio automático: ninguno.</p>
              <p className="mt-1 text-xs text-muted">Id para atribuir una venta: {String(row.id)}</p>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
