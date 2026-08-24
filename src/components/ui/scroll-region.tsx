import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * V35 — a box that scrolls sideways, and that a keyboard can enter.
 *
 * A `div` with `overflow-x: auto` around a wide table is the standard way to
 * keep a page from scrolling. It is also, on its own, a WCAG 2.1.1 failure:
 * the box scrolls, but nothing inside it takes focus, so a keyboard user
 * cannot reach the columns past the right edge. axe names it
 * `scrollable-region-focusable`, and it only fires when the content actually
 * overflows — which is why it stayed invisible here for so long. Every e2e
 * test ran at 1280 px, where these tables fit.
 *
 * The audit found it twice: on the six tables of `/docs/refus` (fixed in the
 * Markdown compiler, so no page can forget it) and then, once a phone-sized
 * project existed, on the Data Studio's preview. Thirteen such containers
 * exist across the app. Rather than patch them one at a time and wait for the
 * fourteenth, this is the one place that knows how a scrollable region is
 * built.
 *
 * The region is always named — a box announced as « region » and nothing else
 * tells a screen-reader user nothing about what they just entered. `label`
 * carries the panel's own title where one is at hand; where none is, the
 * default at least says what the thing is and that it scrolls.
 */
export function ScrollRegion({
  label,
  className,
  children,
  ...rest
}: {
  label?: string;
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'children'>) {
  const { t } = useTranslation();
  return (
    <div
      role="region"
      aria-label={label ?? t('common.scrollRegion')}
      tabIndex={0}
      className={cn(
        'overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
