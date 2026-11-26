-- Email logging by sender: a mail Cc'd or Bcc'd to CatLog's address logs events for the CatLog
-- user whose sign-in email matches the mail's From address. No shortcut key needed.
--
-- The worker checks that the mail really came from that address (DKIM or SPF, aligned with
-- From) and then calls catlog_log_email with a gateway secret. Only the worker holds the secret;
-- the database keeps its SHA-256 hash, so nobody else can log events in another user's name.

-- Each user's time zone, so events logged without the app get the right local time.
create table public.catlog_user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  time_zone text not null default 'UTC' check (char_length(time_zone) <= 64),
  updated_at timestamptz not null default now()
);
alter table public.catlog_user_settings enable row level security;
alter table public.catlog_user_settings force row level security;
revoke all on public.catlog_user_settings from anon;
grant select, insert, update on public.catlog_user_settings to authenticated;
create policy "CatLog settings: owner reads" on public.catlog_user_settings for select to authenticated using (user_id = (select auth.uid()));
create policy "CatLog settings: owner inserts" on public.catlog_user_settings for insert to authenticated with check (user_id = (select auth.uid()));
create policy "CatLog settings: owner updates" on public.catlog_user_settings for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- The mail gateway's secret (hash only). Nobody but security definer functions can read it.
create table public.catlog_mail_gateway (
  id integer primary key default 1 check (id = 1),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.catlog_mail_gateway enable row level security;
alter table public.catlog_mail_gateway force row level security;
revoke all on public.catlog_mail_gateway from public, anon, authenticated;

-- ---------- shared logic, now keyed by user instead of by shortcut key ----------

create or replace function public.catlog_add_for_user(p_user uuid, p_tz text, p_cats text, p_type text, p_notes text, p_at timestamptz, p_source text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
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
  foreach part in array regexp_split_to_array(coalesce(nullif(trim(p_cats), ''), 'somebody'), '\s*(,|&|\+|/|\s+and\s+)\s*') loop
    continue when trim(part) = '';
    cid := public.catlog_find_cat(p_user, part);
    if cid is null and lower(trim(part)) in ('somebody', 'someone', 'unknown', '?') then
      -- The Somebody cat's id is the user's id, the same one the app creates.
      insert into public.catlog_cats (id, user_id, name, is_somebody, sort_order, created_at, updated_at)
      values (p_user, p_user, 'Somebody', true, 1000, now_ms, now_ms)
      on conflict (id) do nothing;
      cid := p_user;
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
    local := to_char(coalesce(p_at, now()) at time zone coalesce(nullif(p_tz, ''), 'UTC'), 'YYYY-MM-DD"T"HH24:MI');
  exception when others then
    local := to_char(coalesce(p_at, now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI');
  end;
  -- Serialize numbering per user so two quick adds never get the same number.
  perform pg_advisory_xact_lock(hashtext('catlog-number-' || p_user::text));
  select coalesce(max(number), 0) + 1 into n from public.catlog_events where user_id = p_user;
  insert into public.catlog_events (id, user_id, number, type, cat_ids, occurred_at, notes, source, created_at, updated_at)
  values (new_id, p_user, n, t, ids, local, left(coalesce(p_notes, ''), 2000), left(coalesce(p_source, 'shortcut'), 40), now_ms, now_ms);
  return jsonb_build_object(
    'ok', true, 'id', new_id, 'number', n, 'type', t, 'occurred_at', local,
    'cats', to_jsonb(names),
    'message', format('#%s: %s %s', n, array_to_string(names, ' & '), t)
  );
end;
$$;
revoke all on function public.catlog_add_for_user(uuid, text, text, text, text, timestamptz, text) from public, anon, authenticated;

create or replace function public.catlog_text_for_user(p_user uuid, p_tz text, p_text text, p_source text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  line text;
  m text[];
  before text;
  word text;
  cats text[];
  c record;
  results jsonb := '[]'::jsonb;
begin
  foreach line in array regexp_split_to_array(left(coalesce(p_text, ''), 5000), '[\r\n.!;]+') loop
    m := regexp_match(line, '^(.*?)\m(pooed|pooped|barfed|puked|vomited|peed|threw up)\M', 'i');
    continue when m is null;
    before := lower(m[1]);
    word := m[2];
    cats := '{}';
    -- Which known cats are named in the words just before the type word (longest names first).
    for c in
      select name from public.catlog_cats
      where user_id = p_user and not archived and not is_somebody
      order by length(name) desc
    loop
      if before ~* ('\m' || regexp_replace(lower(c.name), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M') then
        cats := cats || c.name;
        before := regexp_replace(before, '\m' || regexp_replace(lower(c.name), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M', ' ', 'gi');
      end if;
    end loop;
    if before ~* '\m(somebody|someone)\M' then
      cats := cats || 'somebody'::text;
    end if;
    continue when cardinality(cats) = 0;
    results := results || jsonb_build_array(public.catlog_add_for_user(p_user, p_tz, array_to_string(cats, ','), word, '', null, p_source));
  end loop;
  return jsonb_build_object('ok', jsonb_array_length(results) > 0, 'logged', results,
    'message', case when jsonb_array_length(results) = 0 then 'No "<cat> pooed/barfed" found' else
      (select string_agg(x->>'message', '; ') from jsonb_array_elements(results) x) end);
end;
$$;
revoke all on function public.catlog_text_for_user(uuid, text, text, text) from public, anon, authenticated;

-- ---------- the key-based functions keep their signatures and now share the logic ----------

create or replace function public.catlog_quick_add(p_key text, p_cats text default 'somebody', p_type text default 'Pooed', p_notes text default '', p_at timestamptz default null, p_source text default 'shortcut')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  k public.catlog_shortcut_keys;
begin
  if p_key is null or length(p_key) < 20 then
    return jsonb_build_object('ok', false, 'error', 'Missing or invalid key');
  end if;
  select * into k from public.catlog_shortcut_keys where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex');
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Unknown key. Make a new one in CatLog, Settings, Shortcuts.');
  end if;
  update public.catlog_shortcut_keys set last_used_at = now() where id = k.id;
  return public.catlog_add_for_user(k.user_id, k.time_zone, p_cats, p_type, p_notes, p_at, p_source);
end;
$$;

create or replace function public.catlog_log_text(p_key text, p_text text, p_source text default 'email')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  k public.catlog_shortcut_keys;
begin
  if p_key is null or length(p_key) < 20 then
    return jsonb_build_object('ok', false, 'error', 'Missing or invalid key');
  end if;
  select * into k from public.catlog_shortcut_keys where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex');
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Unknown key');
  end if;
  update public.catlog_shortcut_keys set last_used_at = now() where id = k.id;
  return public.catlog_text_for_user(k.user_id, k.time_zone, p_text, p_source);
end;
$$;

-- ---------- email by sender ----------

-- Called only by the worker, after it has checked DKIM or SPF for p_from.
create or replace function public.catlog_log_email(p_secret text, p_from text, p_text text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid;
  tz text;
begin
  if p_secret is null or length(p_secret) < 32 or not exists (
    select 1 from public.catlog_mail_gateway where secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
  ) then
    return jsonb_build_object('ok', false, 'error', 'Mail gateway not set up');
  end if;
  select u.id into uid from auth.users u
  where lower(u.email) = lower(trim(p_from)) and u.email_confirmed_at is not null and u.deleted_at is null
  limit 1;
  if uid is null then
    return jsonb_build_object('ok', false, 'unknown_sender', true, 'error', 'This address isn’t a CatLog sign-in');
  end if;
  select coalesce(
    (select s.time_zone from public.catlog_user_settings s where s.user_id = uid),
    (select k.time_zone from public.catlog_shortcut_keys k where k.user_id = uid order by k.created_at desc limit 1),
    'UTC') into tz;
  return public.catlog_text_for_user(uid, tz, p_text, 'email');
end;
$$;
revoke all on function public.catlog_log_email(text, text, text) from public;
grant execute on function public.catlog_log_email(text, text, text) to anon;
