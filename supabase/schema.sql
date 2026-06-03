create table if not exists public.dividend_snapshots (
  ticker text primary key,
  stock_name text not null,
  dividend numeric,
  payment_day date,
  ex_date date,
  market text not null,
  currency text not null,
  source text not null,
  source_symbol text not null,
  updated_at timestamptz not null default now()
);

create index if not exists dividend_snapshots_updated_at_idx
  on public.dividend_snapshots (updated_at desc);

alter table public.dividend_snapshots enable row level security;

drop policy if exists "public read dividend snapshots" on public.dividend_snapshots;

create policy "public read dividend snapshots"
on public.dividend_snapshots
for select
using (true);
