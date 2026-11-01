import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#05070e',
};

export const metadata: Metadata = {
  title: 'AegisCloud | Enterprise Multi-Tenant API Gateway, Feature Flag & Cryptographic Audit Platform',
  description:
    'Production-grade multi-tenant control plane showcasing sliding-window rate limiting, deterministic murmur/SHA-256 feature flag rollouts, RBAC API key management, and tamper-evident hash-chained audit logs.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#060911] text-slate-100 antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
        {children}
      </body>
    </html>
  );
}

