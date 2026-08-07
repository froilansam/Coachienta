-- Coachienta initial schema. Single user, no auth, no user_id (PRD-001 §3).
-- Every enum and constraint here exists to make a specific spreadsheet defect
-- structurally impossible. Do not relax them for convenience.

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ── vocabulary ──────────────────────────────────────────────────────────────
do $$ begin
  create type unit_basis        as enum ('g','ml','piece','serving');
  create type muscle_group      as enum ('chest','back_lats','back_mid','shoulders_side',
    'shoulders_front','shoulders_rear','biceps','triceps','quads','hamstrings',
    'glutes','calves','abs_core','forearms','other');
  create type movement_pattern  as enum ('horizontal_push','vertical_push','horizontal_pull',
    'vertical_pull','hinge','squat','lunge','carry','isolation','core','other');
  create type load_type         as enum ('external_weight','bodyweight','assisted','duration','distance');
  create type set_kind          as enum ('warmup','ramp','working','top','backoff','dropset','rest_pause');
  create type confidence        as enum ('high','medium','low','user_verified');
  create type resolution_source as enum ('library','usda','openfoodfacts','ai_estimate','photo','manual');
  create type rule_category     as enum ('persona','output_format','nutrition','training',
    'exercise_order','planning','progression','logging','phase','safety','interaction');
  create type doc_kind          as enum ('day_nutrition','workout_session','body_trend',
    'profile','coach_rule','note');
exception when duplicate_object then null; end $$;

-- ── food ────────────────────────────────────────────────────────────────────
-- Macros are stored as a RATE per basis, never a per-entry total, so any
-- amount stays computable forever.
create table if not exists foods (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  name_norm     text not null,
  aliases       text[] not null default '{}',
  brand         text,
  basis_unit    unit_basis not null default 'g',
  basis_amount  numeric(10,2) not null default 100 check (basis_amount > 0),
  kcal          numeric(10,2) not null check (kcal >= 0),
  protein_g     numeric(10,2) not null check (protein_g >= 0),
  carbs_g       numeric(10,2) not null check (carbs_g >= 0),
  fat_g         numeric(10,2) not null check (fat_g >= 0),
  fiber_g       numeric(10,2),
  confidence    confidence not null default 'medium',
  source        resolution_source not null,
  citations     jsonb not null default '[]',
  version       int not null default 1,
  times_logged  int not null default 0,
  usual_amount  numeric(10,2),
  last_used_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (name_norm, brand)
);
create index if not exists foods_name_trgm on foods using gin (name_norm gin_trgm_ops);
create index if not exists foods_usual on foods (times_logged desc);

-- Immutable snapshot: correcting a food later must not rewrite history.
create table if not exists food_log_entries (
  id           uuid primary key,
  logged_on    date not null,
  logged_at    timestamptz not null default now(),
  meal         text,
  food_id      uuid references foods on delete set null,
  food_name    text not null,
  amount       numeric(10,2) not null check (amount > 0),
  unit         unit_basis not null,
  kcal         numeric(10,2) not null,
  protein_g    numeric(10,2) not null,
  carbs_g      numeric(10,2) not null,
  fat_g        numeric(10,2) not null,
  food_version int,
  confidence   confidence not null,
  resolved_by  resolution_source not null,
  photo_path   text,
  notes        text
);
create index if not exists fle_day on food_log_entries (logged_on desc);

-- ── training ────────────────────────────────────────────────────────────────
create table if not exists gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_current boolean not null default false
);
create unique index if not exists one_current_gym on gyms ((1)) where is_current;

create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_norm text not null unique,
  aliases text[] not null default '{}',
  muscle_group muscle_group not null,
  movement_pattern movement_pattern not null,
  load_type load_type not null,
  is_unilateral boolean not null default false,
  equipment text,
  is_active boolean not null default true
);

create table if not exists workout_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  day_label text,
  is_template boolean not null default true
);

create table if not exists plan_exercises (
  plan_id uuid not null references workout_plans on delete cascade,
  position int not null,
  exercise_id uuid not null references exercises on delete restrict,
  target_sets int,
  target_rep_low int,
  target_rep_high int,
  progression_rule text,
  primary key (plan_id, position)
);

create table if not exists workout_sessions (
  id uuid primary key,
  performed_on date not null,
  name text not null,
  plan_id uuid references workout_plans on delete set null,
  gym_id uuid references gyms on delete set null,
  notes text,
  completed_at timestamptz
);
create index if not exists ws_day on workout_sessions (performed_on desc);

create table if not exists workout_sets (
  id uuid primary key,
  session_id uuid not null references workout_sessions on delete cascade,
  exercise_id uuid not null references exercises on delete restrict,
  position int not null,
  set_index int not null,
  kind set_kind not null default 'working',
  weight_kg numeric(7,2) check (weight_kg >= 0),
  reps int check (reps >= 0),
  duration_sec int check (duration_sec >= 0),
  distance_m numeric(9,2),
  rpe numeric(3,1) check (rpe between 1 and 10),
  side text check (side in ('left','right')),
  is_failure boolean not null default false,
  is_pr boolean not null default false,      -- boolean. not 15 free-text values.
  pr_kinds text[] not null default '{}',
  notes text,
  -- generated: cannot hold text, cannot silently lose 1,802 kg
  volume_kg numeric(12,2) generated always as (
    case when weight_kg is not null and reps is not null then weight_kg * reps end
  ) stored,
  unique (session_id, position, set_index, side)
);

-- ── profile & goals ─────────────────────────────────────────────────────────
create table if not exists profile (
  id boolean primary key default true check (id),   -- exactly one row
  display_name text,
  birth_date date,
  height_cm numeric(5,1),
  sex text check (sex in ('male','female')),
  timezone text not null default 'Asia/Tokyo',
  language_pref text not null default 'en',
  unit_pref text not null default 'kg',
  medical_notes text
);

create table if not exists body_measurements (
  id uuid primary key,
  measured_on date not null unique,   -- latest row IS current weight
  weight_kg numeric(5,2),
  body_fat_pct numeric(4,1),
  lean_mass_kg numeric(5,2),
  skeletal_muscle_kg numeric(5,2),
  visceral_fat_index numeric(4,1),
  bmr_kcal int,
  water_kg numeric(5,2),
  bone_mass_kg numeric(4,2),
  waist_cm numeric(5,1),
  source text,
  notes text
);

create table if not exists nutrition_targets (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null,
  effective_to date,
  phase_label text not null,
  kcal_gym_low int, kcal_gym_high int,
  kcal_rest_low int, kcal_rest_high int,
  protein_g int not null,
  carbs_gym_low int, carbs_gym_high int,
  carbs_rest_low int, carbs_rest_high int,
  fat_low int, fat_high int,
  kcal_floor int,
  rationale text,
  check (effective_to is null or effective_to >= effective_from)
);
-- The highest-value line in this file: six conflicting targets become impossible.
create unique index if not exists one_active_target
  on nutrition_targets ((1)) where effective_to is null;

create table if not exists training_phases (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  goal_kind text not null check (goal_kind in ('cut','lean_bulk','maintenance','recomp','peak')),
  effective_from date not null,
  effective_to date,
  target_weight_kg numeric(5,2),
  target_rate_kg_per_week numeric(4,3),
  bf_ceiling_pct numeric(4,1),
  notes text
);
create unique index if not exists one_active_phase
  on training_phases ((1)) where effective_to is null;

create table if not exists physique_priorities (
  rank int primary key,
  muscle_group muscle_group not null unique,
  note text
);

create table if not exists coach_rules (
  id uuid primary key default gen_random_uuid(),
  category rule_category not null,
  title text not null,
  content text not null,
  priority int not null default 100,
  is_critical boolean not null default false,
  effective_from date not null default current_date,
  superseded_by uuid references coach_rules on delete set null,
  is_active boolean not null default true,
  source text
);
create index if not exists coach_rules_active on coach_rules (category, priority) where is_active;

-- ── retrieval & quota ───────────────────────────────────────────────────────
create table if not exists rag_documents (
  id uuid primary key default gen_random_uuid(),
  kind doc_kind not null,
  ref_date date,
  ref_id uuid,
  content text not null,
  content_hash text not null,     -- re-embed only when this changes
  embedding vector(768),
  updated_at timestamptz not null default now()
);
create unique index if not exists rag_unique on rag_documents (
  kind,
  coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(ref_date, '1970-01-01'::date)
);
create index if not exists rag_vec on rag_documents using hnsw (embedding vector_cosine_ops);

create table if not exists ai_usage_daily (
  usage_date date not null,       -- bucketed in the PROVIDER's timezone
  provider text not null,
  model text not null,
  requests int not null default 0,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  primary key (usage_date, provider, model)
);

create or replace function bump_ai_usage(
  p_usage_date date, p_provider text, p_model text, p_input int, p_output int
) returns void language sql as $$
  insert into ai_usage_daily (usage_date, provider, model, requests, input_tokens, output_tokens)
  values (p_usage_date, p_provider, p_model, 1, p_input, p_output)
  on conflict (usage_date, provider, model) do update set
    requests = ai_usage_daily.requests + 1,
    input_tokens = ai_usage_daily.input_tokens + p_input,
    output_tokens = ai_usage_daily.output_tokens + p_output;
$$;
