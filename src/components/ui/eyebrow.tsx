import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** Small mono uppercase section label — the "technical voice" of the design system. */
export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        'font-mono text-xs font-medium tracking-[0.14em] text-accent-strong uppercase',
        className,
      )}
      {...props}
    />
  );
}
