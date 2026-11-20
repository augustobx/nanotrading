import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ERPThemeProvider } from '../nanolabs-components/ThemeContext';

export const metadata: Metadata = {
  title: 'NanoLabs AI Trading — Monitoreo Inteligente 24/7 de BTCUSDT',
  description: 'Plataforma cuantitativa de trading algorítmico y monitoreo asistido por IA de BTCUSDT Perpetual Bybit V5',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#FF6600',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" data-theme="dark" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Poppins:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-[#0c0f17] text-slate-100 antialiased selection:bg-[#FF6600]/30 selection:text-white">
        <ERPThemeProvider initialTheme="2" initialPaletteId="sunset-orange">
          {children}
        </ERPThemeProvider>
      </body>
    </html>
  );
}
