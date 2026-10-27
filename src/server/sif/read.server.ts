import { suggestCommissions } from "@/lib/sif/engine.ts";
import { inPeriod, isPeriod } from "@/lib/sif/money.ts";
import { can, canSeeGlobalFinance } from "@/lib/sif/permissions.ts";
import { SifError, assertMember, assertPerm, db, loadActor, readSettings } from "./context.server.ts";
import { loadFacts, reportPeriod } from "./facts.server.ts";

function periodOf(value: string) {
  if (!isPeriod(value)) throw new SifError("El período no es válido.");
  return value;
}

export async function session(userId: string) {
  const actor = await loadActor(userId);
  const sql = await db();
  const settings = actor.hasProfile && actor.active && !actor.needsBootstrap ? await readSettings(sql) : null;
  const closing = actor.hasProfile
    ? await sql<{ period: string; status: string }>`
        select period, status from monthly_closings order by period desc limit 12
      `
    : [];
  return { actor, settings, closings: closing };
}

export async function dashboard(userId: string, rawPeriod: string) {
  const actor = await loadActor(userId);
  assertMember(actor);
  const p = periodOf(rawPeriod);
  const sql = await db();
  if (!canSeeGlobalFinance(actor.roles)) {
    const comps = await sql<Record<string, unknown>>`
      select * from compensation_records where user_id = ${userId} and period = ${p} order by created_at desc
    `;
    const milestones = await sql<Record<string, unknown>>`
      select m.*, p.name as project_name from milestones m
      join projects p on p.id = m.project_id
      where m.assignee_user_id = ${userId}
      order by m.created_at desc
    `;
    const objectives = await sql<Record<string, unknown>>`
      select * from performance_objectives where user_id = ${userId} and period = ${p}
    `;
    return { scope: "personal" as const, period: p, comps, milestones, objectives, actor };
  }
  const report = await reportPeriod(sql, p);
  const adjustments = await sql<Record<string, unknown>>`
    select id, period, entity_type, entity_id, reason, summary, created_at::text as created_at
    from closing_adjustments where period = ${p} order by created_at desc
  `;
  return { scope: "global" as const, period: p, report, adjustments, actor };
}

export async function listTeam(userId: string) {
  const actor = await loadActor(userId);
  assertMember(actor);
  const sql = await db();
  const rows = await sql<{ user_id: string; name: string; email: string; roles: string; active: boolean }>`
    select user_id, name, email, roles, active from profiles order by name
  `;
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    email: can(actor.roles, "equipoAdmin") ? r.email : "",
    roles: r.roles,
    active: r.active,
  }));
}

export async function listSales(userId: string) {
  const actor = await loadActor(userId);
  assertMember(actor);
  const sql = await db();
  const seeAll = can(actor.roles, "ventasVerTodas");
  if (!seeAll && !can(actor.roles, "ventasVerPropias") && !can(actor.roles, "ventasEscribir")) {
    throw new SifError("No tenés permiso para consultar ventas.");
  }
  const rows = seeAll
    ? await sql<Record<string, unknown>>`select * from sales order by created_on desc, code desc`
    : await sql<Record<string, unknown>>`
        select * from sales
        where closer_user_id = ${userId} or originator_user_id = ${userId} or created_by = ${userId}
        order by created_on desc, code desc
      `;
  const payments = await sql<Record<string, unknown>>`select sale_id, amount_cents from sale_payments`;
  const refunds = await sql<Record<string, unknown>>`select sale_id, amount_cents from refunds`;
  return rows.map((s) => {
    const paid = payments.filter((p) => p.sale_id === s.id).reduce((a, p) => a + Number(p.amount_cents), 0);
    const back = refunds.filter((r) => r.sale_id === s.id).reduce((a, r) => a + Number(r.amount_cents), 0);
    return { ...s, net_collected_cents: paid - back };
  });
}

export async function saleDetail(userId: string, saleId: string) {
  const actor = await loadActor(userId);
  assertMember(actor);
  const sql = await db();
  const sales = await sql<Record<string, unknown>>`select * from sales where id = ${saleId}`;
  const sale = sales[0];
  if (!sale) throw new SifError("La venta no existe.");
  const seeAll = can(actor.roles, "ventasVerTodas");
  const own = sale.closer_user_id === userId || sale.originator_user_id === userId || sale.created_by === userId;
  if (!seeAll && !own) throw new SifError("No tenés permiso para ver esta venta.");
  const payments = await sql<Record<string, unknown>>`select * from sale_payments where sale_id = ${saleId} order by paid_on`;
  const refunds = await sql<Record<string, unknown>>`select * from refunds where sale_id = ${saleId} order by refunded_on`;
  const audit = can(actor.roles, "auditoria") || can(actor.roles, "ventasVerTodas")
    ? await sql<Record<string, unknown>>`
        select action, summary, created_at::text as created_at from audit_logs
        where entity_type = 'sale' and entity_id = ${saleId} order by created_at desc limit 30
      `
    : [];
  const facts = await loadFacts(sql, "2000-01");
  const fact = facts.sales.find((s) => s.id === saleId);
  const periods = new Set<string>();
  for (const p of facts.payments.filter((p) => p.saleId === saleId)) periods.add(p.paidOn.slice(0, 7));
  for (const r of facts.refunds.filter((r) => r.saleId === saleId)) periods.add(r.refundedOn.slice(0, 7));
  if (fact?.closedOn) periods.add(fact.closedOn.slice(0, 7));
  const lines = fact ? [...periods].flatMap((p) => suggestCommissions([fact], facts.payments, facts.refunds, p)) : [];
  const hideMoney = !seeAll && sale.originator_user_id === userId && sale.closer_user_id !== userId && !actor.roles.includes("closer");
  return {
    sale: hideMoney ? { ...sale, commission_rate_bps: null, commission_rule_name: "" } : sale,
    payments,
    refunds,
    audit,
    lines: hideMoney ? [] : lines,
  };
}

export async function listExpenses(userId: string) {
  const actor = await loadActor(userId);
  assertPerm(actor, "gastos");
  const sql = await db();
  const expenses = await sql<Record<string, unknown>>`select * from expenses order by spent_on desc`;
  const obligations = await sql<Record<string, unknown>>`select * from obligations order by created_at desc`;
  const movements = await sql<Record<string, unknown>>`select * from cash_movements order by moved_on desc, created_at desc limit 80`;
  return { expenses, obligations, movements };
}

export async function listCampaigns(userId: string) {
  const actor = await loadActor(userId);
  assertPerm(actor, "marketingVer");
  const sql = await db();
  const facts = await loadFacts(sql, "2000-01");
  const report = (await import("@/lib/sif/engine.ts")).buildPeriod({ ...facts, period: "2000-01" });
  const campaigns = await sql<Record<string, unknown>>`select * from campaigns order by starts_on desc`;
  return { campaigns, assessments: report.marketing };
}

export async function listProjects(userId: string) {
  const actor = await loadActor(userId);
  assertPerm(actor, "proyectosVer");
  const sql = await db();
  const seeAll = actor.roles.some((r) => r === "ceo" || r === "cto" || r === "finanzas");
  const projects = seeAll
    ? await sql<Record<string, unknown>>`select * from projects order by created_at desc`
    : await sql<Record<string, unknown>>`
        select distinct p.* from projects p
        left join project_members m on m.project_id = p.id
        left join milestones h on h.project_id = p.id
        where p.owner_user_id = ${userId} or m.user_id = ${userId} or h.assignee_user_id = ${userId}
        order by p.created_at desc
      `;
  const ids = projects.map((p) => String(p.id));
  const milestones = ids.length
    ? await sql<Record<string, unknown>>`select * from milestones order by sort_order, created_at`
    : [];
  const members = ids.length
    ? await sql<Record<string, unknown>>`select * from project_members`
    : [];
  const visible = new Set(ids);
  return {
    projects,
    milestones: milestones.filter((m) => visible.has(String(m.project_id))),
    members: members.filter((m) => visible.has(String(m.project_id))),
  };
}

export async function listPeopleOps(userId: string, rawPeriod: string) {
  const actor = await loadActor(userId);
  assertMember(actor);
  const p = periodOf(rawPeriod);
  const sql = await db();
  const team = await listTeam(userId);
  const objectives = can(actor.roles, "objetivosEscribir") || can(actor.roles, "panelGlobal")
    ? await sql<Record<string, unknown>>`select * from performance_objectives where period = ${p} order by created_at desc`
    : await sql<Record<string, unknown>>`select * from performance_objectives where period = ${p} and user_id = ${userId}`;
  const setter = can(actor.roles, "panelGlobal")
    ? await sql<Record<string, unknown>>`select * from setter_logs where period = ${p}`
    : await sql<Record<string, unknown>>`select * from setter_logs where period = ${p} and user_id = ${userId}`;
  const contributions = can(actor.roles, "panelGlobal")
    ? await sql<Record<string, unknown>>`select * from contributions where period = ${p} order by created_at desc`
    : await sql<Record<string, unknown>>`select * from contributions where period = ${p} and user_id = ${userId} order by created_at desc`;
  const agreements = can(actor.roles, "configurar")
    ? await sql<Record<string, unknown>>`select * from compensation_agreements order by effective_from desc`
    : await sql<Record<string, unknown>>`select * from compensation_agreements where user_id = ${userId} and active = true`;
  return { team, objectives, setter, contributions, agreements };
}

export async function listCompensation(userId: string, rawPeriod: string) {
  const actor = await loadActor(userId);
  assertMember(actor);
  const p = periodOf(rawPeriod);
  const sql = await db();
  const all = can(actor.roles, "remuneracionesTodas");
  const rows = all
    ? await sql<Record<string, unknown>>`select * from compensation_records where period = ${p} order by kind, user_id`
    : await sql<Record<string, unknown>>`select * from compensation_records where period = ${p} and user_id = ${userId} order by kind`;
  const names = await sql<{ user_id: string; name: string }>`select user_id, name from profiles`;
  const map = new Map(names.map((n) => [n.user_id, n.name]));
  return rows.map((r) => ({ ...r, user_name: map.get(String(r.user_id)) || "Integrante" }));
}

export async function distribution(userId: string, rawPeriod: string) {
  const actor = await loadActor(userId);
  assertPerm(actor, "distribucion");
  const p = periodOf(rawPeriod);
  const sql = await db();
  const report = await reportPeriod(sql, p);
  const allocations = await sql<Record<string, unknown>>`select * from allocations where period = ${p} order by created_at`;
  const snapshot = await sql<{ snapshot: unknown; status: string; ceo_decision: string }>`
    select snapshot, status, ceo_decision from monthly_closings where period = ${p}
  `;
  return { report, allocations, closing: snapshot[0] ?? null };
}

export async function closingPack(userId: string, rawPeriod: string) {
  const actor = await loadActor(userId);
  assertPerm(actor, "distribucion");
  const p = periodOf(rawPeriod);
  const sql = await db();
  const report = await reportPeriod(sql, p);
  const facts = await loadFacts(sql, p);
  const contributions = await sql<Record<string, unknown>>`select * from contributions where period = ${p}`;
  const history = await sql<{ period: string; status: string; closed_at: string | null; ceo_decision: string }>`
    select period, status, closed_at::text as closed_at, ceo_decision
    from monthly_closings order by period desc limit 24
  `;
  return {
    report,
    contributions,
    payments: facts.payments.filter((row) => inPeriod(row.paidOn, p)),
    refunds: facts.refunds.filter((row) => inPeriod(row.refundedOn, p)),
    expenses: facts.expenses.filter((row) => inPeriod(row.spentOn, p)),
    obligations: facts.obligations,
    milestones: facts.milestones,
    objectives: facts.objectives.filter((row) => row.period === p),
    movements: facts.movements.filter((row) => inPeriod(row.movedOn, p)),
    history,
  };
}

export async function report(userId: string, rawPeriod: string) {
  const actor = await loadActor(userId);
  assertMember(actor);
  const p = periodOf(rawPeriod);
  const sql = await db();
  if (!can(actor.roles, "informesGlobales")) {
    const comps = await listCompensation(userId, p);
    const objectives = await sql<Record<string, unknown>>`
      select * from performance_objectives where user_id = ${userId} and period = ${p}
    `;
    return { scope: "personal" as const, period: p, comps, objectives };
  }
  const built = await reportPeriod(sql, p);
  const sales = await sql<Record<string, unknown>>`select * from sales order by closed_on desc nulls last`;
  const projects = await sql<Record<string, unknown>>`select id, name, status, kind from projects`;
  const milestones = await sql<Record<string, unknown>>`select id, project_id, title, status, amount_cents, accepted_on from milestones`;
  const objectives = await sql<Record<string, unknown>>`select * from performance_objectives where period = ${p}`;
  const contributions = await sql<Record<string, unknown>>`select * from contributions where period = ${p}`;
  const comps = await listCompensation(userId, p);
  const snapshot = await sql<Record<string, unknown>>`
    select snapshot, status, ceo_decision, closed_at::text as closed_at from monthly_closings where period = ${p}
  `;
  const adjustments = await sql<Record<string, unknown>>`
    select reason, summary, created_at::text as created_at from closing_adjustments where period = ${p} order by created_at
  `;
  return {
    scope: "global" as const,
    period: p,
    report: built,
    sales,
    projects,
    milestones,
    objectives,
    contributions,
    comps,
    closing: snapshot[0] ?? null,
    adjustments,
  };
}

export async function auditLog(userId: string) {
  const actor = await loadActor(userId);
  assertPerm(actor, "auditoria");
  const sql = await db();
  return sql<Record<string, unknown>>`
    select id, actor_id, action, entity_type, entity_id, summary, created_at::text as created_at
    from audit_logs order by created_at desc limit 200
  `;
}

export async function settingsView(userId: string) {
  const actor = await loadActor(userId);
  assertMember(actor);
  const sql = await db();
  const settings = await readSettings(sql);
  const rules = await sql<Record<string, unknown>>`select * from commission_rules order by effective_from`;
  const agreements = can(actor.roles, "configurar")
    ? await sql<Record<string, unknown>>`select * from compensation_agreements order by created_at desc`
    : [];
  return { settings, rules, agreements, canEdit: can(actor.roles, "configurar") };
}
