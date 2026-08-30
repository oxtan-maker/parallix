/**
 * Minimal ambient types for the one `react-dom/client` entry point this
 * client uses. `@types/react-dom` is not vendored here, and the browser
 * shell needs exactly `createRoot(...).render(...)`.
 */
declare module 'react-dom/client' {
  import type { ReactNode } from 'react';
  export interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
}
