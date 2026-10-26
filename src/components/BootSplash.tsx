import { LogoMark } from './ui/LogoMark';

export function BootSplash({ label = 'Opening Khidki' }: { label?: string }) {
  return (
    <div className="boot-splash" role="status" aria-live="polite">
      <div className="boot-splash__inner">
        <LogoMark size={38} />
        <span className="boot-splash__label">{label}</span>
      </div>
    </div>
  );
}
