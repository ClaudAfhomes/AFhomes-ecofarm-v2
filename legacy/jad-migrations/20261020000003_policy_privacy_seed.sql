-- Privacy Policy publish (login consent + footer deep link).
--
-- The login consent note (`Secure sign-in. By continuing, you agree to our
-- Terms and Privacy Policy.`) and the footer link a `privacy` policy at the
-- canonical `/policies/privacy` route only when such a row exists; without
-- it the Privacy Policy renders as plain text. Seed the canonical privacy
-- policy exactly once, mirroring `POLICY_SEEDS` (pol-003). An
-- admin-published privacy row is never overwritten.
--
-- Validation (expect exactly one privacy row):
--   select count(*) from "Policy" where slug = 'privacy' or lower(type) = 'privacy';
--
-- Down: delete from "Policy" where id = 'pol-003' and slug = 'privacy';
insert into "Policy" (id, slug, type, title, content, updated_at)
select
  'pol-003',
  'privacy',
  'privacy',
  'Privacy Policy',
  $policy$JA&D collects only the personal information needed to operate the membership platform. Personal data is never sold. Full details are published on the official website.

1. Information We Collect
We collect registration details such as name, date of birth, contact information, country, and program selection, as well as information you provide when recording sales and referrals. We also collect limited usage information necessary to operate and secure the platform.

2. How We Use Information
We use your information to verify your identity, evaluate your application, manage your membership, process qualifying sales and commissions, and provide member services such as eWallet, payouts, and support. We do not sell your personal information to third parties.

3. Retention and Your Choices
We retain information only as long as necessary for the purposes described above and as required by law. You may request access to or correction of your information by contacting support@jad.example. For the complete policy, please visit the official JA&D website.$policy$,
  now()
where not exists (
  select 1 from "Policy" where slug = 'privacy' or lower(type) = 'privacy'
)
on conflict (id) do nothing;
