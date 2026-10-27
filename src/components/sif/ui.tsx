import { useEffect, useState, type ReactNode } from "react";
import { formatArs } from "@/lib/sif/money";
import { toast } from "sonner";

export const control =
  "min-h-11 w-full rounded-md border border-line bg-bg px-3 text-sm text-fg outline-none placeholder:text-muted focus:border-primary";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Button({
  children,
  tone = "primary",
  type = "button",
  disabled,
  onClick,
}: {
  children: ReactNode;
  tone?: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  const tones = {
    primary: "bg-primary text-primary-ink hover:opacity-90",
    ghost: "border border-line bg-raised text-fg hover:border-primary",
    danger: "bg-neg text-primary-ink hover:opacity-90",
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium disabled:opacity-50 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export function Panel({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-md border border-line bg-surface">
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "bad" | "info" }) {
  const tones = {
    neutral: "border-line text-muted",
    ok: "border-pos/40 text-pos",
    warn: "border-warn/40 text-warn",
    bad: "border-neg/40 text-neg",
    info: "border-primary/40 text-primary",
  };
  return <span className={`inline-flex rounded-sm border px-1.5 py-0.5 text-xs ${tones[tone]}`}>{children}</span>;
}

export function Money({ cents, muted }: { cents: number | null; muted?: boolean }) {
  if (cents == null) return <span className="num text-warn">Sin dato real</span>;
  const tone = cents < 0 ? "text-neg" : "text-fg";
  return <span className={`num ${muted ? "text-muted" : tone}`}>{formatArs(cents)}</span>;
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-dashed border-line px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-3 sm:items-center" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-md border border-line bg-surface p-4 shadow-none">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-medium">{title}</h2>
          <button type="button" className="min-h-11 px-2 text-sm text-muted" onClick={onClose}>
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ loading: boolean; error: string; data: T | null }>({
    loading: true,
    error: "",
    data: null,
  });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    loader()
      .then((data) => {
        if (live) setState({ loading: false, error: "", data });
      })
      .catch((error: unknown) => {
        if (!live) return;
        const message = error instanceof Error ? error.message : "No se pudieron cargar los datos.";
        setState({ loading: false, error: message, data: null });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export async function run(action: () => Promise<unknown>, ok?: string) {
  try {
    const result = await action();
    if (ok) toast.success(ok);
    return { ok: true as const, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo completar la operación.";
    toast.error(message);
    return { ok: false as const, result: null };
  }
}

export function statusLabel(value: string) {
  const map: Record<string, string> = {
    prospecto: "Prospecto",
    negociacion: "En negociación",
    cerrada_pendiente: "Cerrada, pendiente de cobro",
    parcial: "Parcialmente cobrada",
    cobrada: "Cobrada",
    cancelada: "Cancelada",
    reembolsada: "Reembolsada",
    sin_cobro: "Sin cobro",
    reembolsado: "Reembolsado",
    cobrado: "Cobrado",
    pendiente: "Pendiente",
    calculado: "Calculado",
    aprobado: "Aprobado",
    pagado: "Pagado",
    rechazado: "Rechazado",
    reinvertido: "Reinvertido",
    aceptado: "Aceptado",
    en_revision: "En revisión",
    en_progreso: "En progreso",
    planificado: "Planificado",
    en_curso: "En curso",
    entregado: "Entregado",
    pausado: "Pausado",
    estimado: "Estimado",
    devengado: "Devengado",
    pendiente_pago: "Pendiente de pago",
    abierto: "Abierto",
    cerrado: "Cerrado",
    real: "Real",
    propuesto: "Propuesto",
    insuficiente: "Incompleto",
    sin_dato: "Sin decisión",
  };
  return map[value] ?? value;
}

export function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const body = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
