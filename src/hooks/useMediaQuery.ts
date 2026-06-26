import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query. SSR/initial-render safe (returns `false`
 * until mounted, then syncs to the real match). Used to switch between the
 * desktop shell and the mobile shell.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && 'matchMedia' in window
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * True below Tailwind's `lg` breakpoint (1024px) — the threshold below which
 * the new mobile shell renders instead of the desktop three-column layout.
 */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 1023px)');
}
