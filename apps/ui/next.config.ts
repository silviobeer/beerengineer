import type { NextConfig } from "next";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:4100";

const config: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_ENGINE_URL: ENGINE_URL,
  },
};

export default config;
