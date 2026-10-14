-- Reconcile privileges on projects whose default privileges grant service_role
-- broader DML than the Shadow lifecycle contract permits.

revoke all on table public.seo_listing_rotation_policies from service_role;
revoke all on table public.seo_market_account_capacities from service_role;
revoke all on table public.seo_listing_lifecycle_records from service_role;
revoke all on table public.seo_listing_lifecycle_events from service_role;
revoke all on table public.seo_listing_rotation_actions from service_role;

grant select, insert, update, delete on table public.seo_listing_rotation_policies to service_role;
grant select, insert, update, delete on table public.seo_market_account_capacities to service_role;
grant select, insert, update, delete on table public.seo_listing_lifecycle_records to service_role;
grant select, insert on table public.seo_listing_lifecycle_events to service_role;
grant select, insert, update on table public.seo_listing_rotation_actions to service_role;
