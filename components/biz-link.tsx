"use client";
import Link from "next/link";
import type { ComponentProps } from "react";
import { useBizHref } from "@/lib/client";

/** next/link that keeps /business/... links inside the current tab-scoped business view (lib/as.ts). */
export function BizLink({ href, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const biz = useBizHref();
  return <Link href={biz(href)} {...rest} />;
}
