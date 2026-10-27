import { createFileRoute } from "@tanstack/react-router";
import { fetchReport } from "@/lib/sif/api";
import { csvMoney, formatArs, labelPeriod } from "@/lib/sif/money";
import { useSif } from "@/components/sif/shell";
import { Badge, Button, Money, Panel, downloadCsv, statusLabel, useLoad } from "@/components/sif/ui";

export const Route = createFileRoute("/_app/informes")({ component: Informes });

function Informes() {
  const { period, tick } = useSif();
  const state = useLoad(() => fetchReport({ data: { period } }), [period, tick]);
  const data = state.data;

  function csv() {
    if (!data || data.scope !== "global") return;
    const rows: Array<Array<string | number>> = [["Concepto", "Importe", "Estado", "Nota"]];
    for (const kpi of data.report.kpis) rows.push([kpi.label, csvMoney(kpi.cents), kpi.status, kpi.note]);
    rows.push([]);
    rows.push(["Persona", "Tipo", "Estado", "Calculado", "Aprobado", "Pagado", "Fórmula"]);
    for (const row of data.comps) {
      rows.push([
        String(row.user_name),
        String(row.kind),
        String(row.status),
        csvMoney(Number(row.calculated_cents)),
        csvMoney(row.approved_cents == null ? null : Number(row.approved_cents)),
        csvMoney(Number(row.paid_cents)),
        String(row.formula),
      ]);
    }
    downloadCsv(`sif-finance-${period}.csv`, rows);
  }

  return (
    <div className="space-y-4">
      <header className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium">Informe para el CEO</h1>
          <p className="text-sm text-muted">{labelPeriod(period)}. Las conclusiones salen de lo registrado. Si falta un dato, se dice.</p>
        </div>
        <div className="flex gap-2">
          <Button tone="ghost" onClick={() => window.print()}>Exportar PDF</Button>
          {data?.scope === "global" ? <Button tone="ghost" onClick={csv}>Exportar CSV</Button> : null}
        </div>
      </header>
      {state.loading ? <p className="text-sm text-muted">Preparando el informe…</p> : null}
      {state.error ? <p className="text-sm text-neg">{state.error}</p> : null}
      {data?.scope === "personal" ? (
        <Panel title="Tu informe">
          <p className="text-sm text-muted">No tenés acceso al informe global. Estas son tus remuneraciones y objetivos.</p>
          <ul className="mt-3 space-y-2 text-sm">
            {data.comps.map((row: any) => (
              <li key={String(row.id)}>{statusLabel(String(row.kind))} · <Money cents={Number(row.calculated_cents)} /> · {String(row.formula)}</li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {data?.scope === "global" ? (
        <article className="print-sheet space-y-4">
          {data.closing?.status === "cerrado" || data.report.frozen ? (
            <p className="text-sm">Este período está cerrado. La foto del cierre no se modifica. Los ajustes posteriores se listan aparte y no reemplazan el informe.</p>
          ) : (
            <p className="text-sm text-warn">Período todavía abierto. Este informe es provisional.</p>
          )}
          <Panel title="Resumen financiero">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              {data.report.kpis.map((kpi: any) => (
                <p key={kpi.id} className="flex items-center justify-between gap-3">
                  <span>{kpi.label} <Badge>{statusLabel(kpi.status)}</Badge></span>
                  <Money cents={kpi.cents} />
                </p>
              ))}
            </div>
          </Panel>
          <Panel title="Ventas">
            <ul className="space-y-1 text-sm">
              {data.sales.filter((s: any) => String(s.closed_on ?? s.created_on).startsWith(period)).map((s: any) => (
                <li key={String(s.id)}>{String(s.code)} · {String(s.client_name)} · {String(s.product_name)} · {statusLabel(String(s.sale_status))} · {formatArs(Number(s.total_cents))}</li>
              ))}
              {data.sales.filter((s: any) => String(s.closed_on ?? "").startsWith(period)).length === 0 ? <li>No hay ventas cerradas en el período.</li> : null}
            </ul>
          </Panel>
          <Panel title="Marketing">
            <ul className="space-y-1 text-sm">
              {data.report.marketing.length === 0 ? <li>Sin campañas. No se infieren canales eficaces.</li> : data.report.marketing.map((c: any) => (
                <li key={c.campaignId}>{c.name}: {c.verdict}. Atribuibles {c.attributedSales}. Cobrado {formatArs(c.collectedCents)}. {c.note}</li>
              ))}
            </ul>
          </Panel>
          <Panel title="Desarrollo">
            <ul className="space-y-1 text-sm">
              {data.projects.map((p: any) => <li key={String(p.id)}>{String(p.name)} · {statusLabel(String(p.status))}</li>)}
              {data.milestones.filter((m: any) => m.status !== "aceptado").map((m: any) => <li key={String(m.id)}>Pendiente: {String(m.title)} · {statusLabel(String(m.status))}</li>)}
            </ul>
          </Panel>
          <Panel title="Desempeño">
            <ul className="space-y-1 text-sm">
              {data.objectives.length === 0 ? <li>No hay objetivos cargados. No se evalúa por cantidad de tareas.</li> : data.objectives.map((o: any) => (
                <li key={String(o.id)}>{String(o.title)} · {o.met == null ? "sin resultado" : o.met ? "cumplido" : "no cumplido"} {String(o.justification || "")}</li>
              ))}
              {data.contributions.map((c: any) => <li key={String(c.id)}>{String(c.category)}: {String(c.title)}. {c.verifiable ? "Verificable." : "Sin verificación."}</li>)}
            </ul>
          </Panel>
          <Panel title="Remuneraciones">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="text-muted"><tr><th>Persona</th><th>Tipo</th><th>Estado</th><th>Calculado</th><th>Aprobado</th><th>Pagado</th></tr></thead>
                <tbody>
                  {data.comps.map((row: any) => (
                    <tr key={String(row.id)} className="border-t border-line">
                      <td className="py-2">{String(row.user_name)}<p className="text-xs text-muted">{String(row.formula)}</p></td>
                      <td>{statusLabel(String(row.kind))}</td>
                      <td>{statusLabel(String(row.status))}</td>
                      <td><Money cents={Number(row.calculated_cents)} /></td>
                      <td>{row.approved_cents == null ? "—" : <Money cents={Number(row.approved_cents)} />}</td>
                      <td><Money cents={Number(row.paid_cents)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Distribución">
            <p className="text-sm">{data.report.distribution.note}</p>
            <p className="mt-2 text-sm">Déficit <Money cents={data.report.distribution.deficitCents} /> · excedente <Money cents={data.report.distribution.surplusCents} /></p>
          </Panel>
          <Panel title="Decisiones y límites">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {data.report.warnings.map((w: any) => <li key={w.message}>{w.message}</li>)}
              {data.report.warnings.length === 0 ? <li>No hay una limitación marcada por falta de datos en este período.</li> : null}
              {data.adjustments.map((a: any) => <li key={String(a.summary)}>Ajuste posterior: {String(a.summary)} ({String(a.reason)})</li>)}
              {data.closing?.ceo_decision ? <li>Decisión registrada: {String(data.closing.ceo_decision)}</li> : <li>Todavía no hay una decisión del CEO guardada en el cierre.</li>}
            </ul>
          </Panel>
        </article>
      ) : null}
    </div>
  );
}
