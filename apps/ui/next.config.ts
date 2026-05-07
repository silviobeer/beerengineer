import type { NextConfig } from "next";

const ENGINE_URL =
  process.env.BEERENGINEER_ENGINE_URL ??
  process.env.ENGINE_URL ??
  process.env.NEXT_PUBLIC_ENGINE_URL ??
  "http://127.0.0.1:4100";

const config: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_ENGINE_URL: ENGINE_URL,
  },
};

export default config;
