import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /* 어드민 빵 사진 업로드(app/admin/products). 기본 1MB 로는 실제 촬영본이 안 들어간다.
         Vercel 함수 요청 본문 한도가 4.5MB 라 그 아래로 둔다. 사진 한 장은 4MB 까지(버킷 설정과 같다). */
      bodySizeLimit: "4.5mb",
    },
  },
};

export default nextConfig;
