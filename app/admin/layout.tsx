import type { Metadata } from "next";
import { AdminNav } from "./AdminNav";
import "./admin.css";

export const metadata: Metadata = { title: "MAKJI Admin", robots: { index: false, follow: false } };

/* /admin 은 proxy.ts 가 비밀번호로 잠근다. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="adm">
      <AdminNav />
      <div className="adm__main">{children}</div>
    </div>
  );
}
