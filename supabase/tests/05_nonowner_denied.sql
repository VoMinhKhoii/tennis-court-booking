-- DB tests (§11): a second (non-owner) authenticated user is denied all reads
-- and mutations on base tables. We simulate auth by setting the JWT claims and
-- the 'authenticated' role; is_owner() returns false because the random uid does
-- not equal settings.owner_uid.

begin;

-- Seed a court + an owner uid that is NOT the test user.
do $$
declare v_owner uuid := gen_random_uuid();
begin
	insert into public.court (name, open_time, close_time) values ('N', time '06:00', time '21:00');
	insert into public.settings (id, flat_hourly_rate_vnd, owner_uid)
	values (1, 200000, v_owner)
	on conflict (id) do update set owner_uid = excluded.owner_uid;
end;
$$;

-- Become a different authenticated user.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare v_cnt int;
begin
	assert public.is_owner() = false, 'non-owner unexpectedly passed is_owner()';

	-- RLS default-deny: policies require is_owner(), so reads return zero rows.
	select count(*) into v_cnt from public.court;
	assert v_cnt = 0, format('non-owner read court rows: %s', v_cnt);
	select count(*) into v_cnt from public.settings;
	assert v_cnt = 0, format('non-owner read settings rows: %s', v_cnt);

	-- Mutations are blocked by the WITH CHECK clause.
	declare v_denied boolean := false;
	begin
		begin
			insert into public.court (name, open_time, close_time) values ('hack', time '06:00', time '07:00');
		exception when insufficient_privilege then v_denied := true;
		end;
		assert v_denied, 'non-owner could INSERT a court';
	end;

	raise notice 'OK 05 non-owner denied';
end;
$$;

reset role;
rollback;
