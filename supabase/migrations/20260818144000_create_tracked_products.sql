create table public.tracked_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  retailer text not null check (char_length(trim(retailer)) between 1 and 100),
  product_url text not null check (
    char_length(product_url) between 1 and 2048
    and product_url ~* '^https?://'
  ),
  product_name text not null check (char_length(trim(product_name)) between 1 and 200),
  image_url text check (
    image_url is null
    or (
      char_length(image_url) between 1 and 2048
      and image_url ~* '^https?://'
    )
  ),
  current_price numeric(12, 2) not null check (current_price >= 0),
  target_price numeric(12, 2) check (
    target_price is null or target_price >= 0
  ),
  last_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint tracked_products_user_product_url_key unique (user_id, product_url)
);

create index tracked_products_user_created_at_idx
  on public.tracked_products (user_id, created_at desc);

alter table public.tracked_products enable row level security;

create policy "Users can view their tracked products"
  on public.tracked_products
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their tracked products"
  on public.tracked_products
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their tracked products"
  on public.tracked_products
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their tracked products"
  on public.tracked_products
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.tracked_products from anon, authenticated;

grant select, delete on table public.tracked_products to authenticated;
grant insert (
  user_id,
  retailer,
  product_url,
  product_name,
  image_url,
  current_price,
  target_price
) on public.tracked_products to authenticated;
grant update (target_price) on public.tracked_products to authenticated;
