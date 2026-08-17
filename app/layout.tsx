import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'Omakase ELA Lab',
    template: '%s · Omakase ELA Lab',
  },
  description:
    'An independent proof-of-concept demonstrating an end-to-end robotics data pipeline for collecting, validating, synchronizing, scoring and versioning multimodal robot experience.',
  applicationName: 'Omakase ELA Lab',
  authors: [{ name: 'Ibrahim' }],
  openGraph: {
    title: 'Omakase ELA Lab',
    description: 'From robot experience to training-ready data.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-base text-ink">{children}</body>
    </html>
  );
}
