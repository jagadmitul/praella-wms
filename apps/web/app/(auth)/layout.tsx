import Link from 'next/link';

const HIGHLIGHTS = [
  'Stock levels tracked per product, per warehouse — never one lump number.',
  'An append-only movement ledger that always reconciles to what is on the shelf.',
  'Role-based access down to individual actions, with staff scoped to their own site.',
];

/**
 * Split layout for the unauthenticated screens: the form on the left, a short
 * statement of what the system actually does on the right.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-lg bg-ink-900 text-xs font-bold text-white"
            >
              W
            </span>
            <span className="text-sm font-semibold tracking-tight text-ink-900">
              Warehouse OS
            </span>
          </Link>
          {children}
        </div>
      </div>

      <aside className="relative hidden overflow-hidden bg-ink-900 px-12 py-16 lg:flex lg:flex-col lg:justify-center">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        <div className="relative max-w-md">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-brand-100/70 uppercase">
            Warehouse &amp; Inventory Management
          </p>
          <h2 className="mt-4 text-3xl leading-tight font-semibold tracking-tight text-white">
            Every unit accounted for, across every site.
          </h2>

          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map((highlight) => (
              <li key={highlight} className="flex gap-3 text-sm text-white/70">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-500" />
                {highlight}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
