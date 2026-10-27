import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getDashboard } from "@/lib/sif/api";
import { formatArs } from "@/lib/sif/money";
import { useSif } from "@/components/sif/shell";
import { Badge, Empty, Money, Panel, statusLabel, useLoad } from "@/components/sif/ui";

export const Route = createFileRoute("/_app/")({ component: Dashboard });

function Dashboard() {
  const { period, tick } = useSif();
  const state = useLoad(() => getDashboard({ data: { period } }), [period, tick]);
  if (state.loading) return <p className="text-sm text-muted">Cargando el período…</p>;
  if (state.error) return <p className="text-sm text-neg">{state.error}</p>;
  const data = state.data;
  if (!data) return null;
  if (data.scope === "personal") {
    return (
      <div className="space-y-4">
        <header>
          <h1 className="text-2xl font-medium">Tu panel</h1>
          <p className="text-sm text-muted">La información financiera global está restringida al CEO y al responsable financiero.</p>
        </header>
        <Panel title="Tus remuneraciones del período">
          {data.comps.length === 0 ? (
            <Empty title="Sin remuneraciones registradas" body="Cuando el cierre calcule un importe a tu nombre, va a aparecer acá con su fórmula. No hay cifras estimadas." />
          ) : (
            <ul className="space-y-3">
              {data.comps.map((row: any) => (
                <li key={String(row.id)} className="border-b border-line pb-3">
                  <div className="flex justify-between gap-3">
                    <span>{statusLabel(String(row.kind))}</span>
                    <Money cents={Number(row.calculated_cents)} />
                  </div>
                  <p className="mt-1 text-sm text-muted">{String(row.formula)}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Tus hitos">
          {data.milestones.length === 0 ? (
            <Empty title="Sin hitos asignados" body="Los pagos de proyecto aparecen solo cuando un hito a tu nombre se acepta." />
          ) : (
            <ul className="space-y-2 text-sm">
              {data.milestones.map((m: any) => (
                <li key={String(m.id)} className="flex justify-between gap-3">
                  <span>{String(m.project_name)} · {String(m.title)}</span>
                  <Badge>{statusLabel(String(m.status))}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    );
  }

  const kpis = data.report.kpis;
  const chart = [
    { name: "Cobrado", valor: Math.max(0, data.report.cobrado) / 100 },
    { name: "Costos", valor: Math.max(0, data.report.costos) / 100 },
    { name: "Gastos", valor: Math.max(0, data.report.gastos) / 100 },
    { name: "Resultado", valor: data.report.resultado / 100 },
  ];
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium">Panel financiero</h1>
          <p className="text-sm text-muted">Facturación, cobros y caja son cifras distintas. Un propuesto no es dinero registrado.</p>
        </div>
        <Badge tone={data.report.closingStatus.status === "cerrado" ? "ok" : "info"}>
          Período {statusLabel(data.report.closingStatus.status)}
        </Badge>
      </header>
      {data.report.frozen ? (
        <p className="text-sm">Período cerrado. El panel muestra la foto del cierre. Los movimientos posteriores quedan como ajustes y no reemplazan estas cifras.</p>
      ) : null}
      {data.report.warnings.length > 0 ? (
        <Panel title="Advertencias">
          <ul className="space-y-2 text-sm">
            {data.report.warnings.map((w: any) => (
              <li key={w.message} className={w.level === "bloqueo" ? "text-neg" : "text-warn"}>
                {w.message}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((kpi: any) => (
          <article key={kpi.id} className="rounded-md border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm text-muted">{kpi.label}</h2>
              <Badge tone={kpi.status === "real" ? "ok" : kpi.status === "propuesto" ? "info" : "warn"}>{statusLabel(kpi.status)}</Badge>
            </div>
            <p className="mt-3 text-xl">
              <Money cents={kpi.status === "insuficiente" && kpi.cents == null ? null : kpi.cents} />
            </p>
            {kpi.deltaCents != null ? (
              <p className={`num mt-1 text-xs ${kpi.deltaCents < 0 ? "text-neg" : "text-pos"}`}>
                {kpi.deltaCents >= 0 ? "+" : ""}
                {formatArs(kpi.deltaCents)} vs. período anterior
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted">Sin comparación suficiente.</p>
            )}
            <p className="mt-2 text-xs text-muted">{kpi.note}</p>
          </article>
        ))}
      </div>
      <Panel title="Composición del período">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <XAxis dataKey="name" stroke="#8ea0b5" fontSize={12} />
              <YAxis stroke="#8ea0b5" fontSize={12} />
              <Tooltip formatter={(value) => formatArs(Math.round(Number(value) * 100))} />
              <Bar dataKey="valor" fill="#6ea8e8" radius={3} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-muted">El gráfico usa pesos, no centavos. El resultado negativo se muestra debajo de cero y no se recorta.</p>
      </Panel>
      {data.adjustments.length > 0 ? (
        <Panel title="Ajustes posteriores al cierre">
          <ul className="space-y-2 text-sm">
            {data.adjustments.map((a: any) => (
              <li key={String(a.id)}>{String(a.summary)} — {String(a.reason)}</li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
