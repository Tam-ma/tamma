import type { Metadata } from 'next';
import { Providers } from './providers/Providers';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'Mithqal - AI Benchmark Platform',
  description: 'AI-powered benchmark platform for testing and evaluation',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans min-h-screen">
        <div
          className="fixed inset-0 bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100"
          style={{ zIndex: -2 }}
        />
        <div
          className="fixed inset-0 opacity-10 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url(/background/1.png)',
            zIndex: -1
          }}
        />
        <div className="relative">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
