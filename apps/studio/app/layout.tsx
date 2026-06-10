import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Open App Studio',
  description: 'Build, clone, and ship mobile apps like Lego — powered by AI agents.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <h1>
            <Link href="/">🧱 Open App Studio</Link>
          </h1>
          <span className="crumb">clone · explore · build</span>
        </header>
        {children}
      </body>
    </html>
  );
}
