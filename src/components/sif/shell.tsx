import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { RedirectToSignIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { bootstrapCeo, getSession } from "@/lib/sif/api";
import { currentPeriod, labelPeriod, shiftPeriod } from "@/lib/sif/money";
import { navigation, parseRoles, ROLE_LABEL, type Role } from "@/lib/sif/permissions";
import { Button, Field, control, useLoad } from "./ui";

type Session = Awaited<ReturnType<typeof getSession>>;

type Ctx = {
  session: Session;
  period: string;
  setPeriod: (period: string) => void;
  tick: number;
  refresh: () => void;
  reloadSession: () => void;
};

const SifContext = createContext<Ctx | null>(null);

export function useSif() {
  const value = useContext(SifContext);
  if (!value) throw new Error("Pantalla fuera del sistema.");
  return value;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  const [gen, setGen] = useState(0);
  const [period, setPeriod] = useState(currentPeriod);
  const [tick, setTick] = useState(0);
  const session = useLoad(() => getSession(), [user?.id, gen]);
  const path = useRouterState({ select: (s) => s.location.pathname });

  if (isPending || (user && session.loading && !session.data)) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <div>
          <p className="text-xs tracking-[0.22em] text-primary">SIF</p>
          <h1 className="mt-2 text-2xl font-medium">Finance</h1>
          <p className="mt-2 text-sm text-muted">Cargando la sesión y los permisos.</p>
        </div>
      </main>
    );
  }
  if (!user) return <RedirectToSignIn />;
  if (session.error) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <p className="max-w-md text-sm text-neg">{session.error}</p>
      </main>
    );
  }
  if (!session.data) return null;
  const roles = session.data.actor.roles;
  if (!session.data.actor.hasProfile) {
    return <Gate actorName={session.data.actor.name} needsBootstrap={session.data.actor.needsBootstrap} onDone={() => setGen((g) => g + 1)} />;
  }
  if (!session.data.actor.active) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <div className="max-w-md">
          <h1 className="text-xl font-medium">Usuario inactivo</h1>
          <p className="mt-2 text-sm text-muted">El CEO desactivó esta cuenta. No podés consultar información financiera.</p>
          <div className="mt-4"><UserButton /></div>
        </div>
      </main>
    );
  }
  if (roles.length === 1 && roles[0] === "pendiente") {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <div className="w-full max-w-md rounded-md border border-line bg-surface p-6">
          <p className="text-xs tracking-[0.18em] text-primary">SIF FINANCE</p>
          <h1 className="mt-2 text-xl font-medium">Acceso pendiente</h1>
          <p className="mt-2 text-sm text-muted">
            {session.data.actor.name}, tu cuenta está registrada. El CEO tiene que asignarte un rol antes de que veas información financiera. No se creó ningún usuario ficticio.
          </p>
          <div className="mt-4">
            <UserButton />
          </div>
        </div>
      </main>
    );
  }

  const items = navigation(parseRoles(roles.join(","))).filter((item) => item.show);
  const value = {
    session: session.data,
    period,
    setPeriod,
    tick,
    refresh: () => setTick((t) => t + 1),
    reloadSession: () => setGen((g) => g + 1),
  };

  return (
    <SifContext.Provider value={value}>
      <div className="min-h-screen md:grid md:grid-cols-[15.5rem_1fr]">
        <aside className="no-print border-b border-line bg-surface md:min-h-screen md:border-r md:border-b-0">
          <div className="flex items-center justify-between px-4 py-4 md:block">
            <div>
              <p className="text-xs tracking-[0.2em] text-primary">SIF</p>
              <p className="text-lg font-medium leading-tight">Finance</p>
              <p className="text-xs text-muted">Strategic Intelligence Firm</p>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1 md:px-3">
            {items.map((item) => {
              const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={`block shrink-0 rounded-md px-3 py-2 text-sm ${active ? "bg-raised text-fg" : "text-muted"}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <div className="min-w-0">
          <header className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm" onClick={() => setPeriod(shiftPeriod(period, -1))}>
                Anterior
              </button>
              <p className="min-w-36 text-center text-sm capitalize">{labelPeriod(period)}</p>
              <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm" onClick={() => setPeriod(shiftPeriod(period, 1))}>
                Siguiente
              </button>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted">{roles.map((r: Role) => ROLE_LABEL[r] ?? r).join(" · ")}</span>
              <UserButton />
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl px-4 py-5">{children}</main>
        </div>
      </div>
    </SifContext.Provider>
  );
}

function Gate({ actorName, needsBootstrap, onDone }: { actorName: string; needsBootstrap: boolean; onDone: () => void }) {
  const [name, setName] = useState(actorName);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function enter() {
    setPending(true);
    setMessage("");
    try {
      const result = await bootstrapCeo({ data: { name } });
      if (result.role !== "ceo" && needsBootstrap) {
        setMessage("Otra persona inicializó la firma. Tu acceso quedó pendiente de asignación.");
      }
      onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo ingresar.");
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-md rounded-md border border-line bg-surface p-6">
        <p className="text-xs tracking-[0.18em] text-primary">SIF FINANCE</p>
        <h1 className="mt-2 text-xl font-medium">{needsBootstrap ? "Inicializar la firma" : "Solicitar acceso"}</h1>
        <p className="mt-2 text-sm text-muted">
          {needsBootstrap
            ? "No hay integrantes cargados. La primera cuenta real se convierte en CEO. No se crea ningún usuario de demostración."
            : "SIF ya tiene un CEO. Tu cuenta quedará pendiente hasta que te asignen un rol."}
        </p>
        <div className="mt-4">
          <Field label="Nombre para el equipo">
            <input className={control} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        {message ? <p className="mt-3 text-sm text-warn">{message}</p> : null}
        <div className="mt-4 flex gap-2">
          <Button disabled={pending} onClick={enter}>
            {needsBootstrap ? "Asumir el rol de CEO" : "Solicitar acceso"}
          </Button>
          <UserButton />
        </div>
      </div>
    </main>
  );
}

export function usePeriodLabel() {
  const { period } = useSif();
  return useMemo(() => labelPeriod(period), [period]);
}
