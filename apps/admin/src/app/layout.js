import { Inter, Geist_Mono } from 'next/font/google';
import { ADMIN_APP } from '@jamzo/config/apps';
import { Providers } from './providers';
import './globals.css';

const sans = Inter({ variable: '--font-sans', subsets: ['latin'] });
const mono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata = {
  title: { default: ADMIN_APP.displayName, template: `%s · ${ADMIN_APP.displayName}` },
  description: 'Operations console for the Jamzo food-delivery platform.',
  robots: { index: false, follow: false },
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
