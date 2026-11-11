// Tab-scoped business views (see lib/as.ts): /as/<userId>/business/... → /business/... + x-ps-as header.
import { NextResponse, type NextRequest } from "next/server";
import { AS_HEADER, AS_RE } from "./lib/as";

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const m = pathname.match(AS_RE);
  if (!m) return NextResponse.next();
  const rest = pathname.slice(m[0].length);
  if (!rest.startsWith("/business")) return NextResponse.redirect(new URL(`${m[0]}/business/home${search}`, req.url));
  const url = req.nextUrl.clone();
  url.pathname = rest;
  const headers = new Headers(req.headers);
  headers.set(AS_HEADER, m[1]);
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = { matcher: ["/as/:path*"] };
