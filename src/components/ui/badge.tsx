import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[0.68rem] font-medium tracking-wider uppercase',
  {
    variants: {
      variant: {
        accent: 'bg-accent-soft text-accent-strong',
        copper: 'bg-copper-soft text-copper',
        outline: 'border border-line text-muted',
      },
    },
    defaultVariants: {
      variant: 'accent',
    },
  },
);

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
