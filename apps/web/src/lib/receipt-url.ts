const PARAM = "receipt";

/** The claim id a link opens a receipt on (`?receipt=<claimId>`), if any. */
export const receiptInUrl = () => new URLSearchParams(location.search).get(PARAM);

/** `href` (path, query, hash) with its receipt set to `id`, or dropped when `id` is null. */
export function withReceipt(href: string, id: string | null): string {
  const u = new URL(href, location.origin);
  if (id) u.searchParams.set(PARAM, id);
  else u.searchParams.delete(PARAM);
  return u.pathname + u.search + u.hash;
}
