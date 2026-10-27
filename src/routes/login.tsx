import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { GROK_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    const result =
      mode === "up"
        ? await authClient.signUp.email({ email, password, name, callbackURL: "/" })
        : await authClient.signIn.email({ email, password, callbackURL: "/" });
    setPending(false);
    if (result.error) {
      const raw = result.error.message || "No se pudo ingresar.";
      toast.error(
        /already|exist/i.test(raw)
          ? "Ya existe una cuenta con ese correo."
          : /invalid|password|credential/i.test(raw)
            ? "Correo o contraseña incorrectos."
            : raw,
      );
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
      <section className="flex flex-col justify-between border-b border-line px-6 py-8 lg:border-r lg:border-b-0 lg:px-12">
        <div>
          <p className="text-xs tracking-[0.28em] text-primary">STRATEGIC INTELLIGENCE FIRM</p>
          <h1 className="mt-6 max-w-xl text-4xl font-medium leading-tight">SIF Finance</h1>
          <p className="mt-4 max-w-md text-muted">
            Cierre mensual, comisiones, hitos y distribución de caja. Los importes se calculan con reglas explícitas, no con una estimación presentada como dinero real.
          </p>
        </div>
        <p className="mt-10 text-sm text-muted">Gestión interna. Moneda predeterminada: ARS.</p>
      </section>
      <section className="flex items-center px-6 py-10 lg:px-12">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-medium">{mode === "in" ? "Ingresar" : "Crear cuenta"}</h2>
          <p className="mt-1 text-sm text-muted">La primera persona que entre inicializa el rol de CEO.</p>
          {authEnabled ? (
            <div className="mt-6 space-y-3">
              {GROK_PROVIDERS.map((provider) => (
                <button
                  key={provider.providerId}
                  type="button"
                  onClick={() => signIn(provider.providerId, { callbackURL: "/" })}
                  className="min-h-11 w-full rounded-md border border-line bg-surface px-4 text-sm hover:border-primary"
                >
                  Continuar con {provider.label}
                </button>
              ))}
              <form className="space-y-3 border-t border-line pt-4" onSubmit={submit}>
                {mode === "up" ? (
                  <input className="min-h-11 w-full rounded-md border border-line bg-bg px-3 text-sm" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} required />
                ) : null}
                <input className="min-h-11 w-full rounded-md border border-line bg-bg px-3 text-sm" type="email" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <input className="min-h-11 w-full rounded-md border border-line bg-bg px-3 text-sm" type="password" placeholder="Contraseña" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="submit" disabled={pending} className="min-h-11 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-ink disabled:opacity-50">
                  {mode === "in" ? "Ingresar con correo" : "Crear cuenta"}
                </button>
              </form>
              <button type="button" className="text-sm text-muted" onClick={() => setMode(mode === "in" ? "up" : "in")}>
                {mode === "in" ? "¿Primera vez? Crear cuenta" : "Ya tengo cuenta"}
              </button>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">El ingreso está desactivado.</p>
          )}
        </div>
      </section>
    </main>
  );
}
