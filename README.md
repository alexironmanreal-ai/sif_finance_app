# SIF Finance

Sistema interno de gestión financiera de SIF (Strategic Intelligence Firm): ventas, cobros, gastos, comisiones, hitos, evaluación mensual y cierre.

La interfaz está en español. Los importes se guardan en centavos y se muestran en pesos argentinos (ARS).

## Correrlo en localhost

Hace falta Node.js 22 o superior.

```bash
git clone https://github.com/alexironmanreal-ai/sif_finance_app.git
cd sif_finance_app
npm install
npm run dev
```

Abrí [http://localhost:8080](http://localhost:8080).

La primera cuenta que se cree queda como CEO. La contraseña tiene que tener al menos 8 caracteres.

Sin `DATABASE_URL`, la app usa Postgres embebido (PGLite) en memoria. Los datos se pierden al detener el servidor. Para persistirlos, definí una base Postgres y un secreto estable antes de `npm run dev`:

```bash
export DATABASE_URL="postgres://usuario:clave@localhost:5432/sif"
export BETTER_AUTH_SECRET="un-secreto-largo-y-aleatorio"
export BETTER_AUTH_URL="http://localhost:8080"
npm run dev
```

## Comandos útiles

```bash
npm run typecheck
npm test
node --experimental-strip-types --test src/lib/sif/engine.test.ts
```
