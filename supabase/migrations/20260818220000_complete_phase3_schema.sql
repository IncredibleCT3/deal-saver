-- Complete Phase 3 after 20260818144000_create_tracked_products.sql.
--
-- This migration is intentionally idempotent because some projects may have
-- the shared Phase 3 tables without the matching tracked_products columns.

create table if not exists public.site_profiles (
  id uuid primary key default gen_random_uuid(),
  domain text not null check (
    domain = lower(domain)
    and char_length(domain) between 1 and 253
  ),
  template_key text not null check (char_length(template_key) between 1 and 100),
  url_pattern text not null check (char_length(url_pattern) between 1 and 300),
  page_type text not null check (
    page_type in ('single_product', 'product_family')
  ),
  acquisition_method text not null check (
    acquisition_method in ('static_fetch', 'browser_required')
  ),
  requires_browser boolean not null default false,
  constraint site_profiles_method_browser_consistency_check check (
    requires_browser = (acquisition_method = 'browser_required')
  ),
  profile_json jsonb not null check (jsonb_typeof(profile_json) = 'object'),
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  status text not null default 'candidate' check (
    status in ('candidate', 'verified', 'degraded', 'disabled')
  ),
  success_count integer not null default 0 check (success_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  consecutive_failure_count integer not null default 0 check (
    consecutive_failure_count >= 0
  ),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  constraint site_profiles_domain_template_version_key
    unique (domain, template_key, version)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.site_profiles'::regclass
      and conname = 'site_profiles_method_browser_consistency_check'
  ) then
    alter table public.site_profiles
      add constraint site_profiles_method_browser_consistency_check
      check (
        requires_browser = (acquisition_method = 'browser_required')
      );
  end if;
end
$$;

create index if not exists site_profiles_lookup_idx
  on public.site_profiles (domain, status, version desc);

create table if not exists public.site_acquisition_state (
  domain text primary key check (
    domain = lower(domain)
    and char_length(domain) between 1 and 253
  ),
  preferred_method text not null default 'static_fetch' check (
    preferred_method in (
      'static_fetch',
      'browser_required',
      'server_fetch_blocked'
    )
  ),
  consecutive_failure_count integer not null default 0 check (
    consecutive_failure_count >= 0
  ),
  last_failure_code text,
  last_http_status smallint,
  retry_after timestamptz,
  last_attempted_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.profile_ai_runs (
  id uuid primary key default gen_random_uuid(),
  site_profile_id uuid references public.site_profiles (id) on delete set null,
  requested_by uuid references auth.users (id) on delete set null,
  domain text not null check (char_length(domain) between 1 and 253),
  template_key text not null check (char_length(template_key) between 1 and 100),
  run_type text not null check (run_type in ('generation', 'repair')),
  model text not null check (char_length(model) between 1 and 100),
  attempt smallint not null check (attempt between 1 and 2),
  input_chars integer not null check (input_chars >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_chars integer not null default 0 check (output_chars >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  outcome text not null check (
    outcome in ('validated', 'rejected', 'provider_error')
  ),
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists profile_ai_runs_created_at_idx
  on public.profile_ai_runs (created_at desc);

alter table public.tracked_products
  add column if not exists source_domain text,
  add column if not exists currency text not null default 'USD',
  add column if not exists product_type text not null default 'single_product',
  add column if not exists price_kind text not null default 'exact',
  add column if not exists extraction_confidence numeric(4, 3) not null default 0.500,
  add column if not exists site_profile_id uuid;

update public.tracked_products
set
  source_domain = coalesce(
    nullif(source_domain, ''),
    lower(split_part(split_part(product_url, '://', 2), '/', 1))
  ),
  currency = coalesce(currency, 'USD'),
  product_type = coalesce(product_type, 'single_product'),
  price_kind = coalesce(price_kind, 'exact'),
  extraction_confidence = coalesce(extraction_confidence, 0.500);

alter table public.tracked_products
  alter column source_domain set not null,
  alter column currency set default 'USD',
  alter column currency set not null,
  alter column product_type set default 'single_product',
  alter column product_type set not null,
  alter column price_kind set default 'exact',
  alter column price_kind set not null,
  alter column extraction_confidence set default 0.500,
  alter column extraction_confidence set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tracked_products'::regclass
      and conname = 'tracked_products_source_domain_length_check'
  ) then
    alter table public.tracked_products
      add constraint tracked_products_source_domain_length_check
      check (char_length(source_domain) between 1 and 253);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tracked_products'::regclass
      and conname = 'tracked_products_currency_check'
  ) then
    alter table public.tracked_products
      add constraint tracked_products_currency_check
      check (currency ~ '^[A-Z]{3}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tracked_products'::regclass
      and conname = 'tracked_products_product_type_check'
  ) then
    alter table public.tracked_products
      add constraint tracked_products_product_type_check
      check (product_type in ('single_product', 'product_family'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tracked_products'::regclass
      and conname = 'tracked_products_price_kind_check'
  ) then
    alter table public.tracked_products
      add constraint tracked_products_price_kind_check
      check (price_kind in ('exact', 'starting_at'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tracked_products'::regclass
      and conname = 'tracked_products_extraction_confidence_check'
  ) then
    alter table public.tracked_products
      add constraint tracked_products_extraction_confidence_check
      check (extraction_confidence between 0 and 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tracked_products'::regclass
      and conname = 'tracked_products_site_profile_id_fkey'
  ) then
    alter table public.tracked_products
      add constraint tracked_products_site_profile_id_fkey
      foreign key (site_profile_id)
      references public.site_profiles (id)
      on delete set null;
  end if;
end
$$;

alter table public.site_profiles enable row level security;
alter table public.site_acquisition_state enable row level security;
alter table public.profile_ai_runs enable row level security;

revoke all on table public.site_profiles from anon, authenticated;
revoke all on table public.site_acquisition_state from anon, authenticated;
revoke all on table public.profile_ai_runs from anon, authenticated;

grant select, insert, update on table public.site_profiles to service_role;
grant select, insert, update on table public.site_acquisition_state to service_role;
grant select, insert, update on table public.profile_ai_runs to service_role;

revoke all on table public.tracked_products from anon, authenticated;
grant select, delete on table public.tracked_products to authenticated;
grant insert (
  user_id,
  retailer,
  product_url,
  product_name,
  image_url,
  current_price,
  target_price,
  source_domain,
  currency,
  product_type,
  price_kind,
  extraction_confidence,
  site_profile_id
) on public.tracked_products to authenticated;
grant update (target_price) on public.tracked_products to authenticated;
