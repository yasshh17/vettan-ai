-- Supabase's API rejects a DELETE without WHERE (pg-safeupdate), even inside a
-- function, so the key-loss runbook failed. Same function, with "where true".
create or replace function public.declare_analytics_key_lost(p_confirm text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_product bigint;
  v_essential bigint;
  v_requests bigint;
begin
  if p_confirm is distinct from 'I-HAVE-LOST-THE-ANALYTICS-ID-SECRET' then
    raise exception 'confirmation text does not match';
  end if;

  update analytics_key_check set state = 'lost', updated_at = now() where name = 'id';

  delete from product_events where true;
  get diagnostics v_product = row_count;
  delete from analytics_events where actor_id is not null;
  get diagnostics v_essential = row_count;

  update analytics_consent c set erasure_completed_at = now()
    from analytics_erasure_requests r
    where r.user_id = c.user_id and r.kind = 'withdrawal' and r.status = 'pending';
  update analytics_erasure_requests set status = 'erased' where status = 'pending';
  get diagnostics v_requests = row_count;
  delete from analytics_erasure_requests where kind = 'withdrawal';

  return jsonb_build_object(
    'product_events', v_product, 'analytics_events', v_essential, 'requests', v_requests
  );
end;
$$;
