import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 로컬에서 주소를 바꿔(localhost / 127.0.0.1 / [::1]) 여러 사용자로 동시에 테스트할 수 있게 허용 (개발 서버 전용)
  allowedDevOrigins: ["127.0.0.1", "[::1]"],
};

export default nextConfig;
