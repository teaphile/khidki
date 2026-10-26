import { useId } from 'react';

export function LogoMark({ size = 28 }: { size?: number }) {
  const gradientId = useId();
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="6"
          y1="6"
          x2="58"
          y2="58"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#4f46e5" />
          <stop offset="55%" stopColor="#5b5bf6" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#${gradientId})`} />
      <path
        d="M15.5 22c0-4.14 3.36-7.5 7.5-7.5h18c4.14 0 7.5 3.36 7.5 7.5v13c0 4.14-3.36 7.5-7.5 7.5H30.2l-8.4 6.6c-.98.77-2.42.07-2.42-1.18V42.3A7.49 7.49 0 0 1 15.5 35V22Z"
        fill="#ffffff"
      />
      <rect x="23" y="23.5" width="18" height="3.2" rx="1.6" fill="#4f46e5" />
      <rect x="23" y="30" width="11.5" height="3.2" rx="1.6" fill="#818cf8" />
      <circle cx="47.5" cy="16.5" r="4.5" fill="#34d399" stroke="#ffffff" strokeWidth="2" />
    </svg>
  );
}
