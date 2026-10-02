import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAdminProduct } from "@/lib/admin/data";
import { saveProduct } from "../actions";
import { ProductForm } from "../ProductForm";

export const dynamic = "force-dynamic";

export default async function AdminProductEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const product = await loadAdminProduct(id);
  if (!product) notFound();

  return (
    <main className="ap">
      <div>
        <Link href="/admin/products" className="ap__back">← 상품 관리</Link>
        <h1 style={{ margin: "6px 0 0", fontSize: 26, letterSpacing: "-0.03em" }}>{product.display_name ?? product.name} 수정</h1>
      </div>
      {error ? <p className="ap-msg ap-msg--err" role="alert">{error}</p> : null}
      <ProductForm product={product} action={saveProduct.bind(null, product.id)} />
    </main>
  );
}
