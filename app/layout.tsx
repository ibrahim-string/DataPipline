import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'ELA Lab — an independent build for Omakase Robotics',
    template: '%s · ELA Lab',
  },
  description:
    'An end-to-end robotics data pipeline for collecting, validating, synchronizing, scoring and versioning multimodal robot experience. Built independently by Ibrahim after reading the public Robotics Data Engineer role at Omakase Robotics. Not affiliated with Omakase Robotics; all data is synthetic.',
  applicationName: 'ELA Lab',
  authors: [{ name: 'Ibrahim', url: 'https://github.com/ibrahim-string' }],
  creator: 'Ibrahim',
  openGraph: {
    title: 'ELA Lab — an independent build for Omakase Robotics',
    description:
      'From robot experience to training-ready data. An independent proof-of-concept by Ibrahim.',
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
