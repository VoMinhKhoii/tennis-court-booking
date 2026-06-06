# Database tests

Plain-SQL assertion tests for the v1 schema (spec §11). Each file runs inside a
transaction it rolls back, leaving no residue. They assert with PL/pgSQL
`assert` and emit an `OK …` notice on success.

## Run against the linked cloud DB

After `supabase link` + `supabase db push` (and the owner-seed step in
`../seed.sql`):

```bash
# Direct connection string from the Supabase dashboard (session/pooler URL).
for f in supabase/tests/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q -f "$f"
done
```

A clean run prints one `OK …` notice per block and no `ERROR`.

## Coverage (spec §11)

| File | Asserts |
|------|---------|
| `01_overlap_adjacency.sql` | `no_overlap` rejects overlap; adjacency (`[10:00,10:30)` + `[10:30,11:00)`) coexists; generated `slot_date` is the ICT date; reject frees the slot. |
| `02_triggers_invariants.sql` | `occurrence.court_id` forced to the parent's court (spoof ignored); no active occurrence under a rejected parent; confirm mirrors to occurrences. |
| `03_enumeration_pricing.sql` | Monthly counts (5-Tuesday vs 4-Tuesday month), mid-month start locks only remaining dates, ad-hoc = 1 date; `amount = rate × hours × inserted-rows` for ad-hoc + monthly. |
| `04_security_rls.sql` | `create_pending_booking` hardcodes `status='pending'`/`source='public'` and derives `amount`; out-of-hours rejected; anon denied on every base table; anon cannot `EXECUTE` the create fn; anon **can** read `public_availability`; the view exposes exactly `court_id, slot_date, time_range, occupied`. |
| `05_nonowner_denied.sql` | A second authenticated (non-owner) uid fails `is_owner()` and is denied all base-table reads/mutations. |

## Offline pre-check (no cloud)

These were validated offline on a throwaway PostgreSQL 16 cluster with
`btree_gist`, stubbing the Supabase-only symbols (`auth.uid()`, `realtime.send`,
`storage.*`, the `anon`/`authenticated` roles). The Supabase-managed behaviors —
actual Realtime broadcast delivery, `realtime.messages` authorization, and
Storage object policies — are only fully exercised against the linked project.
