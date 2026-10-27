import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { fetchAudit, fetchSettings, saveRule, saveSettings } from "@/lib/sif/api";
import { formatBps, parseArsToCents } from "@/lib/sif/money";
import { can } from "@/lib/sif/permissions";
import { useSif } from "@/components/sif/shell";
import { Button, Field, Panel, control, run, useLoad } from "@/components/sif/ui";

export const Route = createFileRoute("/_app/configuracion")({ component: Configuracion });

function Configuracion() {
  const { session, tick, refresh } = useSif();
  const state = useLoad(() => fetchSettings(), [tick]);
  const audit = useLoad(() => (can(session.actor.roles, "auditoria") ? fetchAudit() : Promise.resolve([])), [tick, session.actor.userId]);
  const settings = state.data?.settings;
  const [form, setForm] = useState<null | Record<string, string | boolean>>(null);
  const [rule, setRule] = useState({ name: "", rate: "", notes: "Regla agregada por el CEO. No altera ventas bloqueadas." });
  const current = form ?? (settings
    ? {
        reinversion: String(settings.reinversionBps / 100),
        reserva: String(settings.reservaBps / 100),
        fondo: String(settings.fondoBps / 100),
        formacion: String(settings.formacionBps / 100),
        standard: String(settings.commissionStandardBps / 100),
        superior: String(settings.commissionSuperiorBps / 100),
        margin: String(settings.superiorMinMarginBps / 100),
        base: settings.commissionBase,
        opening: (settings.openingCashCents / 100).toFixed(2).replace(".", ","),
        independent: settings.independentApproval,
      }
    : null);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Configuración y auditoría</h1>
        <p className="text-sm text-muted">Cambiar una regla no reescribe las ventas ya cerradas. Cada cambio queda en la auditoría.</p>
      </header>
      {state.loading ? <p className="text-sm text-muted">Cargando política…</p> : null}
      {state.error ? <p className="text-sm text-neg">{state.error}</p> : null}
      {current && settings ? (
        <Panel title="Política financiera">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Reinversión %"><input className={control} disabled={!state.data?.canEdit} value={String(current.reinversion)} onChange={(e) => setForm({ ...current, reinversion: e.target.value })} /></Field>
            <Field label="Reserva %"><input className={control} disabled={!state.data?.canEdit} value={String(current.reserva)} onChange={(e) => setForm({ ...current, reserva: e.target.value })} /></Field>
            <Field label="Fondo de remuneraciones %"><input className={control} disabled={!state.data?.canEdit} value={String(current.fondo)} onChange={(e) => setForm({ ...current, fondo: e.target.value })} /></Field>
            <Field label="Formación %"><input className={control} disabled={!state.data?.canEdit} value={String(current.formacion)} onChange={(e) => setForm({ ...current, formacion: e.target.value })} /></Field>
            <Field label="Comisión estándar %"><input className={control} disabled={!state.data?.canEdit} value={String(current.standard)} onChange={(e) => setForm({ ...current, standard: e.target.value })} /></Field>
            <Field label="Comisión superior %"><input className={control} disabled={!state.data?.canEdit} value={String(current.superior)} onChange={(e) => setForm({ ...current, superior: e.target.value })} /></Field>
            <Field label="Margen mínimo para la superior %"><input className={control} disabled={!state.data?.canEdit} value={String(current.margin)} onChange={(e) => setForm({ ...current, margin: e.target.value })} /></Field>
            <Field label="Base por defecto">
              <select className={control} disabled={!state.data?.canEdit} value={String(current.base)} onChange={(e) => setForm({ ...current, base: e.target.value })}>
                <option value="cobrado">Importes cobrados</option>
                <option value="facturado">Importe facturado</option>
              </select>
            </Field>
            <Field label="Caja inicial" hint={settings.cashInitialized ? "Ya inicializada. Cambiarla queda auditado." : "Hasta que la guardes, el panel no va a mostrar la caja como cero real."}>
              <input className={control} disabled={!state.data?.canEdit} value={String(current.opening)} onChange={(e) => setForm({ ...current, opening: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={!state.data?.canEdit} checked={Boolean(current.independent)} onChange={(e) => setForm({ ...current, independent: e.target.checked })} />
              Exigir aprobación independiente
            </label>
          </div>
          <p className="mt-3 text-xs text-muted">Hoy la estándar es {formatBps(settings.commissionStandardBps)} y la superior {formatBps(settings.commissionSuperiorBps)}. Los parciales devengan sobre cada cobro. Los reembolsos hacen clawback con la tasa bloqueada.</p>
          {state.data?.canEdit ? (
            <div className="mt-3">
              <Button onClick={async () => {
                const result = await run(() => saveSettings({
                  data: {
                    reinversionBps: Math.round(Number(current.reinversion) * 100),
                    reservaBps: Math.round(Number(current.reserva) * 100),
                    fondoBps: Math.round(Number(current.fondo) * 100),
                    formacionBps: Math.round(Number(current.formacion) * 100),
                    commissionStandardBps: Math.round(Number(current.standard) * 100),
                    commissionSuperiorBps: Math.round(Number(current.superior) * 100),
                    superiorMinMarginBps: Math.round(Number(current.margin) * 100),
                    commissionBase: current.base,
                    openingCashCents: parseArsToCents(String(current.opening)) ?? 0,
                    independentApproval: current.independent,
                  },
                }), "Política guardada.");
                if (result.ok) {
                  setForm(null);
                  refresh();
                }
              }}>Guardar política</Button>
            </div>
          ) : <p className="mt-3 text-sm text-muted">Solo el CEO modifica la política.</p>}
        </Panel>
      ) : null}
      <Panel title="Reglas de comisión">
        <ul className="space-y-2 text-sm">
          {state.data?.rules.map((rule: any) => (
            <li key={String(rule.id)}>
              {String(rule.name)} · {formatBps(Number(rule.rate_bps))} · base {String(rule.base)} · {rule.active ? "vigente" : "inactiva"}
              <p className="text-xs text-muted">{String(rule.notes)}</p>
            </li>
          ))}
        </ul>
        {state.data?.canEdit ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Nombre"><input className={control} value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} /></Field>
            <Field label="Tasa %"><input className={control} value={rule.rate} onChange={(e) => setRule({ ...rule, rate: e.target.value })} /></Field>
            <div className="sm:col-span-2">
              <Button tone="ghost" onClick={async () => {
                if (!rule.name.trim() || !rule.rate.trim()) return;
                const result = await run(() => saveRule({ data: { name: rule.name.trim(), rateBps: Math.round(Number(rule.rate) * 100), base: "cobrado", effectiveFrom: new Date().toISOString().slice(0, 10), notes: rule.notes } }), "Regla creada.");
                if (result.ok) {
                  setRule({ name: "", rate: "", notes: rule.notes });
                  refresh();
                }
              }}>Nueva regla</Button>
            </div>
          </div>
        ) : null}
      </Panel>
      {can(session.actor.roles, "auditoria") ? (
        <Panel title="Auditoría">
          {audit.loading ? <p className="text-sm text-muted">Cargando auditoría…</p> : null}
          {audit.error ? <p className="text-sm text-neg">{audit.error}</p> : null}
          <ul className="space-y-2 text-sm">
            {audit.data?.map((row: any) => (
              <li key={String(row.id)}>
                <span className="text-muted">{String(row.created_at).replace("T", " ").slice(0, 16)}</span> · {String(row.action)} · {String(row.summary)}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
