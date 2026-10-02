import { supabaseAdmin } from "@/lib/supabase/admin";

/* 빵 사진 — Supabase Storage 공개 버킷 bread-photos (011 마이그레이션). 서버(service_role)만 올린다.
   파일명에 시각을 붙여 바꿀 때마다 새 주소가 된다. 같은 주소를 덮으면 브라우저·CDN 캐시가 옛 사진을 보여준다.
   ponytail: 바꾼 뒤 옛 사진은 지우지 않는다. 쌓여서 문제가 되면 정리 잡을 둔다. */

const BUCKET = "bread-photos";
const MAX_BYTES = 4 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function photoProblem(file: File): string | null {
  if (!EXT[file.type]) return "사진은 JPG·PNG·WEBP 만 올릴 수 있어요.";
  if (file.size > MAX_BYTES) return `사진은 4MB 까지예요. 지금 ${(file.size / 1024 / 1024).toFixed(1)}MB.`;
  return null;
}

export async function uploadBreadPhoto(file: File, ticker: string): Promise<{ url: string; path: string }> {
  const path = `${ticker.toLowerCase()}-${Date.now()}.${EXT[file.type]}`;
  const storage = supabaseAdmin().storage.from(BUCKET);
  const { error } = await storage.upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`사진을 올리지 못했어요: ${error.message}`);
  return { url: storage.getPublicUrl(path).data.publicUrl, path };
}

/** 저장이 실패했을 때 방금 올린 사진을 치운다. 실패해도 저장 실패 문구가 더 중요하므로 삼킨다. */
export async function removeBreadPhoto(path: string) {
  await supabaseAdmin().storage.from(BUCKET).remove([path]).catch(() => undefined);
}
