/**
 * Shared bottom-sheet chrome for the mobile shell: a dimmed scrim that closes on
 * tap, plus a slide-up panel with a grab handle, a hued title row, and a close
 * button. Used by CardDetailSheet (hand) and the Offer tab's card detail.
 */
export function BottomSheet({
  hue,
  title,
  subtitle,
  onClose,
  children,
}: {
  hue: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div
        className="sheet-up relative max-h-[72vh] overflow-y-auto rounded-t-card border-t-4 bg-night-800 px-4 pb-6 pt-3 shadow-card-lift"
        style={{ borderTopColor: hue }}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/25" />
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-bold leading-tight" style={{ color: hue }}>
              {title}
            </p>
            {subtitle && (
              <p className="text-[10px] uppercase tracking-widest text-white/40">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-night-700 px-3 py-1.5 text-sm font-bold text-white/85 ring-1 ring-white/20"
          >
            ✕
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
