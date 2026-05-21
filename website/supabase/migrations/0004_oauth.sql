-- Google OAuth sign-in support.
--
-- The existing email + password flow stays intact; OAuth-only users have a
-- NULL password_hash and are matched on (oauth_provider, oauth_subject).
-- We index on the subject (stable Google `sub`) rather than email so a
-- user changing their primary Google email does not get a new account.

alter table users alter column password_hash drop not null;

alter table users add column if not exists oauth_provider text;
alter table users add column if not exists oauth_subject text;

create unique index if not exists users_oauth_identity_idx
  on users (oauth_provider, oauth_subject)
  where oauth_provider is not null and oauth_subject is not null;
