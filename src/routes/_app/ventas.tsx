import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { addPayment, addRefund, fetchSale, fetchSales, saveSale } from "@/lib/sif/api";
import { parseArsToCents } from "@/lib/sif/money";
import { useSif } from "@/components/sif/shell";
import { Badge, Button, Empty, Field, Modal, Money, Panel, control, run, statusLabel, useLoad } from "@/components/sif/ui";

export const Route = createFileRoute("/_app/ventas")({ component: Ventas });

const empty = {
  clientName: "",
  productName: "",
  description: "",
  total: "",
  createdOn: new Date().toISOString().slice(0, 10),
  closedOn: "",
  status: "prospecto",
  estimated: "",
  actual: "",
  closerUserId: "",
  originatorUserId: "",
  campaignId: "",
  attributionCriterion: "",
  commissionChoice: "politica",
  customBps: "",
  documents: "",
  notes: "",
  reason: "",
};

function Ventas() {
  const { tick, refresh, session, period } = useSif();
  const state = useLoad(() => fetchSales(), [tick]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const team = useLoad(() => import("@/lib/sif/api").then((m) => m.fetchPeople({ data: { period } })), [tick, period]);
  const people = team.data?.team ?? [];
  const canWrite = session.actor.roles.some((r: any) => r === "ceo" || r === "finanzas" || r === "closer");

  function set<K extends keyof typeof empty>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    const totalCents = parseArsToCents(form.total);
    if (totalCents == null) return;
    const actual = form.actual.trim() ? parseArsToCents(form.actual) : null;
    const estimated = form.estimated.trim() ? parseArsToCents(form.estimated) ?? 0 : 0;
    const result = await run(
      () =>
        saveSale({
          data: {
            id: editId ?? undefined,
            createdOn: form.createdOn,
            closedOn: form.closedOn || undefined,
            clientName: form.clientName,
            productName: form.productName,
            description: form.description,
            totalCents,
            status: form.status,
            directCostEstimatedCents: estimated,
            directCostActualCents: actual,
            closerUserId: form.closerUserId || undefined,
            originatorUserId: form.originatorUserId || undefined,
            campaignId: form.campaignId || undefined,
            attributionCriterion: form.attributionCriterion,
            commissionChoice: form.commissionChoice,
            customBps: form.customBps ? Number(form.customBps) * 100 : undefined,
            documents: form.documents,
            notes: form.notes,
            reason: form.reason,
          },
        }),
      editId ? "Venta actualizada." : "Venta registrada.",
    );
    if (result.ok) {
      setOpen(false);
      refresh();
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium">Ventas</h1>
          <p className="text-sm text-muted">Una cancelación no genera comisión nueva. Los cobros parciales quedan registrados uno por uno.</p>
        </div>
        {canWrite ? (
          <Button
            onClick={() => {
              setEditId(null);
              setForm(empty);
              setOpen(true);
            }}
          >
            Registrar venta
          </Button>
        ) : null}
      </header>
      <Panel>
        {state.loading ? <p className="text-sm text-muted">Cargando ventas…</p> : null}
        {state.error ? <p className="text-sm text-neg">{state.error}</p> : null}
        {state.data && state.data.length === 0 ? (
          <Empty title="No hay ventas" body="Cuando registres una operación va a aparecer acá. No hay datos de demostración mezclados." />
        ) : null}
        {state.data && state.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 font-medium">Código</th>
                  <th className="font-medium">Cliente</th>
                  <th className="font-medium">Estado</th>
                  <th className="font-medium">Total</th>
                  <th className="font-medium">Cobrado neto</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.data.map((row: any) => (
                  <tr key={String(row.id)} className="border-t border-line">
                    <td className="py-3 num">{String(row.code)}</td>
                    <td>{String(row.client_name)}</td>
                    <td><Badge>{statusLabel(String(row.sale_status))}</Badge></td>
                    <td><Money cents={Number(row.total_cents)} /></td>
                    <td><Money cents={Number(row.net_collected_cents)} /></td>
                    <td>
                      <button type="button" className="min-h-11 text-primary" onClick={() => setSelected(String(row.id))}>
                        Abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>
      <Modal open={open} title={editId ? "Editar venta" : "Nueva venta"} onClose={() => setOpen(false)}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cliente"><input className={control} value={form.clientName} onChange={(e) => set("clientName", e.target.value)} /></Field>
          <Field label="Producto o servicio"><input className={control} value={form.productName} onChange={(e) => set("productName", e.target.value)} /></Field>
          <Field label="Importe total" hint="Usá coma para decimales. Ejemplo: 150.000,00"><input className={control} value={form.total} onChange={(e) => set("total", e.target.value)} /></Field>
          <Field label="Estado">
            <select className={control} value={form.status} onChange={(e) => set("status", e.target.value)}>
              {["prospecto", "negociacion", "cerrada_pendiente", "parcial", "cobrada", "cancelada", "reembolsada"].map((s) => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </select>
          </Field>
          <Field label="Fecha de creación"><input type="date" className={control} value={form.createdOn} onChange={(e) => set("createdOn", e.target.value)} /></Field>
          <Field label="Fecha de cierre"><input type="date" className={control} value={form.closedOn} onChange={(e) => set("closedOn", e.target.value)} /></Field>
          <Field label="Costo directo estimado"><input className={control} value={form.estimated} onChange={(e) => set("estimated", e.target.value)} /></Field>
          <Field label="Costo directo real" hint="Si lo dejás vacío, el margen no se calcula como real."><input className={control} value={form.actual} onChange={(e) => set("actual", e.target.value)} /></Field>
          <Field label="Closer">
            <select className={control} value={form.closerUserId} onChange={(e) => set("closerUserId", e.target.value)}>
              <option value="">Sin asignar</option>
              {people.map((p: any) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Quién captó al cliente">
            <select className={control} value={form.originatorUserId} onChange={(e) => set("originatorUserId", e.target.value)}>
              <option value="">Sin asignar</option>
              {people.map((p: any) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Campaña (id)" hint="Opcional. No atribuye la venta solo por la fecha."><input className={control} value={form.campaignId} onChange={(e) => set("campaignId", e.target.value)} /></Field>
          <Field label="Criterio de atribución"><input className={control} value={form.attributionCriterion} onChange={(e) => set("attributionCriterion", e.target.value)} /></Field>
          <Field label="Comisión">
            <select className={control} value={form.commissionChoice} onChange={(e) => set("commissionChoice", e.target.value)}>
              <option value="politica">Según política</option>
              <option value="estandar">Estándar</option>
              <option value="superior">Superior</option>
              <option value="especial">Especial (solo CEO)</option>
            </select>
          </Field>
          <Field label="Tasa especial (%)" hint="Solo si elegís especial. Se bloquea al cerrar."><input className={control} value={form.customBps} onChange={(e) => set("customBps", e.target.value)} /></Field>
          <Field label="Comprobantes"><input className={control} value={form.documents} onChange={(e) => set("documents", e.target.value)} /></Field>
          <Field label="Observaciones"><input className={control} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          {editId ? <Field label="Motivo si el período está cerrado o cambiás la tasa"><input className={control} value={form.reason} onChange={(e) => set("reason", e.target.value)} /></Field> : null}
        </div>
        <div className="mt-4"><Button onClick={submit}>Guardar</Button></div>
      </Modal>
      {selected ? <SaleDrawer id={selected} onClose={() => { setSelected(null); refresh(); }} canWrite={canWrite} /> : null}
    </div>
  );
}

function SaleDrawer({ id, onClose, canWrite }: { id: string; onClose: () => void; canWrite: boolean }) {
  const state = useLoad(() => fetchSale({ data: { id } }), [id]);
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState("transferencia");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundOn, setRefundOn] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const { refresh } = useSif();

  async function pay() {
    const amountCents = parseArsToCents(amount);
    if (amountCents == null) return;
    const result = await run(
      () => addPayment({ data: { saleId: id, paidOn, amountCents, method, reference, reason, idempotencyKey: crypto.randomUUID(), notes: "" } }),
      "Cobro registrado.",
    );
    if (result.ok) refresh();
  }
  async function refund() {
    const amountCents = parseArsToCents(refundAmount);
    if (amountCents == null) return;
    const result = await run(
      () => addRefund({ data: { saleId: id, refundedOn: refundOn, amountCents, reason: refundReason, idempotencyKey: crypto.randomUUID() } }),
      "Reembolso registrado.",
    );
    if (result.ok) refresh();
  }

  const detail = state.data;
  return (
    <Modal open title="Detalle de la venta" onClose={onClose}>
      {state.loading ? <p className="text-sm text-muted">Cargando…</p> : null}
      {state.error ? <p className="text-sm text-neg">{state.error}</p> : null}
      {detail ? (
        <div className="space-y-4 text-sm">
          <p className="num">{String(detail.sale.code)} · {String(detail.sale.client_name)}</p>
          <p>{String(detail.sale.product_name)} · <Badge>{statusLabel(String(detail.sale.sale_status))}</Badge></p>
          <p>Total <Money cents={Number(detail.sale.total_cents)} /> · cobro {statusLabel(String(detail.sale.collection_status))}</p>
          {detail.sale.commission_locked ? (
            <p>Tasa bloqueada: {Number(detail.sale.commission_rate_bps) / 100}% · {String(detail.sale.commission_rule_name)} · base {String(detail.sale.commission_base)}</p>
          ) : (
            <p className="text-muted">La comisión todavía no está bloqueada. Se fija al cerrar o al registrar el primer cobro.</p>
          )}
          <Panel title="Cobros">
            {detail.payments.length === 0 ? <p className="text-muted">Sin cobros.</p> : (
              <ul>{detail.payments.map((p: any) => <li key={String(p.id)} className="flex justify-between py-1"><span>{String(p.paid_on).slice(0, 10)} · {String(p.reference || p.method)}</span><Money cents={Number(p.amount_cents)} /></li>)}</ul>
            )}
            {canWrite ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <input type="date" className={control} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                <input className={control} placeholder="Importe" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <input className={control} placeholder="Referencia" value={reference} onChange={(e) => setReference(e.target.value)} />
                <input className={control} placeholder="Medio" value={method} onChange={(e) => setMethod(e.target.value)} />
                <input className={control} placeholder="Motivo si el mes está cerrado" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button onClick={pay}>Registrar cobro</Button>
              </div>
            ) : null}
          </Panel>
          <Panel title="Reembolsos">
            {detail.refunds.length === 0 ? <p className="text-muted">Sin reembolsos.</p> : (
              <ul>{detail.refunds.map((r: any) => <li key={String(r.id)}>{String(r.refunded_on).slice(0, 10)} · {String(r.reason)} · <Money cents={Number(r.amount_cents)} /></li>)}</ul>
            )}
            {canWrite ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <input type="date" className={control} value={refundOn} onChange={(e) => setRefundOn(e.target.value)} />
                <input className={control} placeholder="Importe" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
                <input className={control} placeholder="Motivo" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
                <Button tone="ghost" onClick={refund}>Registrar reembolso</Button>
              </div>
            ) : null}
          </Panel>
          <Panel title="Fórmula de comisión">
            {detail.lines.length === 0 ? <p className="text-muted">Todavía no hay comisión calculable.</p> : (
              <ul className="space-y-2">
                {detail.lines.map((line: any) => (
                  <li key={line.idempotencyKey}>
                    <Money cents={line.calculatedCents} />
                    <p className="text-muted">{line.formula}</p>
                    <p className="text-xs text-muted">{line.provenance}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}
    </Modal>
  );
}
