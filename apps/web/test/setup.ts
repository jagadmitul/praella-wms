import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

/**
 * Next.js navigation hooks have no meaning outside the framework's runtime, so
 * they are stubbed with the small surface the components actually use.
 */
vi.mock('next/navigation', () => ({
  usePathname: () => '/products',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

// `<dialog>` is not implemented in jsdom.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
}
