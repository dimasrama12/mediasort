/**
 * The mark that says "this one is picked": a small blue tick in the top-right corner of a
 * thumbnail.
 *
 * It replaces the tint-and-glow the grid used to paint over selected tiles. A wash over a photo
 * changes the colours of the very thing the user is judging, and on a nine-across grid a dozen
 * glowing tiles is just noise — whereas a tick in a fixed corner is countable at a glance and
 * sits in the same place on every tile.
 *
 * The white ring is what keeps it visible on a blown-out sky as well as on a dark frame.
 */
export function SelectedCheck({ small = false }: { small?: boolean }) {
  return (
    <span
      data-testid="selected-check"
      aria-hidden
      className={`absolute z-20 grid place-items-center rounded-full bg-[var(--accent)] ring-1 ring-white/80 ${
        small ? "right-0 top-0 h-3 w-3" : "right-1 top-1 h-4 w-4"
      }`}
    >
      <svg
        viewBox="0 0 12 12"
        className={small ? "h-2 w-2" : "h-2.5 w-2.5"}
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2.6 6.3 4.9 8.6 9.4 3.6" />
      </svg>
    </span>
  );
}
