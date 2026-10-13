-- New commercial media-credit packs. Order snapshots, grants and refunds stay
-- at their original amounts; only future create-order snapshots use this price.
begin;

do $$
begin
  if to_regclass('public.ai_media_credit_wallets') is null
     or to_regclass('public.ai_media_video_credit_packs') is null then
    raise exception 'MEDIA_CREDIT_RECHARGE_PRICING_DEPENDENCY_MISSING';
  end if;
  if (select count(*) from public.ai_media_video_credit_packs p
      join (values ('video_50',50,800,1900),('video_100',100,1500,3500),
                   ('video_200',200,2900,6500),('video_500',500,6900,15500))
           expected(pack_key,seconds,old_cents,new_cents) on expected.pack_key=p.pack_key
      where p.seconds=expected.seconds and p.currency='eur'
        and p.amount_ht_cents in (expected.old_cents,expected.new_cents)) <> 4 then
    raise exception 'MEDIA_CREDIT_RECHARGE_PRICING_CATALOGUE_MISMATCH';
  end if;
end;
$$;

update public.ai_media_video_credit_packs p
set amount_ht_cents=price.amount_ht_cents
from (values ('video_50',1900),('video_100',3500),
             ('video_200',6500),('video_500',15500)) price(pack_key,amount_ht_cents)
where p.pack_key=price.pack_key;

commit;
