// Tab-scoped business views for the demo.
//
// The demo session is one cookie per browser, so switching role in one tab used to switch every tab.
// A business view opened at /as/<userId>/business/... carries its identity in the URL instead:
// proxy.ts rewrites it to /business/... with an x-ps-as header, the browser API helper sends the same
// header, and currentUser() honours it for business users only (never operator or admin). The operator
// tab keeps its cookie, so the operator and several businesses can be open side by side.
export const AS_HEADER = "x-ps-as";
export const AS_RE = /^\/as\/([A-Za-z0-9_-]+)(?=\/|$)/;

/** "/as/usr_x" when the path is a tab-scoped business view, else "". */
export function asPrefix(pathname: string | null | undefined): string {
  const m = pathname?.match(AS_RE);
  return m ? m[0] : "";
}

export function asUserId(pathname: string | null | undefined): string | null {
  return pathname?.match(AS_RE)?.[1] ?? null;
}

/** URL of a business page in its own tab-scoped view. */
export function businessViewUrl(userId: string, path = "/business/home") {
  return `/as/${userId}${path}`;
}
