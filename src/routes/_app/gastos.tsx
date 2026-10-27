import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { fetchExpenses, payExpense, payObligation, saveExpense, saveObligation } from "@/lib/sif/api";
import { parseArsToCents } from "@/lib/sif/money";
import { useSif } from "@/components/sif/shell";
import { Badge, Button, Empty, Field, Money, Panel, control, run, statusLabel, useLoad } from "@/components/sif/ui";

export const Route = createFileRoute("/_app/gastos")({ component: Gastos });

function Gastos() {
  const { tick, refresh } = useSif();
  const state = useLoad(() => fetchExpenses(), [tick]);
  const [form, setForm] = useState({ spentOn: new Date().toISOString().slice(0, 10), category: "operativo", vendor: "", description: "", amount: "", status: "devengado", receipt: "", notes: "" });
  const [obl, setObl] = useState({ description: "", amount: "", dueOn: "" });

  async function submit() {
    const amountCents = parseArsToCents(form.amount);
    if (amountCents == null) return;
    const result = await run(() => saveExpense({ data: { ...form, amountCents, isEstimate: form.status === "estimado" } }), "Gasto registrado.");
    if (result.ok) refresh();
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Gastos y costos</h1>
        <p className="text-sm text-muted">Los estimados no entran al resultado. El costo directo de una venta se carga en la venta, no se vuelve a restar acá.</p>
      </header>
      <Panel title="Nuevo gasto">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fecha"><input type="date" className={control} value={form.spentOn} onChange={(e) => setForm({ ...form, spentOn: e.target.value })} /></Field>
          <Field label="Categoría">
            <select className={control} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {["operativo", "marketing", "impuesto", "honorarios", "otro"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Proveedor"><input className={control} value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} /></Field>
          <Field label="Descripción"><input className={control} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Importe"><input className={control} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="Estado">
            <select className={control} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {["estimado", "devengado", "pendiente_pago", "pagado"].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </Field>
          <Field label="Comprobante"><input className={control} value={form.receipt} onChange={(e) => setForm({ ...form, receipt: e.target.value })} /></Field>
          <Field label="Notas"><input className={control} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
        <div className="mt-3"><Button onClick={submit}>Guardar gasto</Button></div>
      </Panel>
      <Panel title="Registrados">
        {state.loading ? <p className="text-sm text-muted">Cargando…</p> : null}
        {state.error ? <p className="text-sm text-neg">{state.error}</p> : null}
        {state.data && state.data.expenses.length === 0 ? <Empty title="Sin gastos" body="Los gastos reales del período se listan acá, con su estado de pago." /> : null}
        <ul className="space-y-3">
          {state.data?.expenses.map((row: any) => (
            <li key={String(row.id)} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3 text-sm">
              <div>
                <p>{String(row.description)} · {String(row.category)}</p>
                <p className="text-muted">{String(row.spent_on).slice(0, 10)} {row.receipt ? `· ${row.receipt}` : "· sin comprobante"}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={row.is_estimate ? "warn" : "neutral"}>{statusLabel(String(row.status))}</Badge>
                <Money cents={Number(row.amount_cents)} />
                {row.status !== "pagado" && row.status !== "estimado" ? (
                  <Button tone="ghost" onClick={async () => {
                    const result = await run(() => payExpense({ data: { id: row.id, paidOn: new Date().toISOString().slice(0, 10) } }), "Pago registrado.");
                    if (result.ok) refresh();
                  }}>Pagar</Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Obligaciones">
        <div className="grid gap-3 sm:grid-cols-3">
          <input className={control} placeholder="Descripción" value={obl.description} onChange={(e) => setObl({ ...obl, description: e.target.value })} />
          <input className={control} placeholder="Importe" value={obl.amount} onChange={(e) => setObl({ ...obl, amount: e.target.value })} />
          <input type="date" className={control} value={obl.dueOn} onChange={(e) => setObl({ ...obl, dueOn: e.target.value })} />
        </div>
        <div className="mt-3">
          <Button onClick={async () => {
            const amountCents = parseArsToCents(obl.amount);
            if (amountCents == null) return;
            const result = await run(() => saveObligation({ data: { description: obl.description, amountCents, dueOn: obl.dueOn || undefined } }), "Obligación registrada.");
            if (result.ok) refresh();
          }}>Agregar obligación</Button>
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          {state.data?.obligations.map((row: any) => (
            <li key={String(row.id)} className="flex items-center justify-between gap-2">
              <span>{String(row.description)} · {statusLabel(String(row.status))}</span>
              <span className="flex items-center gap-2">
                <Money cents={Number(row.amount_cents)} />
                {row.status === "pendiente" ? <Button tone="ghost" onClick={async () => {
                  const result = await run(() => payObligation({ data: { id: row.id, paidOn: new Date().toISOString().slice(0, 10) } }), "Obligación pagada.");
                  if (result.ok) refresh();
                }}>Pagar</Button> : null}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Movimientos de caja">
        {state.data && state.data.movements.length === 0 ? <p className="text-sm text-muted">Todavía no hay movimientos. La caja no se muestra como cero hasta inicializarla en Configuración.</p> : null}
        <ul className="space-y-1 text-sm">
          {state.data?.movements.map((m: any) => (
            <li key={String(m.id)} className="flex justify-between gap-3">
              <span>{String(m.moved_on).slice(0, 10)} · {String(m.description)}</span>
              <span className={m.direction === "salida" ? "text-neg" : "text-pos"}>{m.direction === "salida" ? "−" : "+"}<Money cents={Number(m.amount_cents)} /></span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
