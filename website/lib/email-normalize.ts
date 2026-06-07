/**
 * Canonicalize an email for uniqueness checks so plus-addressing
 * (`a+1@x.com`, `a+2@x.com`, …) can't be used to farm unlimited free accounts —
 * all major providers route `+tag` to the same inbox. We lowercase and strip
 * the `+tag` from the local part. We deliberately do NOT strip gmail dots:
 * dot-handling is provider-specific and stripping risks false collisions.
 */
export function canonicalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  let local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus !== -1) local = local.slice(0, plus);
  return `${local}@${domain}`;
}
