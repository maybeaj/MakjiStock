import type { Metadata } from "next";
import { loadActivePolicy } from "@/lib/bread-market/policy-server";
import { AdminNav } from "./AdminNav";
import "./admin.css";

export const metadata: Metadata = { title: "MAKJI Admin", robots: { index: false, follow: false } };

/* /admin 은 proxy.ts 가 비밀번호로 잠근다. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { version } = await loadActivePolicy();
  return (
    <div className="adm">
      <AdminNav version={version} />
      <div className="adm__main">{children}</div>
    </div>
  );
}
