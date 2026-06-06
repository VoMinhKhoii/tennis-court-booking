-- Tennis Court Booking v1 — public read surfaces for anon.
-- The public availability + booking pages need court names + operating hours and
-- the flat rate, but anon has no base-table access (§9: REVOKE ALL + default-deny
-- RLS on court/settings). Mirror public_availability exactly: definer-side views
-- whose column list IS the security boundary. No PII — settings.owner_uid is
-- deliberately excluded.

create view public.public_courts
	with (security_invoker = off)
as
select id, name, open_time, close_time, is_active, created_at
from public.court
where is_active;

create view public.public_settings
	with (security_invoker = off)
as
select id, flat_hourly_rate_vnd, qr_image_path
from public.settings
where id = 1;

grant select on public.public_courts to anon, authenticated;
grant select on public.public_settings to anon, authenticated;
