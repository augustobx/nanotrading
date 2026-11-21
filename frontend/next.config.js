/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Prevents double WebSocket mounting in dev
  output: 'standalone',
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || '',
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://nanolabs_trading_backend:3001';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
