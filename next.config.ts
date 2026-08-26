import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: "standalone" dinonaktifkan untuk Vercel deployment.
  // Vercel mengelola server packaging sendiri; standalone mode menyebabkan
  // error ENOENT next-server.js.nft.json pada build Vercel.
  // Untuk self-hosted/Docker: aktifkan kembali output: "standalone" di sini.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
