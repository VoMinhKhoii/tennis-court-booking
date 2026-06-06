-- Tennis Court Booking v1 — Phase 1 (Database)
-- Storage for the static payment QR (§9). Public-read bucket; INSERT/UPDATE/
-- DELETE restricted to the owner. The public flow reads the QR strictly from
-- settings.qr_image_path (no client-supplied path).

insert into storage.buckets (id, name, public)
values ('qr', 'qr', true)
on conflict (id) do nothing;

-- Owner-only write (INSERT / UPDATE / DELETE) on objects in the qr bucket.
create policy "qr owner insert"
	on storage.objects for insert to authenticated
	with check (bucket_id = 'qr' and public.is_owner());

create policy "qr owner update"
	on storage.objects for update to authenticated
	using (bucket_id = 'qr' and public.is_owner())
	with check (bucket_id = 'qr' and public.is_owner());

create policy "qr owner delete"
	on storage.objects for delete to authenticated
	using (bucket_id = 'qr' and public.is_owner());

-- Public read: the bucket is public, so the QR image is served via public URL.
-- (No SELECT policy needed for a public bucket; objects are reachable by URL.)
