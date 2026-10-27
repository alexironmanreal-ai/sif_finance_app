import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { fetchPeople, saveAgreement, saveContribution, saveObjective, saveObjectiveResult, saveSetterLog, setMemberActive, setMemberRole } from "@/lib/sif/api";
import { parseArsToCents } from "@/lib/sif/money";
import { ROLES, ROLE_LABEL, can, parseRoles, type Role } from "@/lib/sif/permissions";
import { useSif } from "@/components/sif/shell";
import { Badge, Button, Empty, Field, Panel, control, run, useLoad } from "@/components/sif/ui";

export const Route = createFileRoute("/_app/equipo")({ component: Equipo });

function Equipo() {
  const { period, tick, refresh, session } = useSif();
  const state = useLoad(() => fetchPeople({ data: { period } }), [period, tick]);
  const admin = can(session.actor.roles, "equipoAdmin");
  const [objective, setObjective] = useState({ userId: session.actor.userId, title: "", metric: "", targetValue: "", incentive: "", agreed: true });
  const [setter, setSetter] = useState({ contacts: "0", qualified: "0", meetingsScheduled: "0", meetingsHeld: "0", opportunitiesAccepted: "0", qualityNotes: "" });
  const [contribution, setContribution] = useState({ roleContext: String(session.actor.roles[0] ?? "ceo"), category: "actividad", title: "", detail: "", verifiable: false, evidence: "" });
  const [agreement, setAgreement] = useState({ userId: "", kind: "comision", title: "", rate: "", fixed: "", accrue: false, effectiveFrom: `${period}-01`, terms: "" });
  const [results, setResults] = useState<Record<string, { actual: string; justification: string }>>({});

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Equipo</h1>
        <p className="text-sm text-muted">Setter y closer se registran por separado. Hacer las dos funciones no duplica una comisión.</p>
      </header>
      <Panel title="Integrantes">
        {state.data && state.data.team.length === 0 ? <Empty title="Sin integrantes" body="Las personas aparecen cuando crean su cuenta. No hay usuarios ficticios." /> : null}
        <ul className="space-y-3">
          {state.data?.team.map((person: any) => {
            const roles = parseRoles(person.roles);
            return (
              <li key={person.userId} className="border-b border-line pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{person.name}</p>
                    <p className="text-xs text-muted">{person.email}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {roles.map((r) => <Badge key={r}>{ROLE_LABEL[r]}</Badge>)}
                    {!person.active ? <Badge tone="bad">Inactivo</Badge> : null}
                  </div>
                </div>
                {admin ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ROLES.filter((r) => r !== "pendiente").map((role) => (
                      <label key={role} className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={roles.includes(role)}
                          onChange={async (e) => {
                            const next = e.target.checked ? [...roles.filter((r) => r !== "pendiente"), role] : roles.filter((r) => r !== role);
                            const result = await run(() => setMemberRole({ data: { targetId: person.userId, roles: next.length ? next : ["pendiente"] } }), "Rol actualizado.");
                            if (result.ok) refresh();
                          }}
                        />
                        {ROLE_LABEL[role as Role]}
                      </label>
                    ))}
                    <Button tone="ghost" onClick={async () => {
                      const result = await run(() => setMemberActive({ data: { targetId: person.userId, active: !person.active } }), person.active ? "Persona desactivada." : "Persona activada.");
                      if (result.ok) refresh();
                    }}>{person.active ? "Desactivar" : "Activar"}</Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Panel>
      {can(session.actor.roles, "objetivosEscribir") ? (
        <Panel title="Objetivo del período">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Persona">
              <select className={control} value={objective.userId} onChange={(e) => setObjective({ ...objective, userId: e.target.value })}>
                {state.data?.team.map((p: any) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Objetivo"><input className={control} value={objective.title} onChange={(e) => setObjective({ ...objective, title: e.target.value })} /></Field>
            <Field label="Métrica"><input className={control} value={objective.metric} onChange={(e) => setObjective({ ...objective, metric: e.target.value })} /></Field>
            <Field label="Meta"><input className={control} value={objective.targetValue} onChange={(e) => setObjective({ ...objective, targetValue: e.target.value })} /></Field>
            <Field label="Incentivo si se cumple" hint="No se paga por cantidad de mensajes."><input className={control} value={objective.incentive} onChange={(e) => setObjective({ ...objective, incentive: e.target.value })} /></Field>
          </div>
          <div className="mt-3"><Button onClick={async () => {
            const result = await run(() => saveObjective({ data: { ...objective, period, incentiveCents: parseArsToCents(objective.incentive) ?? 0, agreed: true } }), "Objetivo acordado.");
            if (result.ok) refresh();
          }}>Guardar objetivo</Button></div>
        </Panel>
      ) : null}
      <Panel title="Resultados de objetivos">
        {state.data && state.data.objectives.length === 0 ? <p className="text-sm text-muted">No hay objetivos en este período.</p> : null}
        <ul className="space-y-3">
          {state.data?.objectives.map((row: any) => (
            <li key={String(row.id)} className="text-sm">
              <p>{String(row.title)} · meta {String(row.target_value || "—")} · incentivo acordado {row.agreed ? "sí" : "no"}</p>
              <p className="text-muted">Resultado: {row.met == null ? "pendiente" : row.met ? "cumplido" : "no cumplido"} {String(row.justification || "")}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                <input className={control} placeholder="Valor real observado" value={results[String(row.id)]?.actual ?? String(row.actual_value ?? "")} onChange={(e) => setResults({ ...results, [String(row.id)]: { actual: e.target.value, justification: results[String(row.id)]?.justification ?? "" } })} />
                <input className={control} placeholder="Justificación si no se cumplió" value={results[String(row.id)]?.justification ?? ""} onChange={(e) => setResults({ ...results, [String(row.id)]: { actual: results[String(row.id)]?.actual ?? String(row.actual_value ?? ""), justification: e.target.value } })} />
                <Button tone="ghost" onClick={async () => {
                  const actualValue = results[String(row.id)]?.actual ?? String(row.actual_value ?? "");
                  const result = await run(() => saveObjectiveResult({ data: { id: row.id, actualValue, met: true, evidence: actualValue } }), "Resultado cargado.");
                  if (result.ok) refresh();
                }}>Cumplido</Button>
                <Button tone="ghost" onClick={async () => {
                  const justification = results[String(row.id)]?.justification ?? "";
                  const result = await run(() => saveObjectiveResult({ data: { id: row.id, actualValue: results[String(row.id)]?.actual ?? "", met: false, justification } }), "Incumplimiento registrado.");
                  if (result.ok) refresh();
                }}>No cumplido</Button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Registro de setter">
        <div className="grid gap-3 sm:grid-cols-3">
          {([
            ["contacts", "Contactos"],
            ["qualified", "Cualificados"],
            ["meetingsScheduled", "Reuniones agendadas"],
            ["meetingsHeld", "Reuniones hechas"],
            ["opportunitiesAccepted", "Oportunidades aceptadas"],
          ] as const).map(([key, label]) => (
            <Field key={key} label={label}><input className={control} value={setter[key]} onChange={(e) => setSetter({ ...setter, [key]: e.target.value })} /></Field>
          ))}
        </div>
        <div className="mt-3"><Button onClick={async () => {
          const result = await run(() => saveSetterLog({ data: { ...setter, period, userId: session.actor.userId } }), "Registro de setter guardado.");
          if (result.ok) refresh();
        }}>Guardar mi registro</Button></div>
        <p className="mt-2 text-xs text-muted">Estos números no generan una remuneración. El incentivo sale de un objetivo acordado.</p>
      </Panel>
      <Panel title="Contribución del período">
        <p className="mb-3 text-sm text-muted">Distinguí actividad, decisión, resultado u objetivo pendiente. Solo podés registrar tu propio trabajo.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contexto">
            <select className={control} value={contribution.roleContext} onChange={(e) => setContribution({ ...contribution, roleContext: e.target.value })}>
              {session.actor.roles.map((r: Role) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </Field>
          <Field label="Tipo">
            <select className={control} value={contribution.category} onChange={(e) => setContribution({ ...contribution, category: e.target.value })}>
              {["actividad", "decision", "resultado", "pendiente", "hito_tecnico", "incidente", "documentacion", "finanzas"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Título"><input className={control} value={contribution.title} onChange={(e) => setContribution({ ...contribution, title: e.target.value })} /></Field>
          <Field label="Detalle"><input className={control} value={contribution.detail} onChange={(e) => setContribution({ ...contribution, detail: e.target.value })} /></Field>
          <Field label="Evidencia"><input className={control} value={contribution.evidence} onChange={(e) => setContribution({ ...contribution, evidence: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={contribution.verifiable} onChange={(e) => setContribution({ ...contribution, verifiable: e.target.checked })} /> Resultado verificable</label>
        </div>
        <div className="mt-3"><Button onClick={async () => {
          const result = await run(() => saveContribution({ data: { ...contribution, period } }), "Contribución registrada.");
          if (result.ok) refresh();
        }}>Registrar mi contribución</Button></div>
        <ul className="mt-4 space-y-2 text-sm">
          {state.data?.contributions.map((row: any) => (
            <li key={String(row.id)}><Badge>{String(row.category)}</Badge> {String(row.title)} — {String(row.detail)}</li>
          ))}
        </ul>
      </Panel>
      {can(session.actor.roles, "configurar") ? (
        <Panel title="Acuerdo de remuneración">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Persona">
              <select className={control} value={agreement.userId} onChange={(e) => setAgreement({ ...agreement, userId: e.target.value })}>
                <option value="">Elegir</option>
                {state.data?.team.map((p: any) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Tipo">
              <select className={control} value={agreement.kind} onChange={(e) => setAgreement({ ...agreement, kind: e.target.value })}>
                <option value="comision">Comisión del closer</option>
                <option value="ceo">Remuneración del CEO</option>
                <option value="cto">Dirección técnica</option>
              </select>
            </Field>
            <Field label="Título"><input className={control} value={agreement.title} onChange={(e) => setAgreement({ ...agreement, title: e.target.value })} /></Field>
            <Field label="Tasa % (comisión)"><input className={control} value={agreement.rate} onChange={(e) => setAgreement({ ...agreement, rate: e.target.value })} /></Field>
            <Field label="Importe mensual fijo"><input className={control} value={agreement.fixed} onChange={(e) => setAgreement({ ...agreement, fixed: e.target.value })} /></Field>
            <Field label="Vigencia"><input type="date" className={control} value={agreement.effectiveFrom} onChange={(e) => setAgreement({ ...agreement, effectiveFrom: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={agreement.accrue} onChange={(e) => setAgreement({ ...agreement, accrue: e.target.checked })} /> Proponer este fijo cada mes</label>
          </div>
          <div className="mt-3"><Button onClick={async () => {
            const result = await run(() => saveAgreement({ data: { userId: agreement.userId, kind: agreement.kind, title: agreement.title, rateBps: agreement.rate ? Math.round(Number(agreement.rate) * 100) : null, fixedCents: parseArsToCents(agreement.fixed) ?? 0, accrue: agreement.accrue, effectiveFrom: agreement.effectiveFrom, terms: agreement.terms } }), "Acuerdo guardado.");
            if (result.ok) refresh();
          }}>Guardar acuerdo</Button></div>
        </Panel>
      ) : null}
    </div>
  );
}
