import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { fetchProjects, reviewMilestone, saveMilestone, saveProject } from "@/lib/sif/api";
import { parseArsToCents } from "@/lib/sif/money";
import { can } from "@/lib/sif/permissions";
import { useSif } from "@/components/sif/shell";
import { Badge, Button, Empty, Field, Money, Panel, control, run, statusLabel, useLoad } from "@/components/sif/ui";

export const Route = createFileRoute("/_app/proyectos")({ component: Proyectos });

function Proyectos() {
  const { tick, refresh, session, period } = useSif();
  const state = useLoad(() => fetchProjects(), [tick]);
  const people = useLoad(() => import("@/lib/sif/api").then((m) => m.fetchPeople({ data: { period } })), [tick, period]);
  const writable = can(session.actor.roles, "proyectosEscribir");
  const [form, setForm] = useState({ name: "", kind: "cliente", budget: "", pay: "", funding: false, criteria: "", notes: "", memberIds: [] as string[] });
  const [milestone, setMilestone] = useState({ projectId: "", title: "", amount: "", assigneeUserId: "", evidence: "" });
  const [review, setReview] = useState<{ id: string; decision: "aceptado" | "rechazado"; notes: string } | null>(null);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-medium">Proyectos y desarrollo</h1>
        <p className="text-sm text-muted">La remuneración se devenga por hito aceptado. Un porcentaje de avance no cierra el proyecto ni genera un pago.</p>
      </header>
      {writable ? (
        <Panel title="Nuevo proyecto">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre"><input className={control} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Tipo">
              <select className={control} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="cliente">Cliente</option>
                <option value="interno">Producto interno</option>
              </select>
            </Field>
            <Field label="Presupuesto"><input className={control} value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></Field>
            <Field label="Presupuesto de remuneración"><input className={control} value={form.pay} onChange={(e) => setForm({ ...form, pay: e.target.value })} /></Field>
            <Field label="Criterios de aceptación"><input className={control} value={form.criteria} onChange={(e) => setForm({ ...form, criteria: e.target.value })} /></Field>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={form.funding} onChange={(e) => setForm({ ...form, funding: e.target.checked })} /> Financiación aprobada</label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {people.data?.team.map((p: any) => (
              <label key={p.userId} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.memberIds.includes(p.userId)} onChange={(e) => setForm({ ...form, memberIds: e.target.checked ? [...form.memberIds, p.userId] : form.memberIds.filter((id) => id !== p.userId) })} />
                {p.name}
              </label>
            ))}
          </div>
          <div className="mt-3">
            <Button onClick={async () => {
              const result = await run(() => saveProject({ data: { name: form.name, kind: form.kind, budgetCents: parseArsToCents(form.budget) ?? 0, compensationBudgetCents: parseArsToCents(form.pay) ?? 0, fundingApproved: form.funding, acceptanceCriteria: form.criteria, notes: form.notes, memberIds: form.memberIds } }), "Proyecto creado.");
              if (result.ok) refresh();
            }}>Crear proyecto</Button>
          </div>
        </Panel>
      ) : null}
      {state.data && state.data.projects.length === 0 ? <Empty title="Sin proyectos" body="Los hitos y sus importes se cargan sobre un proyecto. Hasta que se aceptan, no hay remuneración." /> : null}
      {state.data?.projects.map((project: any) => {
        const milestones = state.data?.milestones.filter((m: any) => m.project_id === project.id) ?? [];
        const sum = milestones.reduce((s: any, m: any) => s + Number(m.amount_cents), 0);
        return (
          <Panel key={String(project.id)} title={String(project.name)}>
            <p className="text-sm text-muted">{project.kind === "interno" ? "Producto interno" : "Cliente"} · {statusLabel(String(project.status))} · financiación {project.funding_approved ? "aprobada" : "no aprobada"}</p>
            <p className="mt-1 text-sm">Presupuesto de remuneración <Money cents={Number(project.compensation_budget_cents)} /> · hitos cargados <Money cents={sum} /></p>
            <p className="mt-1 text-sm text-muted">{String(project.acceptance_criteria || "Sin criterios de aceptación.")}</p>
            <ul className="mt-3 space-y-2">
              {milestones.map((m: any) => (
                <li key={String(m.id)} className="rounded-md border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>{String(m.title)}</span>
                    <span className="flex items-center gap-2"><Badge>{statusLabel(String(m.status))}</Badge><Money cents={Number(m.amount_cents)} /></span>
                  </div>
                  <p className="text-muted">{String(m.evidence || "Sin evidencia")}</p>
                  {m.review_notes ? <p className="text-muted">Revisión: {String(m.review_notes)}</p> : null}
                  {can(session.actor.roles, "hitosRevisar") && m.status !== "aceptado" ? (
                    <div className="mt-2 space-y-2">
                      {review?.id === String(m.id) ? (
                        <input className={control} value={review.notes} placeholder={review.decision === "aceptado" ? "Justificación de la aceptación" : "Motivo del rechazo"} onChange={(e) => setReview({ ...review, notes: e.target.value })} />
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={async () => {
                          if (review?.id !== String(m.id) || review.decision !== "aceptado") {
                            setReview({ id: String(m.id), decision: "aceptado", notes: "" });
                            return;
                          }
                          const result = await run(() => reviewMilestone({ data: { id: m.id, decision: "aceptado", notes: review.notes, acceptedOn: new Date().toISOString().slice(0, 10) } }), "Hito aceptado.");
                          if (result.ok) {
                            setReview(null);
                            refresh();
                          }
                        }}>Aceptar</Button>
                        <Button tone="ghost" onClick={async () => {
                          if (review?.id !== String(m.id) || review.decision !== "rechazado") {
                            setReview({ id: String(m.id), decision: "rechazado", notes: "" });
                            return;
                          }
                          const result = await run(() => reviewMilestone({ data: { id: m.id, decision: "rechazado", notes: review.notes } }), "Hito rechazado.");
                          if (result.ok) {
                            setReview(null);
                            refresh();
                          }
                        }}>Rechazar</Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            {writable ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <input className={control} placeholder="Nuevo hito" value={milestone.projectId === project.id ? milestone.title : ""} onChange={(e) => setMilestone({ ...milestone, projectId: String(project.id), title: e.target.value })} />
                <input className={control} placeholder="Importe" value={milestone.projectId === project.id ? milestone.amount : ""} onChange={(e) => setMilestone({ ...milestone, projectId: String(project.id), amount: e.target.value })} />
                <select className={control} value={milestone.projectId === project.id ? milestone.assigneeUserId : ""} onChange={(e) => setMilestone({ ...milestone, projectId: String(project.id), assigneeUserId: e.target.value })}>
                  <option value="">Responsable</option>
                  {people.data?.team.map((p: any) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                </select>
                <input className={control} placeholder="Evidencia" value={milestone.projectId === project.id ? milestone.evidence : ""} onChange={(e) => setMilestone({ ...milestone, projectId: String(project.id), evidence: e.target.value })} />
                <Button onClick={async () => {
                  const result = await run(() => saveMilestone({ data: { projectId: project.id, title: milestone.title, amountCents: parseArsToCents(milestone.amount) ?? 0, assigneeUserId: milestone.assigneeUserId, evidence: milestone.evidence } }), "Hito cargado.");
                  if (result.ok) refresh();
                }}>Agregar hito</Button>
              </div>
            ) : null}
          </Panel>
        );
      })}
    </div>
  );
}
