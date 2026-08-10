import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Warehouse & Inventory Management',
    template: '%s · WMS',
  },
  description:
    'Multi-warehouse inventory management: stock levels, movement history, replenishment, transfers and orders.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
