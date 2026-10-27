-- SIF Finance: esquema operativo. Importes en centavos (bigint).

create table if not exists profiles (
  user_id text primary key,
  email text not null default '',
  name text not null default '',
  roles text not null default 'pendiente',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists org_settings (
  id integer primary key default 1 check (id = 1),
  company_name text not null default 'SIF — Strategic Intelligence Firm',
  currency text not null default 'ARS',
  reinversion_bps integer not null default 5000,
  reserva_bps integer not null default 2000,
  fondo_bps integer not null default 2500,
  formacion_bps integer not null default 500,
  commission_standard_bps integer not null default 1000,
  commission_superior_bps integer not null default 1500,
  superior_min_margin_bps integer not null default 4000,
  commission_base text not null default 'cobrado',
  partial_payment_rule text not null default 'sobre_cada_cobro',
  refund_rule text not null default 'clawback_sobre_tasa_bloqueada',
  independent_approval boolean not null default true,
  cash_initialized boolean not null default false,
  opening_cash_cents bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into org_settings (id) values (1) on conflict (id) do nothing;

create table if not exists sequences (
  name text primary key,
  value integer not null
);

create table if not exists products (
  id text primary key,
  name text not null,
  kind text not null default 'servicio',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists commission_rules (
  id text primary key,
  name text not null,
  rate_bps integer not null,
  base text not null default 'cobrado',
  min_margin_bps integer,
  notes text not null default '',
  active boolean not null default true,
  effective_from date not null,
  effective_to date,
  created_by text not null,
  created_at timestamptz not null default now()
);

insert into commission_rules (id, name, rate_bps, base, min_margin_bps, notes, effective_from, created_by)
values
  ('rule-standard', 'Comisión estándar', 1000, 'cobrado', null,
   'Política inicial. Se usa cuando no se verifica el criterio de la comisión superior.', '2026-01-01', 'sistema'),
  ('rule-superior', 'Comisión superior', 1500, 'cobrado', 4000,
   'Requiere margen de contribución real de al menos 40% o una condición especial autorizada por el CEO.', '2026-01-01', 'sistema')
on conflict (id) do nothing;

create table if not exists campaigns (
  id text primary key,
  name text not null,
  owner_user_id text,
  starts_on date not null,
  ends_on date,
  objective text not null default '',
  budget_cents bigint not null default 0,
  actual_spend_cents bigint not null default 0,
  channels text not null default '',
  content_notes text not null default '',
  contacts integer not null default 0,
  qualified_contacts integer not null default 0,
  meetings integer not null default 0,
  notes text not null default '',
  evidence text not null default '',
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists sales (
  id text primary key,
  code text not null unique,
  created_on date not null,
  closed_on date,
  client_name text not null,
  product_name text not null,
  description text not null default '',
  total_cents bigint not null check (total_cents >= 0),
  currency text not null default 'ARS',
  sale_status text not null,
  collection_status text not null default 'sin_cobro',
  direct_cost_estimated_cents bigint not null default 0,
  direct_cost_actual_cents bigint,
  closer_user_id text,
  originator_user_id text,
  campaign_id text,
  attribution_criterion text not null default '',
  commission_choice text not null default 'politica',
  commission_rate_bps integer,
  commission_rule_name text not null default '',
  commission_base text not null default 'cobrado',
  commission_locked boolean not null default false,
  commission_locked_at timestamptz,
  documents text not null default '',
  notes text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_closed_idx on sales (closed_on);
create index if not exists sales_closer_idx on sales (closer_user_id);
create index if not exists sales_origin_idx on sales (originator_user_id);

create table if not exists sale_payments (
  id text primary key,
  sale_id text not null references sales (id),
  paid_on date not null,
  amount_cents bigint not null check (amount_cents > 0),
  method text not null default 'transferencia',
  reference text not null default '',
  idempotency_key text not null unique,
  notes text not null default '',
  created_by text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists sale_payments_natural
  on sale_payments (sale_id, paid_on, amount_cents, method, reference);

create table if not exists refunds (
  id text primary key,
  sale_id text not null references sales (id),
  refunded_on date not null,
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null,
  idempotency_key text not null unique,
  created_by text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists refunds_natural
  on refunds (sale_id, refunded_on, amount_cents, reason);

create table if not exists expenses (
  id text primary key,
  spent_on date not null,
  category text not null,
  vendor text not null default '',
  description text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'ARS',
  status text not null default 'devengado',
  is_estimate boolean not null default false,
  receipt text not null default '',
  campaign_id text,
  project_id text,
  sale_id text,
  notes text not null default '',
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists obligations (
  id text primary key,
  due_on date,
  description text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  status text not null default 'pendiente',
  paid_on date,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists setter_logs (
  user_id text not null,
  period text not null,
  contacts integer not null default 0,
  qualified integer not null default 0,
  meetings_scheduled integer not null default 0,
  meetings_held integer not null default 0,
  opportunities_accepted integer not null default 0,
  quality_notes text not null default '',
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, period)
);

create table if not exists projects (
  id text primary key,
  name text not null,
  kind text not null,
  owner_user_id text,
  budget_cents bigint not null default 0,
  compensation_budget_cents bigint not null default 0,
  funding_approved boolean not null default false,
  starts_on date,
  target_on date,
  status text not null default 'planificado',
  acceptance_criteria text not null default '',
  notes text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_members (
  project_id text not null references projects (id),
  user_id text not null,
  role_on_project text not null default 'participante',
  primary key (project_id, user_id)
);

create table if not exists milestones (
  id text primary key,
  project_id text not null references projects (id),
  title text not null,
  description text not null default '',
  amount_cents bigint not null default 0,
  assignee_user_id text,
  sort_order integer not null default 0,
  status text not null default 'pendiente',
  evidence text not null default '',
  review_notes text not null default '',
  reviewed_by text,
  reviewed_at timestamptz,
  accepted_on date,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists compensation_agreements (
  id text primary key,
  user_id text not null,
  kind text not null,
  title text not null,
  rate_bps integer,
  fixed_cents bigint not null default 0,
  accrue boolean not null default false,
  effective_from date not null,
  effective_to date,
  terms text not null default '',
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists compensation_records (
  id text primary key,
  user_id text not null,
  period text not null,
  kind text not null,
  source_type text not null,
  source_id text not null,
  formula text not null,
  provenance text not null,
  calculated_cents bigint not null,
  approved_cents bigint,
  paid_cents bigint not null default 0,
  status text not null default 'pendiente',
  idempotency_key text not null unique,
  approved_by text,
  approved_at timestamptz,
  paid_at timestamptz,
  reinvested boolean not null default false,
  sole_signatory boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists compensation_period_idx on compensation_records (period, user_id);

create table if not exists performance_objectives (
  id text primary key,
  user_id text not null,
  period text not null,
  title text not null,
  metric text not null default '',
  target_value text not null default '',
  incentive_cents bigint not null default 0,
  agreed boolean not null default false,
  actual_value text not null default '',
  met boolean,
  evidence text not null default '',
  justification text not null default '',
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists contributions (
  id text primary key,
  user_id text not null,
  period text not null,
  role_context text not null,
  category text not null,
  title text not null,
  detail text not null default '',
  verifiable boolean not null default false,
  evidence text not null default '',
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists cash_movements (
  id text primary key,
  moved_on date not null,
  direction text not null,
  amount_cents bigint not null check (amount_cents > 0),
  category text not null,
  description text not null,
  source_type text,
  source_id text,
  idempotency_key text unique,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists monthly_closings (
  id text primary key,
  period text not null unique,
  status text not null default 'abierto',
  manual jsonb not null default '{"ventas":false,"cobros":false,"gastos":false,"caja":false}',
  warnings_ack boolean not null default false,
  ack_note text not null default '',
  calculated_at timestamptz,
  proposal jsonb,
  snapshot jsonb,
  ceo_decision text not null default '',
  closed_by text,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists closing_adjustments (
  id text primary key,
  period text not null,
  entity_type text not null,
  entity_id text not null,
  reason text not null,
  summary text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists allocations (
  id text primary key,
  period text not null,
  bucket text not null,
  amount_cents bigint not null,
  status text not null default 'propuesto',
  notes text not null default '',
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id text primary key,
  actor_id text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  summary text not null,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_created_idx on audit_logs (created_at desc);
