import type { Metadata } from 'next';
import './globals.css';
import { TakuBridgeClient } from '@/__taku/TakuBridgeClient';
import { AgentationProvider } from '@/components/AgentationProvider';
import { TakuClientActionBridge } from '@/components/TakuClientActionBridge';

export const metadata: Metadata = {
  title: 'Taku App',
  description: '基于 Next.js + TypeScript + Tailwind CSS 的应用模板',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="scroll-smooth" suppressHydrationWarning>
      <body className="font-sans antialiased min-h-screen bg-background text-foreground">
        <main className="relative flex min-h-screen flex-col">
          <TakuBridgeClient />
          <TakuClientActionBridge />
          {children}
          <AgentationProvider />
        </main>
      </body>
    </html>
  );
}
