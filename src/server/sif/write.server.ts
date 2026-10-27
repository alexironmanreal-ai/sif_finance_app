import { buildPeriod, suggestCommissions } from "@/lib/sif/engine.ts";
import { isDate, isPeriod } from "@/lib/sif/money.ts";
import { canReviewDeliverable, canSelfApprove, parseRoles, serializeRoles, type Role } from "@/lib/sif/permissions.ts";
import {
  SifError,
  assertMember,
  assertPerm,
  audit,
  db,
  guardPeriod,
  isUniqueError,
  loadActor,
  nid,
  otherApprovers,
  otherReviewers,
  readSettings,
} from "./context.server.ts";
import { ensureClosing, loadFacts } from "./facts.server.ts";

const CLOSED = new Set(["cerrada_pendiente", "parcial", "cobrada", "reembolsada"]);

function text(value: unknown, label: string, max = 500): string {
  const s = String(value ?? "").trim();
  if (!s) throw new SifError(`${label} es obligatorio.`);
  if (s.length > max) throw new SifError(`${label} es demasiado largo.`);
  return s;
}

function opt(value: unknown, max = 2000): string {
  return String(value ?? "").trim().slice(0, max);
}

function cents(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new SifError(`${label} no es un importe válido.`);
  return n;
}

function period(value: unknown): string {
  const p = String(value ?? "");
  if (!isPeriod(p)) throw new SifError("El período no es válido.");
  return p;
}

async function nextCode(sql: Awaited<ReturnType<typeof db>>, year: string) {
  const rows = await sql<{ value: number }>`
    insert into sequences (name, value) values (${"sale-" + year}, 1)
    on conflict (name) do update set value = sequences.value + 1
    returning value
  `;
  const n = rows[0]?.value ?? 1;
  return `SIF-${year}-${String(n).padStart(4, "0")}`;
}

async function marginOk(sql: Awaited<ReturnType<typeof db>>, collected: number, cost: number | null) {
  const settings = await readSettings(sql);
  if (cost == null || collected <= 0) return { ok: false, settings };
  const margin = Math.floor(((collected - cost) * 10000) / collected);
  return { ok: margin >= settings.superiorMinMarginBps, settings, margin };
}

export async function bootstrapCeo(userId: string, name: string) {
  const sql = await db();
  const actor = await loadActor(userId);
  if (actor.hasProfile) return { role: actor.roles.join(","), already: true };
  const display = text(name || actor.name, "Nombre", 120);
  const rows = await sql<{ roles: string }>`
    with bump as (
      insert into sequences (name, value) values ('bootstrap', 1)
      on conflict (name) do update set value = sequences.value + 1
      returning value
    ),
    ins as (
      insert into profiles (user_id, email, name, roles)
      select ${userId}, ${actor.email}, ${display},
        case when (select value from bump) = 1 then 'ceo' else 'pendiente' end
      on conflict (user_id) do nothing
      returning roles
    )
    select roles from ins
  `;
  const roles = rows[0]?.roles ?? "pendiente";
  await audit(sql, userId, "alta", "profile", userId, roles === "ceo" ? "Inicializó SIF como CEO." : "Quedó pendiente de asignación.", null, { roles });
  return { role: roles, already: false };
}

export async function saveProfileName(userId: string, name: string) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertMember(actor);
  const display = text(name, "Nombre", 120);
  await sql`update profiles set name = ${display}, updated_at = now() where user_id = ${userId}`;
  return { ok: true };
}

export async function setMemberRole(userId: string, input: { targetId: string; roles: string[] }) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "equipoAdmin");
  const roles = parseRoles(input.roles.join(","));
  if (roles.includes("pendiente") && input.roles.length > 0 && input.roles.every((r) => r === "pendiente")) {
    /* ok */
  }
  const serialized = serializeRoles(roles.filter((r) => r !== "pendiente") as Role[]);
  if (input.targetId === actor.userId && !serialized.split(",").includes("ceo")) {
    const others = await sql<{ n: number }>`
      select count(*)::int as n from profiles where active and user_id <> ${actor.userId} and roles like '%ceo%'
    `;
    if ((others[0]?.n ?? 0) === 0) throw new SifError("Tiene que quedar al menos un CEO activo.");
  }
  const before = await sql`select roles from profiles where user_id = ${input.targetId}`;
  if (!before[0]) throw new SifError("Esa persona todavía no ingresó a SIF.");
  await sql`update profiles set roles = ${serialized}, updated_at = now() where user_id = ${input.targetId}`;
  await audit(sql, userId, "rol", "profile", input.targetId, `Roles actualizados a ${serialized}.`, before[0], { roles: serialized });
  return { ok: true };
}

export async function setMemberActive(userId: string, targetId: string, active: boolean) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "equipoAdmin");
  if (targetId === actor.userId && !active) throw new SifError("No podés desactivarte a vos mismo.");
  await sql`update profiles set active = ${active}, updated_at = now() where user_id = ${targetId}`;
  await audit(sql, userId, active ? "activar" : "desactivar", "profile", targetId, active ? "Usuario activado." : "Usuario desactivado.");
  return { ok: true };
}

type SaleInput = {
  id?: string;
  createdOn: string;
  closedOn?: string;
  clientName: string;
  productName: string;
  description?: string;
  totalCents: number;
  status: string;
  directCostEstimatedCents?: number;
  directCostActualCents?: number | null;
  closerUserId?: string;
  originatorUserId?: string;
  campaignId?: string;
  attributionCriterion?: string;
  commissionChoice?: string;
  customBps?: number;
  documents?: string;
  notes?: string;
  reason?: string;
};

async function resolveLock(
  sql: Awaited<ReturnType<typeof db>>,
  actor: Awaited<ReturnType<typeof loadActor>>,
  input: SaleInput,
  collected: number,
) {
  const settings = await readSettings(sql);
  const status = input.status;
  if (!CLOSED.has(status)) {
    return { locked: false, rate: null as number | null, ruleName: "", base: settings.commissionBase, closedOn: null as string | null };
  }
  const closedOn = input.closedOn && isDate(input.closedOn) ? input.closedOn : input.createdOn;
  if (!isDate(closedOn)) throw new SifError("La fecha de cierre no es válida.");
  const choice = input.commissionChoice || "politica";
  const cost = input.directCostActualCents == null ? null : cents(input.directCostActualCents, "Costo real");
  const margin = await marginOk(sql, collected > 0 ? collected : 0, cost);
  let rate = settings.commissionStandardBps;
  let ruleName = "Comisión estándar";
  if (choice === "estandar") {
    rate = settings.commissionStandardBps;
  } else if (choice === "superior") {
    if (!margin.ok && !actor.roles.includes("ceo")) {
      throw new SifError("La comisión superior exige margen real verificado o autorización del CEO.");
    }
    if (!margin.ok && opt(input.notes).length < 8) {
      throw new SifError("La condición especial necesita un motivo en observaciones.");
    }
    rate = settings.commissionSuperiorBps;
    ruleName = "Comisión superior";
  } else if (choice === "especial") {
    if (!actor.roles.includes("ceo")) throw new SifError("Solo el CEO puede fijar una tasa especial.");
    if (opt(input.notes).length < 8) throw new SifError("La tasa especial necesita un motivo.");
    rate = cents(input.customBps, "Tasa");
    if (rate < 0 || rate > 10000) throw new SifError("La tasa está fuera de rango.");
    ruleName = "Condición especial";
  } else if (input.closerUserId) {
    const agreements = await sql<{ rate_bps: number | null; title: string }>`
      select rate_bps, title from compensation_agreements
      where user_id = ${input.closerUserId} and kind = 'comision' and active = true
        and effective_from <= ${closedOn}::date
        and (effective_to is null or effective_to >= ${closedOn}::date)
      order by effective_from desc limit 1
    `;
    if (agreements[0]?.rate_bps != null) {
      rate = Number(agreements[0].rate_bps);
      ruleName = agreements[0].title;
    } else if (margin.ok) {
      rate = settings.commissionSuperiorBps;
      ruleName = "Comisión superior";
    }
  } else if (margin.ok) {
    rate = settings.commissionSuperiorBps;
    ruleName = "Comisión superior";
  }
  return { locked: true, rate, ruleName, base: settings.commissionBase, closedOn };
}

async function syncSale(sql: Awaited<ReturnType<typeof db>>, saleId: string) {
  await sql`
    with sums as (
      select s.id, s.total_cents, s.sale_status,
        coalesce((select sum(amount_cents) from sale_payments p where p.sale_id = s.id), 0) as paid,
        coalesce((select sum(amount_cents) from refunds r where r.sale_id = s.id), 0) as refunded
      from sales s where s.id = ${saleId}
    ),
    calc as (
      select *, (paid - refunded) as net from sums
    )
    update sales s set
      collection_status = case
        when c.sale_status in ('prospecto', 'negociacion') then 'sin_cobro'
        when c.sale_status = 'cancelada' and c.net <= 0 then 'sin_cobro'
        when c.refunded > 0 and c.net <= 0 then 'reembolsado'
        when c.net <= 0 then 'sin_cobro'
        when c.net < c.total_cents then 'parcial'
        else 'cobrado'
      end,
      sale_status = case
        when c.sale_status = 'cancelada' then 'cancelada'
        when c.sale_status in ('prospecto', 'negociacion') then c.sale_status
        when c.refunded > 0 and c.net <= 0 and c.paid > 0 then 'reembolsada'
        when c.net <= 0 then 'cerrada_pendiente'
        when c.net < c.total_cents then 'parcial'
        else 'cobrada'
      end,
      updated_at = now()
    from calc c where s.id = c.id
  `;
}

export async function saveSale(userId: string, input: SaleInput) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "ventasEscribir");
  if (!isDate(input.createdOn)) throw new SifError("La fecha de creación no es válida.");
  const clientName = text(input.clientName, "Cliente", 180);
  const productName = text(input.productName, "Producto o servicio", 180);
  const total = cents(input.totalCents, "Importe");
  if (total < 0) throw new SifError("El importe no puede ser negativo.");
  const statuses = ["prospecto", "negociacion", "cerrada_pendiente", "parcial", "cobrada", "cancelada", "reembolsada"];
  if (!statuses.includes(input.status)) throw new SifError("El estado de la venta no es válido.");
  if (input.campaignId && opt(input.attributionCriterion).length < 8) {
    throw new SifError("Si vinculás una campaña, registrá el criterio de atribución (mínimo 8 caracteres). La fecha no alcanza.");
  }
  const estimated = Math.max(0, cents(input.directCostEstimatedCents ?? 0, "Costo estimado"));
  const actual = input.directCostActualCents == null || input.directCostActualCents === ("" as unknown) ? null : cents(input.directCostActualCents, "Costo real");
  if (input.id) {
    const existing = await sql<Record<string, unknown>>`select * from sales where id = ${input.id}`;
    const row = existing[0];
    if (!row) throw new SifError("La venta no existe.");
    const paidRows = await sql<{ paid: number; refunded: number }>`
      select
        coalesce((select sum(amount_cents) from sale_payments where sale_id = ${input.id}), 0) as paid,
        coalesce((select sum(amount_cents) from refunds where sale_id = ${input.id}), 0) as refunded
    `;
    const net = num0(paidRows[0]?.paid) - num0(paidRows[0]?.refunded);
    if (total < Math.max(0, net)) throw new SifError("El importe no puede quedar debajo de lo ya cobrado.");
    const touchDate = (input.closedOn && isDate(input.closedOn) ? input.closedOn : input.createdOn);
    await guardPeriod(sql, userId, touchDate, opt(input.reason), "sale", input.id, `Corrección de la venta ${row.code}.`);
    let rate = row.commission_rate_bps == null ? null : Number(row.commission_rate_bps);
    let ruleName = String(row.commission_rule_name ?? "");
    let locked = Boolean(row.commission_locked);
    let base = String(row.commission_base);
    let closedOn = row.closed_on ? String(row.closed_on).slice(0, 10) : null;
    const changingTerms =
      locked &&
      (input.commissionChoice && input.commissionChoice !== String(row.commission_choice) ||
        (input.closerUserId || "") !== String(row.closer_user_id ?? ""));
    if (changingTerms) {
      if (!actor.roles.includes("ceo")) {
        throw new SifError("La tasa ya está bloqueada. Solo el CEO puede cambiarla, dejando constancia.");
      }
      if (opt(input.reason).length < 8) throw new SifError("El cambio de condiciones necesita un motivo.");
      const resolved = await resolveLock(sql, actor, { ...input, status: CLOSED.has(input.status) ? input.status : "cerrada_pendiente" }, Math.max(net, 0));
      rate = resolved.rate;
      ruleName = resolved.ruleName;
      await audit(sql, userId, "cambio_comision", "sale", input.id, "Se autorizó un cambio de condiciones ya bloqueadas.", row, { rate, ruleName, reason: input.reason });
    } else if (!locked && CLOSED.has(input.status)) {
      const resolved = await resolveLock(sql, actor, input, Math.max(net, 0));
      rate = resolved.rate;
      ruleName = resolved.ruleName;
      locked = resolved.locked;
      base = resolved.base;
      closedOn = resolved.closedOn;
    }
    if (CLOSED.has(input.status) && !closedOn) closedOn = touchDate;
    if (!CLOSED.has(input.status) && input.status !== "cancelada") closedOn = null;
    await sql`
      update sales set
        created_on = ${input.createdOn}::date,
        closed_on = ${closedOn}::date,
        client_name = ${clientName},
        product_name = ${productName},
        description = ${opt(input.description)},
        total_cents = ${total},
        sale_status = ${input.status},
        direct_cost_estimated_cents = ${estimated},
        direct_cost_actual_cents = ${actual},
        closer_user_id = ${input.closerUserId || null},
        originator_user_id = ${input.originatorUserId || null},
        campaign_id = ${input.campaignId || null},
        attribution_criterion = ${opt(input.attributionCriterion)},
        commission_choice = ${input.commissionChoice || String(row.commission_choice)},
        commission_rate_bps = ${rate},
        commission_rule_name = ${ruleName},
        commission_base = ${base},
        commission_locked = ${locked},
        commission_locked_at = case when ${locked} then coalesce(commission_locked_at, now()) else null end,
        documents = ${opt(input.documents)},
        notes = ${opt(input.notes)},
        updated_at = now()
      where id = ${input.id}
    `;
    await syncSale(sql, input.id);
    await audit(sql, userId, "editar", "sale", input.id, `Venta ${row.code} actualizada.`, row, { status: input.status, total });
    return { id: input.id };
  }
  const resolved = await resolveLock(sql, actor, input, 0);
  const id = nid();
  const code = await nextCode(sql, input.createdOn.slice(0, 4));
  await sql`
    insert into sales (
      id, code, created_on, closed_on, client_name, product_name, description, total_cents,
      sale_status, direct_cost_estimated_cents, direct_cost_actual_cents, closer_user_id, originator_user_id,
      campaign_id, attribution_criterion, commission_choice, commission_rate_bps, commission_rule_name,
      commission_base, commission_locked, commission_locked_at, documents, notes, created_by
    ) values (
      ${id}, ${code}, ${input.createdOn}::date, ${resolved.closedOn}::date, ${clientName}, ${productName},
      ${opt(input.description)}, ${total}, ${input.status}, ${estimated}, ${actual},
      ${input.closerUserId || null}, ${input.originatorUserId || null}, ${input.campaignId || null},
      ${opt(input.attributionCriterion)}, ${input.commissionChoice || "politica"}, ${resolved.rate},
      ${resolved.ruleName}, ${resolved.base}, ${resolved.locked},
      ${resolved.locked ? new Date().toISOString() : null}, ${opt(input.documents)}, ${opt(input.notes)}, ${userId}
    )
  `;
  await audit(sql, userId, "crear", "sale", id, `Venta ${code} registrada.`, null, { clientName, total, status: input.status });
  return { id };
}

function num0(v: unknown) {
  return Number(v ?? 0);
}

export async function addPayment(userId: string, input: { saleId: string; paidOn: string; amountCents: number; method?: string; reference?: string; notes?: string; reason?: string; idempotencyKey: string }) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "ventasEscribir");
  if (!isDate(input.paidOn)) throw new SifError("La fecha de cobro no es válida.");
  const amount = cents(input.amountCents, "Cobro");
  if (amount <= 0) throw new SifError("El cobro tiene que ser mayor a cero.");
  const key = text(input.idempotencyKey, "Clave de idempotencia", 80);
  const sales = await sql<Record<string, unknown>>`select * from sales where id = ${input.saleId}`;
  const sale = sales[0];
  if (!sale) throw new SifError("La venta no existe.");
  if (sale.sale_status === "cancelada") throw new SifError("Una venta cancelada no admite un cobro nuevo.");
  if (!canTouchSale(actor, sale)) throw new SifError("No podés registrar cobros de esta venta.");
  const sums = await sql<{ paid: number; refunded: number }>`
    select
      coalesce((select sum(amount_cents) from sale_payments where sale_id = ${input.saleId}), 0) as paid,
      coalesce((select sum(amount_cents) from refunds where sale_id = ${input.saleId}), 0) as refunded
  `;
  const net = num0(sums[0]?.paid) - num0(sums[0]?.refunded);
  if (net + amount > num0(sale.total_cents)) throw new SifError("El cobro supera el saldo de la venta.");
  await guardPeriod(sql, userId, input.paidOn, opt(input.reason), "payment", input.saleId, "Cobro sobre un período cerrado.");
  const id = nid();
  const method = opt(input.method) || "transferencia";
  const reference = opt(input.reference, 120);
  try {
    await sql`
      insert into sale_payments (id, sale_id, paid_on, amount_cents, method, reference, idempotency_key, notes, created_by)
      values (${id}, ${input.saleId}, ${input.paidOn}::date, ${amount}, ${method}, ${reference}, ${key}, ${opt(input.notes)}, ${userId})
    `;
  } catch (error) {
    if (isUniqueError(error)) throw new SifError("Ese pago ya está registrado.");
    throw error;
  }
  await sql`
    insert into cash_movements (id, moved_on, direction, amount_cents, category, description, source_type, source_id, idempotency_key, created_by)
    values (${nid()}, ${input.paidOn}::date, 'entrada', ${amount}, 'cobro', ${"Cobro " + sale.code}, 'payment', ${id}, ${"payment:" + id}, ${userId})
  `;
  if (!sale.commission_locked && sale.sale_status !== "cancelada") {
    const resolved = await resolveLock(
      sql,
      actor,
      {
        createdOn: String(sale.created_on).slice(0, 10),
        closedOn: input.paidOn,
        clientName: String(sale.client_name),
        productName: String(sale.product_name),
        totalCents: num0(sale.total_cents),
        status: "parcial",
        directCostActualCents: sale.direct_cost_actual_cents == null ? null : num0(sale.direct_cost_actual_cents),
        closerUserId: sale.closer_user_id ? String(sale.closer_user_id) : undefined,
        commissionChoice: String(sale.commission_choice || "politica"),
        notes: String(sale.notes ?? ""),
        customBps: sale.commission_rate_bps == null ? undefined : num0(sale.commission_rate_bps),
      },
      net + amount,
    );
    await sql`
      update sales set
        commission_locked = true,
        commission_locked_at = now(),
        commission_rate_bps = ${resolved.rate},
        commission_rule_name = ${resolved.ruleName},
        commission_base = ${resolved.base},
        closed_on = coalesce(closed_on, ${input.paidOn}::date),
        sale_status = case when sale_status in ('prospecto', 'negociacion') then 'parcial' else sale_status end
      where id = ${input.saleId} and commission_locked = false
    `;
  }
  await syncSale(sql, input.saleId);
  await audit(sql, userId, "cobro", "sale", input.saleId, `Cobro registrado en ${sale.code}.`, null, { amount, paidOn: input.paidOn, id });
  return { id };
}

function canTouchSale(actor: Awaited<ReturnType<typeof loadActor>>, sale: Record<string, unknown>) {
  if (actor.roles.some((r) => r === "ceo" || r === "finanzas")) return true;
  return sale.closer_user_id === actor.userId || sale.created_by === actor.userId;
}

export async function addRefund(userId: string, input: { saleId: string; refundedOn: string; amountCents: number; reason: string; idempotencyKey: string }) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "ventasEscribir");
  if (!isDate(input.refundedOn)) throw new SifError("La fecha del reembolso no es válida.");
  const amount = cents(input.amountCents, "Reembolso");
  if (amount <= 0) throw new SifError("El reembolso tiene que ser mayor a cero.");
  const reason = text(input.reason, "Motivo", 500);
  const sales = await sql<Record<string, unknown>>`select * from sales where id = ${input.saleId}`;
  const sale = sales[0];
  if (!sale) throw new SifError("La venta no existe.");
  if (!canTouchSale(actor, sale)) throw new SifError("No podés registrar reembolsos de esta venta.");
  const sums = await sql<{ paid: number; refunded: number }>`
    select
      coalesce((select sum(amount_cents) from sale_payments where sale_id = ${input.saleId}), 0) as paid,
      coalesce((select sum(amount_cents) from refunds where sale_id = ${input.saleId}), 0) as refunded
  `;
  const net = num0(sums[0]?.paid) - num0(sums[0]?.refunded);
  if (amount > net) throw new SifError("El reembolso supera el neto cobrado.");
  await guardPeriod(sql, userId, input.refundedOn, reason, "refund", input.saleId, "Reembolso sobre un período cerrado.");
  const id = nid();
  try {
    await sql`
      insert into refunds (id, sale_id, refunded_on, amount_cents, reason, idempotency_key, created_by)
      values (${id}, ${input.saleId}, ${input.refundedOn}::date, ${amount}, ${reason}, ${text(input.idempotencyKey, "Clave", 80)}, ${userId})
    `;
  } catch (error) {
    if (isUniqueError(error)) throw new SifError("Ese reembolso ya está registrado.");
    throw error;
  }
  await sql`
    insert into cash_movements (id, moved_on, direction, amount_cents, category, description, source_type, source_id, idempotency_key, created_by)
    values (${nid()}, ${input.refundedOn}::date, 'salida', ${amount}, 'reembolso', ${"Reembolso " + sale.code}, 'refund', ${id}, ${"refund:" + id}, ${userId})
  `;
  await syncSale(sql, input.saleId);
  await audit(sql, userId, "reembolso", "sale", input.saleId, `Reembolso en ${sale.code}.`, null, { amount, reason });
  return { id };
}

export async function saveExpense(userId: string, input: { spentOn: string; category: string; vendor?: string; description: string; amountCents: number; status: string; isEstimate?: boolean; receipt?: string; campaignId?: string; projectId?: string; saleId?: string; notes?: string; reason?: string }) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "gastos");
  if (!isDate(input.spentOn)) throw new SifError("La fecha no es válida.");
  const amount = cents(input.amountCents, "Importe");
  if (amount < 0) throw new SifError("El importe no puede ser negativo.");
  const description = text(input.description, "Descripción", 300);
  const status = input.status || "devengado";
  if (!["estimado", "devengado", "pendiente_pago", "pagado"].includes(status)) throw new SifError("Estado de gasto inválido.");
  await guardPeriod(sql, userId, input.spentOn, opt(input.reason), "expense", "nuevo", description);
  const id = nid();
  const estimate = Boolean(input.isEstimate) || status === "estimado";
  await sql`
    insert into expenses (id, spent_on, category, vendor, description, amount_cents, status, is_estimate, receipt, campaign_id, project_id, sale_id, notes, created_by)
    values (
      ${id}, ${input.spentOn}::date, ${text(input.category, "Categoría", 40)}, ${opt(input.vendor, 160)}, ${description},
      ${amount}, ${estimate ? "estimado" : status}, ${estimate}, ${opt(input.receipt, 300)},
      ${input.campaignId || null}, ${input.projectId || null}, ${input.saleId || null}, ${opt(input.notes)}, ${userId}
    )
  `;
  if (status === "pagado" && !estimate) {
    await sql`
      insert into cash_movements (id, moved_on, direction, amount_cents, category, description, source_type, source_id, idempotency_key, created_by)
      values (${nid()}, ${input.spentOn}::date, 'salida', ${amount}, 'gasto', ${description}, 'expense', ${id}, ${"gasto:" + id}, ${userId})
    `;
  }
  await audit(sql, userId, "crear", "expense", id, description, null, { amount, status });
  return { id };
}

export async function payExpense(userId: string, input: { id: string; paidOn: string; reason?: string }) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "gastos");
  if (!isDate(input.paidOn)) throw new SifError("La fecha de pago no es válida.");
  const rows = await sql<Record<string, unknown>>`select * from expenses where id = ${input.id}`;
  const row = rows[0];
  if (!row) throw new SifError("El gasto no existe.");
  if (row.is_estimate || row.status === "estimado") throw new SifError("Un estimado no se paga. Registrá el gasto real.");
  if (row.status === "pagado") throw new SifError("Ese gasto ya está pagado. No se registra dos veces.");
  await guardPeriod(sql, userId, input.paidOn, opt(input.reason), "expense", input.id, "Pago de gasto en período cerrado.");
  await sql`update expenses set status = 'pagado' where id = ${input.id} and status <> 'pagado'`;
  try {
    await sql`
      insert into cash_movements (id, moved_on, direction, amount_cents, category, description, source_type, source_id, idempotency_key, created_by)
      values (${nid()}, ${input.paidOn}::date, 'salida', ${num0(row.amount_cents)}, 'gasto', ${String(row.description)}, 'expense', ${input.id}, ${"gasto:" + input.id}, ${userId})
    `;
  } catch (error) {
    if (!isUniqueError(error)) throw error;
  }
  await audit(sql, userId, "pago", "expense", input.id, "Gasto marcado como pagado.", row, { paidOn: input.paidOn });
  return { ok: true };
}

export async function saveObligation(userId: string, input: { description: string; amountCents: number; dueOn?: string }) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "gastos");
  const id = nid();
  const due = input.dueOn && isDate(input.dueOn) ? input.dueOn : null;
  await sql`
    insert into obligations (id, due_on, description, amount_cents, created_by)
    values (${id}, ${due}::date, ${text(input.description, "Descripción", 300)}, ${cents(input.amountCents, "Importe")}, ${userId})
  `;
  await audit(sql, userId, "crear", "obligation", id, "Obligación registrada.");
  return { id };
}

export async function payObligation(userId: string, input: { id: string; paidOn: string; reason?: string }) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "gastos");
  if (!isDate(input.paidOn)) throw new SifError("La fecha no es válida.");
  const rows = await sql<Record<string, unknown>>`select * from obligations where id = ${input.id}`;
  const row = rows[0];
  if (!row) throw new SifError("La obligación no existe.");
  if (row.status === "pagada") throw new SifError("Esa obligación ya fue pagada.");
  await guardPeriod(sql, userId, input.paidOn, opt(input.reason), "obligation", input.id, "Pago de obligación en período cerrado.");
  await sql`update obligations set status = 'pagada', paid_on = ${input.paidOn}::date where id = ${input.id}`;
  await sql`
    insert into cash_movements (id, moved_on, direction, amount_cents, category, description, source_type, source_id, idempotency_key, created_by)
    values (${nid()}, ${input.paidOn}::date, 'salida', ${num0(row.amount_cents)}, 'obligacion', ${String(row.description)}, 'obligation', ${input.id}, ${"obligacion:" + input.id}, ${userId})
    on conflict (idempotency_key) do nothing
  `;
  await audit(sql, userId, "pago", "obligation", input.id, "Obligación pagada.");
  return { ok: true };
}

export async function saveCampaign(userId: string, input: Record<string, unknown>) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "marketingEscribir");
  const name = text(input.name, "Nombre", 180);
  const starts = String(input.startsOn ?? "");
  if (!isDate(starts)) throw new SifError("La fecha de inicio no es válida.");
  const ends = input.endsOn ? String(input.endsOn) : null;
  if (ends && !isDate(ends)) throw new SifError("La fecha de fin no es válida.");
  const id = input.id ? String(input.id) : nid();
  if (input.id) {
    await sql`
      update campaigns set
        name = ${name}, owner_user_id = ${input.ownerUserId || null}, starts_on = ${starts}::date, ends_on = ${ends}::date,
        objective = ${opt(input.objective)}, budget_cents = ${Math.max(0, cents(input.budgetCents ?? 0, "Presupuesto"))},
        actual_spend_cents = ${Math.max(0, cents(input.actualSpendCents ?? 0, "Gasto"))},
        channels = ${opt(input.channels)}, content_notes = ${opt(input.contentNotes)},
        contacts = ${Math.max(0, Number(input.contacts ?? 0) || 0)},
        qualified_contacts = ${Math.max(0, Number(input.qualifiedContacts ?? 0) || 0)},
        meetings = ${Math.max(0, Number(input.meetings ?? 0) || 0)},
        notes = ${opt(input.notes)}, evidence = ${opt(input.evidence)}
      where id = ${id}
    `;
  } else {
    await sql`
      insert into campaigns (id, name, owner_user_id, starts_on, ends_on, objective, budget_cents, actual_spend_cents, channels, content_notes, contacts, qualified_contacts, meetings, notes, evidence, created_by)
      values (
        ${id}, ${name}, ${input.ownerUserId || userId}, ${starts}::date, ${ends}::date, ${opt(input.objective)},
        ${Math.max(0, cents(input.budgetCents ?? 0, "Presupuesto"))}, ${Math.max(0, cents(input.actualSpendCents ?? 0, "Gasto"))},
        ${opt(input.channels)}, ${opt(input.contentNotes)}, ${Math.max(0, Number(input.contacts ?? 0) || 0)},
        ${Math.max(0, Number(input.qualifiedContacts ?? 0) || 0)}, ${Math.max(0, Number(input.meetings ?? 0) || 0)},
        ${opt(input.notes)}, ${opt(input.evidence)}, ${userId}
      )
    `;
  }
  await audit(sql, userId, input.id ? "editar" : "crear", "campaign", id, name);
  return { id };
}

export async function saveProject(userId: string, input: Record<string, unknown>) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "proyectosEscribir");
  const name = text(input.name, "Nombre", 180);
  const kind = input.kind === "interno" ? "interno" : "cliente";
  const id = input.id ? String(input.id) : nid();
  const funding = Boolean(input.fundingApproved);
  if (input.id) {
    const before = await sql`select * from projects where id = ${id}`;
    await sql`
      update projects set name = ${name}, kind = ${kind}, owner_user_id = ${input.ownerUserId || null},
        budget_cents = ${Math.max(0, cents(input.budgetCents ?? 0, "Presupuesto"))},
        compensation_budget_cents = ${Math.max(0, cents(input.compensationBudgetCents ?? 0, "Remuneración"))},
        funding_approved = ${funding},
        starts_on = ${input.startsOn || null}::date, target_on = ${input.targetOn || null}::date,
        status = ${opt(input.status) || "planificado"},
        acceptance_criteria = ${opt(input.acceptanceCriteria)}, notes = ${opt(input.notes)}, updated_at = now()
      where id = ${id}
    `;
    await audit(sql, userId, "editar", "project", id, name, before[0], { funding, kind });
  } else {
    await sql`
      insert into projects (id, name, kind, owner_user_id, budget_cents, compensation_budget_cents, funding_approved, starts_on, target_on, status, acceptance_criteria, notes, created_by)
      values (
        ${id}, ${name}, ${kind}, ${input.ownerUserId || userId},
        ${Math.max(0, cents(input.budgetCents ?? 0, "Presupuesto"))},
        ${Math.max(0, cents(input.compensationBudgetCents ?? 0, "Remuneración"))},
        ${funding}, ${input.startsOn || null}::date, ${input.targetOn || null}::date,
        ${opt(input.status) || "planificado"}, ${opt(input.acceptanceCriteria)}, ${opt(input.notes)}, ${userId}
      )
    `;
    await audit(sql, userId, "crear", "project", id, name);
  }
  const members = Array.isArray(input.memberIds) ? input.memberIds.map(String) : null;
  if (members) {
    await sql`delete from project_members where project_id = ${id}`;
    for (const member of [...new Set(members)]) {
      await sql`insert into project_members (project_id, user_id, role_on_project) values (${id}, ${member}, 'participante')`;
    }
  }
  return { id };
}

export async function saveMilestone(userId: string, input: Record<string, unknown>) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "proyectosEscribir");
  const title = text(input.title, "Hito", 180);
  const projectId = text(input.projectId, "Proyecto", 80);
  const existing = input.id
    ? (await sql<Record<string, unknown>>`select * from milestones where id = ${String(input.id)}`)[0]
    : undefined;
  if (existing && existing.status === "aceptado" && num0(existing.amount_cents) !== cents(input.amountCents, "Importe")) {
    if (!actor.roles.includes("ceo") || opt(input.reason).length < 8) {
      throw new SifError("Un hito aceptado no cambia de importe sin autorización del CEO y un motivo.");
    }
  }
  const id = input.id ? String(input.id) : nid();
  const amount = Math.max(0, cents(input.amountCents ?? 0, "Importe"));
  if (existing?.status === "aceptado") {
    await sql`
      update milestones set title = ${title}, description = ${opt(input.description)}, amount_cents = ${amount},
        assignee_user_id = ${input.assigneeUserId || null}, evidence = ${opt(input.evidence)}
      where id = ${id}
    `;
    await audit(sql, userId, "ajuste_hito", "milestone", id, "Cambio sobre un hito aceptado.", existing, { amount, reason: input.reason });
    return { id };
  }
  const allowedStatus = ["pendiente", "en_progreso", "en_revision"];
  const nextStatus = allowedStatus.includes(String(input.status)) ? String(input.status) : "pendiente";
  if (input.id) {
    await sql`
      update milestones set title = ${title}, description = ${opt(input.description)}, amount_cents = ${amount},
        assignee_user_id = ${input.assigneeUserId || null}, evidence = ${opt(input.evidence)},
        status = ${nextStatus}
      where id = ${id} and status <> 'aceptado'
    `;
  } else {
    await sql`
      insert into milestones (id, project_id, title, description, amount_cents, assignee_user_id, evidence, status, created_by)
      values (${id}, ${projectId}, ${title}, ${opt(input.description)}, ${amount}, ${input.assigneeUserId || null}, ${opt(input.evidence)}, 'pendiente', ${userId})
    `;
  }
  await audit(sql, userId, input.id ? "editar" : "crear", "milestone", id, title);
  return { id };
}

export async function reviewMilestone(userId: string, input: { id: string; decision: "aceptado" | "rechazado"; notes: string; acceptedOn?: string }) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "hitosRevisar");
  const rows = await sql<Record<string, unknown>>`
    select m.*, p.kind, p.funding_approved from milestones m join projects p on p.id = m.project_id where m.id = ${input.id}
  `;
  const row = rows[0];
  if (!row) throw new SifError("El hito no existe.");
  if (row.status === "aceptado" && input.decision !== "aceptado") {
    throw new SifError("Un hito aceptado no se revierte en silencio. Registrá un ajuste con motivo desde el CEO.");
  }
  const notes = text(input.notes, "Justificación", 1000);
  const reviewers = await otherReviewers(sql, userId);
  const gate = canReviewDeliverable({
    actorId: userId,
    assigneeId: row.assignee_user_id ? String(row.assignee_user_id) : null,
    actorRoles: actor.roles,
    otherReviewers: reviewers,
    justification: notes,
  });
  if (!gate.ok) throw new SifError(gate.message || "No se puede revisar.");
  if (input.decision === "aceptado") {
    if (!opt(row.evidence) && notes.length < 8) throw new SifError("Adjuntá evidencia o una justificación verificable.");
    if (row.kind === "interno" && !row.funding_approved) {
      throw new SifError("El producto interno no tiene financiación aprobada. No se devenga la remuneración.");
    }
    const acceptedOn = input.acceptedOn && isDate(input.acceptedOn) ? input.acceptedOn : new Date().toISOString().slice(0, 10);
    await sql`
      update milestones set status = 'aceptado', review_notes = ${notes}, reviewed_by = ${userId}, reviewed_at = now(), accepted_on = ${acceptedOn}::date
      where id = ${input.id}
    `;
  } else {
    await sql`
      update milestones set status = 'rechazado', review_notes = ${notes}, reviewed_by = ${userId}, reviewed_at = now(), accepted_on = null
      where id = ${input.id}
    `;
  }
  await audit(sql, userId, input.decision, "milestone", input.id, notes, row, { decision: input.decision });
  return { ok: true };
}

export async function saveObjective(userId: string, input: Record<string, unknown>) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "objetivosEscribir");
  const p = period(input.period);
  const id = input.id ? String(input.id) : nid();
  const title = text(input.title, "Objetivo", 200);
  const targetUser = String(input.userId || userId);
  if (input.id) {
    await sql`
      update performance_objectives set title = ${title}, metric = ${opt(input.metric)}, target_value = ${opt(input.targetValue)},
        incentive_cents = ${Math.max(0, cents(input.incentiveCents ?? 0, "Incentivo"))}, agreed = ${Boolean(input.agreed)}
      where id = ${id}
    `;
  } else {
    await sql`
      insert into performance_objectives (id, user_id, period, title, metric, target_value, incentive_cents, agreed, created_by)
      values (${id}, ${targetUser}, ${p}, ${title}, ${opt(input.metric)}, ${opt(input.targetValue)}, ${Math.max(0, cents(input.incentiveCents ?? 0, "Incentivo"))}, ${Boolean(input.agreed)}, ${userId})
    `;
  }
  await audit(sql, userId, "objetivo", "objective", id, title);
  return { id };
}

export async function saveObjectiveResult(userId: string, input: { id: string; actualValue: string; met: boolean | null; evidence?: string; justification?: string }) {
  const sql = await db();
  const actor = await loadActor(userId);
  const rows = await sql<Record<string, unknown>>`select * from performance_objectives where id = ${input.id}`;
  const row = rows[0];
  if (!row) throw new SifError("El objetivo no existe.");
  const own = String(row.user_id) === userId;
  if (!own && !actor.roles.includes("ceo") && !actor.roles.includes("finanzas")) {
    throw new SifError("Solo podés cargar el resultado de tus objetivos, salvo CEO o finanzas.");
  }
  await sql`
    update performance_objectives set actual_value = ${opt(input.actualValue)}, met = ${input.met},
      evidence = ${opt(input.evidence)}, justification = ${opt(input.justification)}
    where id = ${input.id}
  `;
  await audit(sql, userId, "resultado", "objective", input.id, "Resultado de objetivo actualizado.", row, input);
  return { ok: true };
}

export async function saveSetterLog(userId: string, input: Record<string, unknown>) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertMember(actor);
  const target = String(input.userId || userId);
  if (target !== userId && !actor.roles.includes("ceo")) throw new SifError("Solo podés cargar tu propio registro de setter.");
  const p = period(input.period);
  await sql`
    insert into setter_logs (user_id, period, contacts, qualified, meetings_scheduled, meetings_held, opportunities_accepted, quality_notes, updated_by)
    values (
      ${target}, ${p}, ${int(input.contacts)}, ${int(input.qualified)}, ${int(input.meetingsScheduled)},
      ${int(input.meetingsHeld)}, ${int(input.opportunitiesAccepted)}, ${opt(input.qualityNotes)}, ${userId}
    )
    on conflict (user_id, period) do update set
      contacts = excluded.contacts, qualified = excluded.qualified,
      meetings_scheduled = excluded.meetings_scheduled, meetings_held = excluded.meetings_held,
      opportunities_accepted = excluded.opportunities_accepted, quality_notes = excluded.quality_notes,
      updated_by = ${userId}, updated_at = now()
  `;
  await audit(sql, userId, "setter", "setter_log", `${target}:${p}`, "Registro de setter actualizado.");
  return { ok: true };
}

function int(value: unknown) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

export async function saveContribution(userId: string, input: Record<string, unknown>) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertMember(actor);
  const subject = String(input.userId || userId);
  if (subject !== userId) throw new SifError("Solo podés registrar tu propio trabajo. No se atribuye el de otra persona.");
  const id = nid();
  await sql`
    insert into contributions (id, user_id, period, role_context, category, title, detail, verifiable, evidence, created_by)
    values (
      ${id}, ${userId}, ${period(input.period)}, ${text(input.roleContext, "Contexto", 40)},
      ${text(input.category, "Categoría", 40)}, ${text(input.title, "Título", 200)}, ${opt(input.detail)},
      ${Boolean(input.verifiable)}, ${opt(input.evidence)}, ${userId}
    )
  `;
  await audit(sql, userId, "contribucion", "contribution", id, String(input.title));
  return { id };
}

export async function saveAgreement(userId: string, input: Record<string, unknown>) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "configurar");
  const id = input.id ? String(input.id) : nid();
  const from = String(input.effectiveFrom ?? "");
  if (!isDate(from)) throw new SifError("La vigencia no es válida.");
  const to = input.effectiveTo ? String(input.effectiveTo) : null;
  if (to && !isDate(to)) throw new SifError("La fecha de fin no es válida.");
  const kind = text(input.kind, "Tipo", 40);
  if (input.id) {
    const before = await sql`select * from compensation_agreements where id = ${id}`;
    await sql`
      update compensation_agreements set user_id = ${text(input.userId, "Persona", 80)}, kind = ${kind},
        title = ${text(input.title, "Título", 180)}, rate_bps = ${input.rateBps == null ? null : cents(input.rateBps, "Tasa")},
        fixed_cents = ${Math.max(0, cents(input.fixedCents ?? 0, "Importe"))}, accrue = ${Boolean(input.accrue)},
        effective_from = ${from}::date, effective_to = ${to}::date, terms = ${opt(input.terms)}, active = ${input.active !== false}
      where id = ${id}
    `;
    await audit(sql, userId, "acuerdo", "agreement", id, "Acuerdo actualizado. No cambia ventas ya bloqueadas.", before[0], input);
  } else {
    await sql`
      insert into compensation_agreements (id, user_id, kind, title, rate_bps, fixed_cents, accrue, effective_from, effective_to, terms, active, created_by)
      values (
        ${id}, ${text(input.userId, "Persona", 80)}, ${kind}, ${text(input.title, "Título", 180)},
        ${input.rateBps == null || input.rateBps === "" ? null : cents(input.rateBps, "Tasa")},
        ${Math.max(0, cents(input.fixedCents ?? 0, "Importe"))}, ${Boolean(input.accrue)},
        ${from}::date, ${to}::date, ${opt(input.terms)}, true, ${userId}
      )
    `;
    await audit(sql, userId, "acuerdo", "agreement", id, "Acuerdo creado.");
  }
  return { id };
}

export async function saveSettings(userId: string, input: Record<string, unknown>) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "configurar");
  const before = await readSettings(sql);
  const reinversion = int(input.reinversionBps);
  const reserva = int(input.reservaBps);
  const fondo = int(input.fondoBps);
  const formacion = int(input.formacionBps);
  if (reinversion + reserva + fondo + formacion !== 10000) {
    throw new SifError("Reinversión, reserva, fondo de remuneraciones y formación tienen que sumar 100%. No se guardó la política.");
  }
  const opening = cents(input.openingCashCents ?? before.openingCashCents, "Caja inicial");
  await sql`
    update org_settings set
      reinversion_bps = ${reinversion}, reserva_bps = ${reserva}, fondo_bps = ${fondo}, formacion_bps = ${formacion},
      commission_standard_bps = ${int(input.commissionStandardBps ?? before.commissionStandardBps)},
      commission_superior_bps = ${int(input.commissionSuperiorBps ?? before.commissionSuperiorBps)},
      superior_min_margin_bps = ${int(input.superiorMinMarginBps ?? before.superiorMinMarginBps)},
      commission_base = ${input.commissionBase === "facturado" ? "facturado" : "cobrado"},
      independent_approval = ${input.independentApproval !== false},
      cash_initialized = true,
      opening_cash_cents = ${opening},
      updated_at = now(), updated_by = ${userId}
    where id = 1
  `;
  await audit(sql, userId, "politica", "settings", "1", "Política actualizada. Las ventas ya bloqueadas conservan su tasa.", before, input);
  return { ok: true };
}

export async function saveRule(userId: string, input: Record<string, unknown>) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "configurar");
  const id = input.id ? String(input.id) : nid();
  const from = String(input.effectiveFrom ?? "");
  if (!isDate(from)) throw new SifError("La vigencia no es válida.");
  if (input.id) {
    const before = await sql`select * from commission_rules where id = ${id}`;
    await sql`
      update commission_rules set name = ${text(input.name, "Nombre", 120)}, rate_bps = ${int(input.rateBps)},
        base = ${input.base === "facturado" ? "facturado" : "cobrado"},
        min_margin_bps = ${input.minMarginBps == null || input.minMarginBps === "" ? null : int(input.minMarginBps)},
        notes = ${opt(input.notes)}, active = ${input.active !== false}, effective_from = ${from}::date,
        effective_to = ${input.effectiveTo || null}::date
      where id = ${id}
    `;
    await audit(sql, userId, "regla", "commission_rule", id, "Regla actualizada. No reescribe comisiones bloqueadas.", before[0], input);
  } else {
    await sql`
      insert into commission_rules (id, name, rate_bps, base, min_margin_bps, notes, effective_from, effective_to, created_by)
      values (
        ${id}, ${text(input.name, "Nombre", 120)}, ${int(input.rateBps)},
        ${input.base === "facturado" ? "facturado" : "cobrado"},
        ${input.minMarginBps == null || input.minMarginBps === "" ? null : int(input.minMarginBps)},
        ${opt(input.notes)}, ${from}::date, ${input.effectiveTo || null}::date, ${userId}
      )
    `;
    await audit(sql, userId, "regla", "commission_rule", id, "Regla creada.");
  }
  return { id };
}

export async function materialize(userId: string, rawPeriod: string) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "panelGlobal");
  const p = period(rawPeriod);
  const closing = await ensureClosing(sql, p);
  if (closing.status === "cerrado") {
    throw new SifError("El período está cerrado. No se recalculan registros aprobados. Usá un ajuste con motivo.");
  }
  const facts = await loadFacts(sql, p);
  const report = buildPeriod(facts);
  for (const line of report.suggestions) {
    if (line.calculatedCents === 0) continue;
    const existing = await sql<Record<string, unknown>>`
      select * from compensation_records where idempotency_key = ${line.idempotencyKey}
    `;
    const row = existing[0];
    if (!row) {
      await sql`
        insert into compensation_records (
          id, user_id, period, kind, source_type, source_id, formula, provenance, calculated_cents, status, idempotency_key
        ) values (
          ${nid()}, ${line.userId}, ${line.period}, ${line.kind}, ${line.sourceType}, ${line.sourceId},
          ${line.formula}, ${line.provenance}, ${line.calculatedCents}, 'pendiente', ${line.idempotencyKey}
        )
      `;
    } else if (row.status === "pendiente" || row.status === "calculado") {
      if (num0(row.calculated_cents) !== line.calculatedCents || row.formula !== line.formula) {
        await sql`
          update compensation_records set calculated_cents = ${line.calculatedCents}, formula = ${line.formula},
            provenance = ${line.provenance}, updated_at = now()
          where id = ${String(row.id)} and status in ('pendiente', 'calculado')
        `;
        await audit(sql, userId, "recalculo", "compensation", String(row.id), "Se actualizó un cálculo todavía no aprobado.", row, line);
      }
    } else if (num0(row.calculated_cents) !== line.calculatedCents) {
      await audit(sql, userId, "divergencia", "compensation", String(row.id), "El recálculo difiere de un registro ya aprobado o pagado. No se modificó.", row, { suggested: line.calculatedCents });
    }
  }
  const keys = new Set(report.suggestions.filter((s) => s.calculatedCents !== 0).map((s) => s.idempotencyKey));
  const pending = await sql<Record<string, unknown>>`
    select * from compensation_records where period = ${p} and status in ('pendiente', 'calculado')
  `;
  for (const row of pending) {
    if (!keys.has(String(row.idempotency_key))) {
      await sql`
        update compensation_records set status = 'rechazado',
          notes = 'El cálculo ya no sostiene este importe (cancelación, rechazo o corrección).',
          updated_at = now()
        where id = ${String(row.id)} and status in ('pendiente', 'calculado')
      `;
      await audit(sql, userId, "rechazo_calculo", "compensation", String(row.id), "Línea pendiente retirada por el recálculo.", row, null);
    }
  }
  await sql`
    update monthly_closings set calculated_at = now(),
      status = case when status = 'abierto' then 'en_revision' else status end
    where period = ${p} and status <> 'cerrado'
  `;
  await audit(sql, userId, "calcular", "closing", p, `Cálculo de remuneraciones de ${p}.`);
  return { lines: report.suggestions.length };
}

export async function decideCompensation(userId: string, input: { id: string; decision: "aprobar" | "rechazar" | "reinvertir"; justification?: string }) {
  const sql = await db();
  const actor = await loadActor(userId);
  const rows = await sql<Record<string, unknown>>`select * from compensation_records where id = ${input.id}`;
  const row = rows[0];
  if (!row) throw new SifError("El registro no existe.");
  if (row.status === "pagado") throw new SifError("Un pago ya registrado no se modifica. Cargá un ajuste.");
  const settings = await readSettings(sql);
  const justification = opt(input.justification);
  if (input.decision === "reinvertir") {
    if (!actor.roles.includes("ceo") || String(row.user_id) !== userId || row.kind !== "ceo") {
      throw new SifError("Solo el CEO puede reinvertir su propia remuneración de dirección.");
    }
    await sql`
      update compensation_records set status = 'reinvertido', reinvested = true,
        approved_cents = coalesce(approved_cents, calculated_cents), approved_by = ${userId}, approved_at = coalesce(approved_at, now()),
        notes = ${justification || "Remuneración reinvertida. El importe sigue existiendo."}, updated_at = now()
      where id = ${input.id}
    `;
    await audit(sql, userId, "reinversion", "compensation", input.id, "Remuneración del CEO reinvertida. No se anuló.", row, { reinvested: true });
    return { ok: true };
  }
  assertPerm(actor, "aprobarPagos");
  if (row.status !== "pendiente" && row.status !== "calculado" && !(input.decision === "rechazar" && row.status === "aprobado" && num0(row.paid_cents) === 0)) {
    throw new SifError("Ese registro ya no está pendiente de decisión.");
  }
  const gate = canSelfApprove({
    actorId: userId,
    beneficiaryId: String(row.user_id),
    independent: settings.independentApproval,
    otherApprovers: await otherApprovers(sql, userId),
    justification,
  });
  if (!gate.ok) throw new SifError(gate.message || "Aprobación rechazada.");
  if (input.decision === "aprobar") {
    await sql`
      update compensation_records set status = 'aprobado', approved_cents = calculated_cents, approved_by = ${userId},
        approved_at = now(), sole_signatory = ${gate.sole}, notes = ${justification}, updated_at = now()
      where id = ${input.id}
    `;
    await audit(sql, userId, "aprobar", "compensation", input.id, gate.sole ? "Aprobado como único firmante." : "Remuneración aprobada.", row, { approved: row.calculated_cents });
  } else {
    if (justification.length < 8) throw new SifError("El rechazo necesita una justificación.");
    await sql`
      update compensation_records set status = 'rechazado', notes = ${justification}, approved_by = ${userId}, updated_at = now()
      where id = ${input.id} and paid_cents = 0
    `;
    await audit(sql, userId, "rechazar", "compensation", input.id, justification, row, null);
  }
  return { ok: true };
}

export async function payCompensation(userId: string, input: { id: string; amountCents: number; paidOn: string; reason?: string }) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "registrarPagos");
  if (!isDate(input.paidOn)) throw new SifError("La fecha de pago no es válida.");
  const rows = await sql<Record<string, unknown>>`select * from compensation_records where id = ${input.id}`;
  const row = rows[0];
  if (!row) throw new SifError("El registro no existe.");
  if (row.reinvested || row.status === "reinvertido") throw new SifError("Esa remuneración fue reinvertida. No se paga en efectivo.");
  if (row.status !== "aprobado" && row.status !== "parcial") throw new SifError("Solo se paga un importe aprobado.");
  const approved = num0(row.approved_cents);
  if (approved <= 0) throw new SifError("Este registro no es un desembolso.");
  const remaining = approved - num0(row.paid_cents);
  const amount = cents(input.amountCents, "Pago");
  if (amount <= 0) throw new SifError("El pago tiene que ser mayor a cero.");
  if (amount > remaining) throw new SifError("El pago supera el saldo aprobado. No se registra dos veces.");
  const settings = await readSettings(sql);
  const gate = canSelfApprove({
    actorId: userId,
    beneficiaryId: String(row.user_id),
    independent: settings.independentApproval,
    otherApprovers: await otherApprovers(sql, userId),
    justification: opt(input.reason),
  });
  if (!gate.ok) throw new SifError(gate.message || "No podés ejecutar tu propio pago.");
  await guardPeriod(sql, userId, input.paidOn, opt(input.reason), "compensation_payment", input.id, "Pago de remuneración en período cerrado.");
  const paid = num0(row.paid_cents) + amount;
  const status = paid >= approved ? "pagado" : "parcial";
  const updated = await sql<{ id: string }>`
    update compensation_records set paid_cents = ${paid}, status = ${status}, paid_at = now(), sole_signatory = ${gate.sole}, updated_at = now()
    where id = ${input.id} and paid_cents = ${num0(row.paid_cents)} and status in ('aprobado', 'parcial')
    returning id
  `;
  if (!updated[0]) throw new SifError("El pago ya había sido registrado. No se duplicó.");
  const payId = nid();
  await sql`
    insert into cash_movements (id, moved_on, direction, amount_cents, category, description, source_type, source_id, idempotency_key, created_by)
    values (${nid()}, ${input.paidOn}::date, 'salida', ${amount}, 'remuneracion', ${"Pago " + row.kind}, 'compensation', ${input.id}, ${"remuneracion:" + payId}, ${userId})
  `;
  await audit(sql, userId, "pago", "compensation", input.id, "Pago de remuneración registrado.", row, { amount, paid, status });
  return { ok: true, status };
}

export async function saveChecklist(userId: string, input: { period: string; manual: { ventas: boolean; cobros: boolean; gastos: boolean; caja: boolean }; warningsAcknowledged: boolean; ackNote?: string }) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "distribucion");
  const p = period(input.period);
  const closing = await ensureClosing(sql, p);
  if (closing.status === "cerrado") throw new SifError("El período está cerrado.");
  await sql`
    update monthly_closings set manual = ${JSON.stringify(input.manual)}::jsonb,
      warnings_ack = ${Boolean(input.warningsAcknowledged)}, ack_note = ${opt(input.ackNote)}
    where period = ${p} and status <> 'cerrado'
  `;
  return { ok: true };
}

export async function storeProposal(userId: string, rawPeriod: string) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "distribucion");
  const p = period(rawPeriod);
  const closing = await ensureClosing(sql, p);
  if (closing.status === "cerrado") throw new SifError("El período está cerrado. La propuesta oficial es la del cierre.");
  const facts = await loadFacts(sql, p);
  const report = buildPeriod(facts);
  await sql`
    update monthly_closings set proposal = ${JSON.stringify(report.distribution)}::jsonb
    where period = ${p} and status <> 'cerrado'
  `;
  await audit(sql, userId, "propuesta", "closing", p, "Propuesta de distribución generada.");
  return report.distribution;
}

export async function decideDistribution(userId: string, input: { period: string; decision: string; replaceReason?: string }) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "cerrarMes");
  const p = period(input.period);
  const decision = text(input.decision, "Decisión", 2000);
  const closing = await ensureClosing(sql, p);
  if (closing.status === "cerrado") throw new SifError("El período está cerrado.");
  const facts = await loadFacts(sql, p);
  const report = buildPeriod({ ...facts, proposalReady: true });
  const existing = await sql<{ n: number }>`
    select count(*)::int as n from allocations where period = ${p} and status = 'aprobado'
  `;
  if ((existing[0]?.n ?? 0) > 0) {
    if (opt(input.replaceReason).length < 8) {
      throw new SifError("Ya hay una decisión aprobada. Para reemplazarla hace falta un motivo.");
    }
    await sql`update allocations set status = 'reemplazado', notes = ${opt(input.replaceReason)} where period = ${p} and status = 'aprobado'`;
    await audit(sql, userId, "reemplazo", "allocation", p, opt(input.replaceReason));
  }
  const buckets: Array<[string, number]> = [
    ["obligacion", report.distribution.accruedUnpaidCents + report.distribution.otherObligationsCents],
    ["reserva", report.distribution.buckets.reserva],
    ["reinversion", report.distribution.buckets.reinversion],
    ["fondo_remuneraciones", report.distribution.buckets.fondoRemuneraciones],
    ["formacion", report.distribution.buckets.formacion],
    ["deficit", report.distribution.deficitCents],
  ];
  for (const [bucket, amount] of buckets) {
    await sql`
      insert into allocations (id, period, bucket, amount_cents, status, notes, decided_by, decided_at)
      values (${nid()}, ${p}, ${bucket}, ${amount}, 'aprobado', ${decision}, ${userId}, now())
    `;
  }
  await sql`
    update monthly_closings set proposal = ${JSON.stringify(report.distribution)}::jsonb, ceo_decision = ${decision}
    where period = ${p}
  `;
  await audit(sql, userId, "decision", "allocation", p, decision);
  return { ok: true };
}

export async function closeMonth(userId: string, input: { period: string; decision: string }) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertPerm(actor, "cerrarMes");
  const p = period(input.period);
  const decision = text(input.decision, "Decisión del CEO", 2000);
  await ensureClosing(sql, p);
  const facts = await loadFacts(sql, p);
  const report = buildPeriod(facts);
  if (!report.close.ok) throw new SifError(report.close.message);
  const snapshot = {
    generatedAt: new Date().toISOString(),
    kpis: report.kpis,
    resultado: report.resultado,
    distribution: report.distribution,
    warnings: report.warnings,
    suggestions: report.suggestions,
    marketing: report.marketing,
  };
  const updated = await sql<{ id: string }>`
    update monthly_closings set status = 'cerrado', snapshot = ${JSON.stringify(snapshot)}::jsonb,
      ceo_decision = ${decision}, closed_by = ${userId}, closed_at = now(), proposal = ${JSON.stringify(report.distribution)}::jsonb
    where period = ${p} and status <> 'cerrado'
    returning id
  `;
  if (!updated[0]) throw new SifError("El período ya estaba cerrado. La foto no se reescribió.");
  await audit(sql, userId, "cierre", "closing", p, decision, null, { resultado: report.resultado });
  return { ok: true };
}

export async function explainSale(userId: string, saleId: string) {
  const sql = await db();
  const actor = await loadActor(userId);
  assertMember(actor);
  const facts = await loadFacts(sql, "2000-01");
  const sale = facts.sales.find((s) => s.id === saleId);
  if (!sale) throw new SifError("La venta no existe.");
  const allowed =
    actor.roles.some((r) => r === "ceo" || r === "finanzas" || r === "cmo") ||
    sale.closerUserId === userId ||
    sale.originatorUserId === userId;
  if (!allowed) throw new SifError("No podés ver esta venta.");
  const lines = suggestCommissions([sale], facts.payments, facts.refunds, sale.closedOn?.slice(0, 7) || "2000-01");
  const all = [
    ...lines,
    ...suggestCommissions([sale], facts.payments, facts.refunds, "2099-01").filter(() => false),
  ];
  const periods = new Set<string>();
  for (const p of facts.payments.filter((p) => p.saleId === saleId)) periods.add(p.paidOn.slice(0, 7));
  for (const r of facts.refunds.filter((r) => r.saleId === saleId)) periods.add(r.refundedOn.slice(0, 7));
  if (sale.closedOn) periods.add(sale.closedOn.slice(0, 7));
  const explained = [...periods].flatMap((p) => suggestCommissions([sale], facts.payments, facts.refunds, p));
  return { sale, lines: explained.length ? explained : all };
}
