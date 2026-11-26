-- CatLog schema. Lives in the same Supabase project as Packlist and Pickup (so one account
-- signs in to all of them), with its own catlog_ tables and catlog-photos bucket.
-- Every row belongs to one user (user_id = auth.uid()) and RLS restricts every table to its owner.

create table public.catlog_cats (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  -- The built-in "Somebody" cat for events whose culprit isn't known yet.
  is_somebody boolean not null default false,
  notes text not null default '',
  -- YYYY-MM-DD or ''.
  birthday text not null default '' check (birthday = '' or birthday ~ '^\d{4}-\d{2}-\d{2}$'),
  color text not null default '',
  sort_order integer not null default 0,
  archived boolean not null default false,
  photo text,
  created_at bigint not null,
  updated_at bigint not null,
  unique (id, user_id)
);

create table public.catlog_events (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Running event number, like 3512 (imported numbers are kept).
  number integer,
  -- Pooed, Barfed, Peed, Hairball, or anything typed.
  type text not null check (length(trim(type)) > 0),
  -- Who did it. The Somebody cat stands in for "don't know yet".
  cat_ids uuid[] not null default '{}',
  -- Local wall-clock time, YYYY-MM-DDTHH:mm (kept as text so it round-trips exactly).
  occurred_at text not null check (occurred_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
  notes text not null default '',
  -- Where it was logged from: app, shortcut, email, import.
  source text not null default '',
  photo text,
  created_at bigint not null,
  updated_at bigint not null,
  unique (id, user_id)
);

create index on public.catlog_cats (user_id);
create index on public.catlog_events (user_id);
create index on public.catlog_events (user_id, occurred_at);

do $$
declare t text;
begin
  foreach t in array array['catlog_cats','catlog_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format($p$create policy "Owner can read" on public.%I for select to authenticated using (user_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "Owner can insert" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "Owner can update" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "Owner can delete" on public.%I for delete to authenticated using (user_id = (select auth.uid()))$p$, t);
  end loop;
end $$;

alter publication supabase_realtime add table public.catlog_cats, public.catlog_events;

-- Photos: private bucket, each user may only touch files under "<their uid>/".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catlog-photos', 'catlog-photos', false, 5242880, array['image/jpeg']);

create policy "CatLog: users read own photos" on storage.objects for select to authenticated
  using (bucket_id = 'catlog-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "CatLog: users upload own photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'catlog-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "CatLog: users update own photos" on storage.objects for update to authenticated
  using (bucket_id = 'catlog-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'catlog-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "CatLog: users delete own photos" on storage.objects for delete to authenticated
  using (bucket_id = 'catlog-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Import troubleshooting reports (structure and errors only, never row data). Owner-only.
create table public.catlog_import_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  step text not null default '' check (char_length(step) <= 200),
  error text not null default '' check (char_length(error) <= 4000),
  details jsonb not null default '{}'::jsonb check (pg_column_size(details) <= 500000)
);
create index on public.catlog_import_reports (user_id, created_at desc);
alter table public.catlog_import_reports enable row level security;
alter table public.catlog_import_reports force row level security;
revoke all on public.catlog_import_reports from anon;
grant select, insert, delete on public.catlog_import_reports to authenticated;
create policy "CatLog reports: owner reads" on public.catlog_import_reports for select to authenticated using (user_id = (select auth.uid()));
create policy "CatLog reports: owner inserts" on public.catlog_import_reports for insert to authenticated with check (user_id = (select auth.uid()));
create policy "CatLog reports: owner deletes" on public.catlog_import_reports for delete to authenticated using (user_id = (select auth.uid()));

-- Shortcut keys: let iOS Shortcuts, Power Automate, email and the like log an event without
-- signing in. Only a SHA-256 hash of each key is stored; the key itself is shown once.
create table public.catlog_shortcut_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  label text not null default '' check (char_length(label) <= 100),
  -- IANA zone used to stamp the local time of events logged with this key.
  time_zone text not null default 'UTC' check (char_length(time_zone) <= 64),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index on public.catlog_shortcut_keys (user_id);
alter table public.catlog_shortcut_keys enable row level security;
alter table public.catlog_shortcut_keys force row level security;
revoke all on public.catlog_shortcut_keys from anon;
grant select, insert, delete on public.catlog_shortcut_keys to authenticated;
create policy "CatLog keys: owner reads" on public.catlog_shortcut_keys for select to authenticated using (user_id = (select auth.uid()));
create policy "CatLog keys: owner inserts" on public.catlog_shortcut_keys for insert to authenticated with check (user_id = (select auth.uid()));
create policy "CatLog keys: owner deletes" on public.catlog_shortcut_keys for delete to authenticated using (user_id = (select auth.uid()));

-- Event type from a word: poo/poop/pooped → Pooed, barf/puke/vomit → Barfed, and so on.
create or replace function public.catlog_normalize_type(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when w ~ '^(poo|poop|pooed|pooped|poops|poos|💩)$' then 'Pooed'
    when w ~ '^(barf|barfed|barfs|puke|puked|vomit|vomited|threw ?up|throw ?up|🤮)$' then 'Barfed'
    when w ~ '^(pee|peed|pees|wee|weed)$' then 'Peed'
    when w ~ '^(hairball|hairballs|hair ?ball)$' then 'Hairball'
    when w = '' then 'Pooed'
    else initcap(w)
  end
  from (select lower(trim(coalesce(p, ''))) as w) s;
$$;

-- Matches one cat name for a user: exact (case-insensitive), then without a leading "the".
create or replace function public.catlog_find_cat(p_user uuid, p_name text)
returns uuid language sql stable security definer set search_path = '' as $$
  with n as (select lower(trim(p_name)) as v)
  select c.id from public.catlog_cats c, n
  where c.user_id = p_user and not c.archived and (
    lower(trim(c.name)) = n.v
    or regexp_replace(lower(trim(c.name)), '^the\s+', '') = regexp_replace(n.v, '^the\s+', '')
    or (c.is_somebody and n.v in ('somebody', 'someone', 'unknown', '?', 'who knows'))
  )
  order by c.is_somebody, c.created_at
  limit 1;
$$;
revoke all on function public.catlog_find_cat(uuid, text) from public, anon, authenticated;

-- Logs an event for the owner of a shortcut key.
--   p_cats: one or more cat names, separated by commas, "&" or " and " (or "somebody").
--   p_type: Pooed, Barfed… (poo, poop, barf, puke also work).
--   p_at:   optional time; defaults to now. Stored in the key's time zone.
create or replace function public.catlog_quick_add(p_key text, p_cats text default 'somebody', p_type text default 'Pooed', p_notes text default '', p_at timestamptz default null, p_source text default 'shortcut')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  k public.catlog_shortcut_keys;
  ids uuid[] := '{}';
  names text[] := '{}';
  part text;
  cid uuid;
  cname text;
  t text := public.catlog_normalize_type(p_type);
  n integer;
  local text;
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  new_id uuid := gen_random_uuid();
begin
  if p_key is null or length(p_key) < 20 then
    return jsonb_build_object('ok', false, 'error', 'Missing or invalid key');
  end if;
  select * into k from public.catlog_shortcut_keys where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex');
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Unknown key. Make a new one in CatLog, Settings, Shortcuts.');
  end if;
  foreach part in array regexp_split_to_array(coalesce(nullif(trim(p_cats), ''), 'somebody'), '\s*(,|&|\+|/|\s+and\s+)\s*') loop
    continue when trim(part) = '';
    cid := public.catlog_find_cat(k.user_id, part);
    if cid is null and lower(trim(part)) in ('somebody', 'someone', 'unknown', '?') then
      -- The Somebody cat's id is the user's id, the same one the app creates.
      insert into public.catlog_cats (id, user_id, name, is_somebody, sort_order, created_at, updated_at)
      values (k.user_id, k.user_id, 'Somebody', true, 1000, now_ms, now_ms)
      on conflict (id) do nothing;
      cid := k.user_id;
    end if;
    if cid is null then
      return jsonb_build_object('ok', false, 'error', format('No cat named "%s"', trim(part)));
    end if;
    if not cid = any(ids) then
      ids := ids || cid;
      select name into cname from public.catlog_cats where id = cid;
      names := names || cname;
    end if;
  end loop;
  if length(t) > 40 then
    return jsonb_build_object('ok', false, 'error', 'Event type is too long');
  end if;
  begin
    local := to_char(coalesce(p_at, now()) at time zone k.time_zone, 'YYYY-MM-DD"T"HH24:MI');
  exception when others then
    local := to_char(coalesce(p_at, now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI');
  end;
  -- Serialize numbering per user so two quick adds never get the same number.
  perform pg_advisory_xact_lock(hashtext('catlog-number-' || k.user_id::text));
  select coalesce(max(number), 0) + 1 into n from public.catlog_events where user_id = k.user_id;
  insert into public.catlog_events (id, user_id, number, type, cat_ids, occurred_at, notes, source, created_at, updated_at)
  values (new_id, k.user_id, n, t, ids, local, left(coalesce(p_notes, ''), 2000), left(coalesce(p_source, 'shortcut'), 40), now_ms, now_ms);
  update public.catlog_shortcut_keys set last_used_at = now() where id = k.id;
  return jsonb_build_object(
    'ok', true, 'id', new_id, 'number', n, 'type', t, 'occurred_at', local,
    'cats', to_jsonb(names),
    'message', format('#%s: %s %s', n, array_to_string(names, ' & '), t)
  );
end;
$$;
revoke all on function public.catlog_quick_add(text, text, text, text, timestamptz, text) from public;
grant execute on function public.catlog_quick_add(text, text, text, text, timestamptz, text) to anon, authenticated;

-- Logs events from free text such as an email subject: "Stormy pooed", "Stormy & Bandit barfed",
-- "Luna Barfed again". Every line (or sentence) that has known cat names right before a
-- type word becomes one event. Returns what was logged.
create or replace function public.catlog_log_text(p_key text, p_text text, p_source text default 'email')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  k public.catlog_shortcut_keys;
  line text;
  m text[];
  before text;
  word text;
  cats text[];
  c record;
  results jsonb := '[]'::jsonb;
  r jsonb;
begin
  if p_key is null or length(p_key) < 20 then
    return jsonb_build_object('ok', false, 'error', 'Missing or invalid key');
  end if;
  select * into k from public.catlog_shortcut_keys where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex');
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Unknown key');
  end if;
  foreach line in array regexp_split_to_array(left(coalesce(p_text, ''), 5000), '[\r\n.!;]+') loop
    m := regexp_match(line, '^(.*?)\m(pooed|pooped|barfed|puked|vomited|peed|threw up)\M', 'i');
    continue when m is null;
    before := lower(m[1]);
    word := m[2];
    cats := '{}';
    -- Which known cats are named in the words just before the type word (longest names first).
    for c in
      select name from public.catlog_cats
      where user_id = k.user_id and not archived
      order by length(name) desc
    loop
      if before ~* ('\m' || regexp_replace(lower(c.name), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M') then
        cats := cats || c.name;
        before := regexp_replace(before, '\m' || regexp_replace(lower(c.name), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M', ' ', 'gi');
      end if;
    end loop;
    if before ~* '\m(somebody|someone)\M' and not ('Somebody' = any(cats)) then
      cats := cats || 'somebody'::text;
    end if;
    continue when cardinality(cats) = 0;
    r := public.catlog_quick_add(p_key, array_to_string(cats, ','), word, '', null, p_source);
    results := results || jsonb_build_array(r);
  end loop;
  return jsonb_build_object('ok', jsonb_array_length(results) > 0, 'logged', results,
    'message', case when jsonb_array_length(results) = 0 then 'No "<cat> pooed/barfed" found' else
      (select string_agg(x->>'message', '; ') from jsonb_array_elements(results) x) end);
end;
$$;
revoke all on function public.catlog_log_text(text, text, text) from public;
grant execute on function public.catlog_log_text(text, text, text) to anon, authenticated;
