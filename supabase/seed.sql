-- Tennis Court Booking v1 — seed data (Phase 1).
-- Loaded by `supabase db reset` (config.toml db.seed.sql_paths). Idempotent.

-- Demo courts: three, open 06:00–21:00 ICT (30 blocks/day), active. Multiple
-- courts let the auto-assign + balancing flow be exercised (owner: up to 4).
insert into public.court (name, open_time, close_time, is_active)
select v.name, time '06:00', time '21:00', true
from (values ('Sân 1'), ('Sân 2'), ('Sân 3')) as v(name)
where not exists (select 1 from public.court);

-- Single settings row. flat_hourly_rate_vnd is a fallback (minutes before the
-- first band); price_bands is the real pricing model — time-of-day rates matching
-- the advertised "Bảng Giá Theo Giờ" table. owner_uid is filled by the step below.
insert into public.settings (id, flat_hourly_rate_vnd, price_bands, qr_image_path, owner_uid)
values (
	1,
	200000,
	'[{"start":"06:00","rate":350000},{"start":"11:00","rate":300000},{"start":"15:00","rate":350000},{"start":"17:00","rate":450000}]'::jsonb,
	null,
	null
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- OWNER SEEDING (public signups are disabled — §7).
--
-- The owner auth user is NOT created by this SQL seed. Create it once via the
-- Supabase CLI/Dashboard after linking the cloud project, then record its uid in
-- settings.owner_uid (which every RLS owner policy keys on via is_owner()):
--
--   1. Create the user (one-off; choose a strong password):
--        supabase auth users create owner@example.com --password '<STRONG_PASSWORD>'
--      (or: Dashboard → Authentication → Add user; keep "Auto Confirm" on.)
--      Ensure public signups are disabled: Dashboard → Authentication → Providers
--      → Email → turn OFF "Allow new users to sign up", or in config.toml:
--        [auth] enable_signup = false  /  [auth.email] enable_signup = false
--
--   2. Record the owner uid (run against the linked DB, e.g. via the SQL editor):
--        update public.settings
--        set owner_uid = (select id from auth.users where email = 'owner@example.com')
--        where id = 1;
--
-- After step 2, the owner's authenticated session passes is_owner() and gains
-- full RLS access; any other authenticated account is denied everything.
-- ---------------------------------------------------------------------------
