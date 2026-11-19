create table if not exists public.commerce_os_shopling_captcha_challenges (
  id uuid primary key,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'WAITING'
    check (status in ('WAITING', 'ANSWER_SUBMITTED', 'CONSUMED', 'EXPIRED', 'CANCELLED')),
  image_data text,
  image_hash text not null check (image_hash ~ '^[a-f0-9]{64}$'),
  image_version integer not null default 1 check (image_version >= 1),
  image_updated_at timestamptz not null default now(),
  answer_public_key text not null,
  answer_ciphertext text,
  answer_submitted_at timestamptz,
  refresh_requested_at timestamptz,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (image_data is null or (image_data like 'data:image/png;base64,%' and octet_length(image_data) <= 250000)),
  check (answer_ciphertext is null or octet_length(answer_ciphertext) <= 4096),
  check (expires_at > created_at)
);

create index if not exists commerce_os_shopling_captcha_active_idx
  on public.commerce_os_shopling_captcha_challenges (token_hash, expires_at desc);

alter table public.commerce_os_shopling_captcha_challenges enable row level security;
revoke all on public.commerce_os_shopling_captcha_challenges from anon, authenticated;
grant select, insert, update, delete on public.commerce_os_shopling_captcha_challenges to service_role;

comment on table public.commerce_os_shopling_captcha_challenges is
  'Short-lived, owner-private Shopling CAPTCHA images and local-PC-encrypted human answers.';
