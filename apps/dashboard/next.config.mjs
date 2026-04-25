/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.PICOFLOW_SKIP_STANDALONE === "1" ? undefined : "standalone",
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};
export default nextConfig;
