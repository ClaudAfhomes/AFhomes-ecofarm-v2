-- AF Homes: Update mutation receipt validator to allow VIP Card ID fields.
-- The 20261230000004 migration added vipCardIssued and vipCardNumber to the
-- verify_purchase_payment_once receipt, but the complete_purchase_mutation
-- validator's allowed-keys list was not updated.
-- Validation: pnpm test:db:local section 60.
-- Down: forward repair only. Restore from backup if needed.
begin;

create or replace function private.complete_purchase_mutation(p_actor uuid,p_operation text,p_request uuid,p_payload jsonb,p_result uuid,p_receipt jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,extensions,private,public,pg_temp as $$
declare k text; v jsonb;
begin
  -- Closed shape, typed per key. The receipt is the replay payload: a retried
  -- request must return the figures the original commit reported, so the finance
  -- operations carry their own verified/balance totals rather than forcing a
  -- caller to re-read them. Every added key is typed here, so widening the list
  -- does not weaken the guard - an untyped money string is still refused.
  if jsonb_typeof(p_receipt) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_receipt) x(k) where not x.k=any(
    array['resultId','status','purchaseTermsId','termsVersion','documentEvidenceId','revision','recordedAt','verifiedAt','finalizedAt',
      'paymentId','reservationId','saleId','saleNumber','commissionId','verifiedBefore','verifiedTotal','recordedTotal','balanceBefore','remainingBalance','fullyPaid',
      'vipCardIssued','vipCardNumber'])) then
    raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
  end if;
  if p_result is null or p_receipt->>'resultId' is distinct from p_result::text
    or jsonb_typeof(p_receipt->'status') is distinct from 'string'
    or not ((p_receipt->>'status')=any(array['draft','submitted','approved','rejected','cancelled','executed','recorded','verified','payment_verified','active'])) then
    raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
  end if;
  for k,v in select key,value from jsonb_each(p_receipt) loop
    if k in ('resultId','purchaseTermsId','documentEvidenceId','paymentId','reservationId','saleId','commissionId') then
      -- saleId is null on an unfinalized reservation; a present value must still
      -- be a UUID, and `null` is only ever legal for the source pointers.
      if v is distinct from 'null'::jsonb and (jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
      end if;
    elsif k='saleNumber' then
      -- An AF business identifier, never free text.
      if jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^AF-[A-Z]+-[A-HJ-NP-Z2-9]{5}$' then
        raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
      end if;
    elsif k in ('termsVersion','revision') then
      if jsonb_typeof(v)<>'number' or (v#>>'{}') !~ '^[1-9][0-9]*$' then
        raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
      end if;
    elsif k in ('verifiedBefore','verifiedTotal','recordedTotal','balanceBefore','remainingBalance') then
      -- Exact-decimal money text, never a number: a float cannot round-trip a
      -- cent total through JSON.
      if jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
        raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
      end if;
    elsif k='fullyPaid' then
      if jsonb_typeof(v)<>'boolean' then
        raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
      end if;
    elsif k='vipCardIssued' then
      if jsonb_typeof(v)<>'boolean' then
        raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
      end if;
    elsif k='vipCardNumber' then
      -- VIP Card ID format: 17 chars YYMMDD + 5-digit seq + tier + pay_code + months + classification
      -- Example: 26110900001G1C12S (validated by ^[0-9]{11}[BGS]1[CT][0-9]{2}[SN]$)
      if v is not distinct from 'null'::jsonb then
        -- null is allowed (VIP not issued)
      elsif jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[0-9]{11}[BGS]1[CT][0-9]{2}[SN]$' then
        raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
      end if;
    elsif k in ('recordedAt','verifiedAt','finalizedAt') then
      if jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
        raise exception 'MUTATION_RECEIPT_INVALID' using errcode='22023';
      end if;
    end if;
  end loop;  perform private.complete_mutation(p_actor,p_operation,p_request,p_payload,p_result);
  update private.mutation_requests mr set result_receipt=p_receipt where mr.actor_id=p_actor and mr.operation=p_operation and mr.request_id=p_request;
end $$;

revoke all on function private.complete_purchase_mutation(uuid,text,uuid,jsonb,uuid,jsonb) from public, anon, authenticated, service_role;

notify pgrst,'reload schema';
commit;