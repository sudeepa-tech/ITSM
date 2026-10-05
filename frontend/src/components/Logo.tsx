/** Northbeam mark: a point source throwing a beam. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-solid" />
      <path d="M9 23 L23 9 M9 23 L23 17 M9 23 L17 9" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" fill="none" opacity=".92" />
      <circle cx="9" cy="23" r="2.6" fill="#fff" />
    </svg>
  );
}
