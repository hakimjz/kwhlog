-- Skema database aplikasi listrik rumah.
-- Jalankan sekali di Supabase SQL Editor (Dashboard > SQL Editor > New query).

create table if not exists public.kwhlog_readings (
  id         text        not null,              -- 'r-YYYYMMDDHHMM' atau 't-...' untuk beli token
  user_id    uuid        not null references auth.users (id) on delete cascade,
  ts         timestamp   not null,              -- waktu lokal (WIB), tanpa timezone, sengaja
  type       text        not null default 'reading' check (type in ('reading','topup')),
  kwh        numeric     not null,              -- angka yang terbaca di meter
  added      numeric,                           -- kWh yang masuk (hanya untuk type = 'topup')
  rp         numeric,                           -- nominal dibayar (hanya untuk type = 'topup')
  tags       text[]      not null default '{}', -- ac, noac, kosong, cuci, pompa
  suhu       smallint,                          -- suhu AC saat tag 'ac' dipakai
  note       text,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, ts),
  constraint topup_lengkap check (type <> 'topup' or added is not null)
);

create index if not exists kwhlog_readings_user_ts_idx on public.kwhlog_readings (user_id, ts);

create table if not exists public.kwhlog_settings (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  tarif      numeric     not null default 1444.70,  -- Rp per kWh, dipakai sebelum ada data beli token
  updated_at timestamptz not null default now()
);

-- user_id diisi otomatis dari sesi login, jadi aplikasi tidak perlu mengirimnya.
alter table public.kwhlog_readings alter column user_id set default auth.uid();
alter table public.kwhlog_settings alter column user_id set default auth.uid();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists kwhlog_readings_touch on public.kwhlog_readings;
create trigger kwhlog_readings_touch before update on public.kwhlog_readings
  for each row execute function public.touch_updated_at();

drop trigger if exists kwhlog_settings_touch on public.kwhlog_settings;
create trigger kwhlog_settings_touch before update on public.kwhlog_settings
  for each row execute function public.touch_updated_at();

-- Row Level Security: tiap orang hanya bisa menyentuh barisnya sendiri.
-- Tanpa ini, anon key yang terlihat di browser bisa dipakai siapa saja.
alter table public.kwhlog_readings enable row level security;
alter table public.kwhlog_settings enable row level security;

drop policy if exists kwhlog_readings_select on public.kwhlog_readings;
drop policy if exists kwhlog_readings_insert on public.kwhlog_readings;
drop policy if exists kwhlog_readings_update on public.kwhlog_readings;
drop policy if exists kwhlog_readings_delete on public.kwhlog_readings;

create policy kwhlog_readings_select on public.kwhlog_readings
  for select using (auth.uid() = user_id);
create policy kwhlog_readings_insert on public.kwhlog_readings
  for insert with check (auth.uid() = user_id);
create policy kwhlog_readings_update on public.kwhlog_readings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy kwhlog_readings_delete on public.kwhlog_readings
  for delete using (auth.uid() = user_id);

drop policy if exists kwhlog_settings_select on public.kwhlog_settings;
drop policy if exists kwhlog_settings_insert on public.kwhlog_settings;
drop policy if exists kwhlog_settings_update on public.kwhlog_settings;

create policy kwhlog_settings_select on public.kwhlog_settings
  for select using (auth.uid() = user_id);
create policy kwhlog_settings_insert on public.kwhlog_settings
  for insert with check (auth.uid() = user_id);
create policy kwhlog_settings_update on public.kwhlog_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
