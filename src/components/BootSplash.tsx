import { LogoMark } from './ui/LogoMark';

export function BootSplash() {
  return (
    <div className="boot-splash" role="status" aria-label="Loading Sotto">
      <span className="boot-splash__mark">
        <LogoMark size={52} />
      </span>
      <span className="boot-splash__word">Sotto</span>
      <span className="boot-splash__loader" aria-hidden="true" />
    </div>
  );
}
