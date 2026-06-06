-- Tennis Court Booking v1 — fix reference generation on Supabase.
-- create_pending_booking generates its reference with gen_random_bytes() from
-- pgcrypto. On Supabase pgcrypto lives in the `extensions` schema, and the
-- function is SECURITY DEFINER with `set search_path = public`, so the unqualified
-- call fails: "function gen_random_bytes(integer) does not exist". Found by live
-- verification against the cloud project.
--
-- Fix: ensure pgcrypto is installed (in extensions) and add `extensions` to the
-- function's locked search_path. The function body is unchanged.

create extension if not exists pgcrypto with schema extensions;

alter function public.create_pending_booking(
	uuid, text, text, text, integer, time without time zone, integer, date, integer, date
) set search_path = public, extensions;
