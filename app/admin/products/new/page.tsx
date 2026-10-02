import Link from "next/link";
import { createProduct } from "../actions";
import { ProductForm } from "../ProductForm";

export const dynamic = "force-dynamic";

export default async function AdminProductNewPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="ap">
      <div>
        <Link href="/admin/products" className="ap__back">← 상품 관리</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 26, letterSpacing: "-0.03em" }}>빵 추가</h1>
      </div>
      {error ? <p className="ap-msg ap-msg--err" role="alert">{error}</p> : null}
      <ProductForm action={createProduct} />
    </main>
  );
}
