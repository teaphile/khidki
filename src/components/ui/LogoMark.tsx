export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Sotto"
    >
      <rect width="64" height="64" rx="18" fill="currentColor" />
      <path
        d="M18 21.2c0-3.2 2.6-5.7 5.8-5.7h16.4c3.2 0 5.8 2.5 5.8 5.7v11.4c0 3.2-2.6 5.8-5.8 5.8h-7.7l-9 7v-7.4a5.7 5.7 0 0 1-5.5-5.7V21.2Z"
        fill="var(--logo-bubble, #e4573d)"
      />
      <path d="M27 25h11M27 30.5h7" stroke="#fff8f0" strokeWidth="3" strokeLinecap="round" />
      <circle
        cx="45.5"
        cy="19.5"
        r="4.4"
        fill="var(--logo-dot, #1f6f68)"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}
