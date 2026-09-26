import { Geist_Mono, Inter, Poppins } from 'next/font/google';
import { ADMIN_APP } from '@jamzo/config/apps';
import { Providers } from './providers';
import './globals.css';

// Jamzo fonts (D-107): Poppins for headings, Inter for text.
const sans = Inter({ variable: '--font-sans', subsets: ['latin'] });
const display = Poppins({ variable: '--font-display', subsets: ['latin'], weight: ['500', '600', '700'] });
const mono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata = {
  title: { default: ADMIN_APP.displayName, template: `%s · ${ADMIN_APP.displayName}` },
  description: 'Operations console for the Jamzo food-delivery platform.',
  robots: { index: false, follow: false },
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
