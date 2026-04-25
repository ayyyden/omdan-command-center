-- Drop the auto-named check constraint and recreate with yelp added
alter table customers drop constraint if exists customers_lead_source_check;
alter table customers add constraint customers_lead_source_check
  check (lead_source in (
    'referral','google','facebook','instagram',
    'door_knock','repeat_customer','yard_sign',
    'nextdoor','yelp','other'
  ));
