declare module 'virtual:labml-docs' {
  import type { DocPage } from '@/features/docs/compile';
  /** Every documentation page, compiled at build time (see vite-docs.ts). */
  export const DOCS: DocPage[];
}
