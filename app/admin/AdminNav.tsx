"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin/products", label: "상품 관리" },
  { href: "/admin/pricing", label: "할인율 관리" },
  { href: "/admin/audit", label: "변경 기록" },
  { href: "/admin/kpi", label: "KPI" },
];

export function AdminNav({ version }: { version: string }) {
  const pathname = usePathname();
  return (
    <nav className="adm__nav" aria-label="어드민 메뉴">
      <div className="adm__brand">
        <b>Makji Stock</b>
        <span>어드민</span>
      </div>
      <div className="adm__links">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="adm__link" aria-current={pathname.startsWith(l.href) ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </div>
      <div className="adm__ver">
        <span>운영 중인 산식</span>
        <b>{version}</b>
      </div>
    </nav>
  );
}
