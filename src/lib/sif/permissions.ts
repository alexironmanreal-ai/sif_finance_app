export const ROLES = [
  "ceo",
  "cto",
  "desarrollador",
  "cmo",
  "closer",
  "setter",
  "finanzas",
  "pendiente",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  ceo: "CEO",
  cto: "CTO",
  desarrollador: "Desarrollador",
  cmo: "CMO / Marketing",
  closer: "Closer",
  setter: "Setter",
  finanzas: "Responsable financiero",
  pendiente: "Pendiente de asignación",
};

export type Perm =
  | "panelGlobal"
  | "ventasVerTodas"
  | "ventasVerPropias"
  | "ventasEscribir"
  | "gastos"
  | "marketingVer"
  | "marketingEscribir"
  | "proyectosVer"
  | "proyectosEscribir"
  | "hitosRevisar"
  | "equipoAdmin"
  | "remuneracionesTodas"
  | "aprobarPagos"
  | "registrarPagos"
  | "distribucion"
  | "cerrarMes"
  | "configurar"
  | "auditoria"
  | "informesGlobales"
  | "objetivosEscribir";

const MATRIX: Record<Perm, Role[]> = {
  panelGlobal: ["ceo", "finanzas"],
  ventasVerTodas: ["ceo", "finanzas", "cmo"],
  ventasVerPropias: ["closer", "setter", "cto"],
  ventasEscribir: ["ceo", "finanzas", "closer"],
  gastos: ["ceo", "finanzas"],
  marketingVer: ["ceo", "finanzas", "cmo", "cto"],
  marketingEscribir: ["ceo", "cmo"],
  proyectosVer: ["ceo", "cto", "desarrollador", "finanzas"],
  proyectosEscribir: ["ceo", "cto"],
  hitosRevisar: ["ceo", "cto"],
  equipoAdmin: ["ceo"],
  remuneracionesTodas: ["ceo", "finanzas"],
  aprobarPagos: ["ceo"],
  registrarPagos: ["ceo", "finanzas"],
  distribucion: ["ceo", "finanzas"],
  cerrarMes: ["ceo"],
  configurar: ["ceo"],
  auditoria: ["ceo", "finanzas"],
  informesGlobales: ["ceo", "finanzas"],
  objetivosEscribir: ["ceo", "cto", "finanzas", "cmo"],
};

export function parseRoles(value: string | null | undefined): Role[] {
  const parts = (value ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter((r): r is Role => (ROLES as readonly string[]).includes(r));
  const real = parts.filter((r) => r !== "pendiente");
  if (real.length === 0) return ["pendiente"];
  return [...new Set(real)];
}

export function serializeRoles(roles: Role[]): string {
  const real = [...new Set(roles.filter((r) => r !== "pendiente"))];
  return real.length ? real.join(",") : "pendiente";
}

export function can(roles: Role[], perm: Perm): boolean {
  return roles.some((role) => MATRIX[perm].includes(role));
}

export function canSeeGlobalFinance(roles: Role[]): boolean {
  return can(roles, "panelGlobal");
}

export type NavItem = { href: string; label: string; show: boolean };

export function navigation(roles: Role[]): NavItem[] {
  return [
    { href: "/", label: "Panel", show: true },
    {
      href: "/ventas",
      label: "Ventas",
      show: can(roles, "ventasVerTodas") || can(roles, "ventasVerPropias") || can(roles, "ventasEscribir"),
    },
    { href: "/gastos", label: "Gastos y costos", show: can(roles, "gastos") },
    { href: "/marketing", label: "Marketing", show: can(roles, "marketingVer") },
    { href: "/proyectos", label: "Proyectos", show: can(roles, "proyectosVer") },
    { href: "/equipo", label: "Equipo", show: true },
    { href: "/evaluacion", label: "Evaluación", show: can(roles, "cerrarMes") || can(roles, "distribucion") },
    { href: "/remuneraciones", label: "Remuneraciones", show: true },
    { href: "/distribucion", label: "Distribución", show: can(roles, "distribucion") },
    { href: "/informes", label: "Informes", show: true },
    { href: "/configuracion", label: "Configuración", show: can(roles, "configurar") || can(roles, "auditoria") },
  ];
}

export function canSelfApprove(input: {
  actorId: string;
  beneficiaryId: string;
  independent: boolean;
  otherApprovers: number;
  justification: string;
}): { ok: boolean; sole: boolean; message?: string } {
  if (input.actorId !== input.beneficiaryId || !input.independent) {
    return { ok: true, sole: false };
  }
  if (input.otherApprovers > 0) {
    return {
      ok: false,
      sole: false,
      message: "La política exige una aprobación independiente. Otra persona autorizada debe aprobar este pago.",
    };
  }
  if (input.justification.trim().length < 8) {
    return {
      ok: false,
      sole: true,
      message: "No hay otro autorizador activo. Registrá una justificación de único firmante (mínimo 8 caracteres).",
    };
  }
  return { ok: true, sole: true };
}

export function canReviewDeliverable(input: {
  actorId: string;
  assigneeId: string | null;
  actorRoles: Role[];
  otherReviewers: number;
  justification: string;
}): { ok: boolean; message?: string } {
  if (!can(input.actorRoles, "hitosRevisar")) {
    return { ok: false, message: "No podés revisar entregables con tu rol actual." };
  }
  if (input.assigneeId && input.actorId === input.assigneeId) {
    if (input.otherReviewers > 0) {
      return { ok: false, message: "No podés aprobar tu propio hito si hay otro revisor." };
    }
    if (input.justification.trim().length < 8) {
      return { ok: false, message: "Único revisor: justificá la autoevaluación (mínimo 8 caracteres)." };
    }
  }
  return { ok: true };
}
