/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Prevents double WebSocket mounting in dev
  output: 'standalone',
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws/live',
  },
};

module.exports = nextConfig;
