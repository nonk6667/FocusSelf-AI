import type { NextConfig } from "next";
const config: NextConfig = {
  output: "export",
  allowedDevOrigins: ["127.0.0.1"],
  images: { unoptimized: true },
  devIndicators: false,
};
export default config;
