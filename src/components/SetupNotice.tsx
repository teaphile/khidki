import { LockKeyhole, Server, ShieldCheck } from 'lucide-react';
import { ThemeToggle } from './ui/ThemeToggle';
import { LogoMark } from './ui/LogoMark';

export function SetupNotice() {
  return (
    <div className="setup-shell">
      <header className="setup-topbar">
        <a className="brand brand--link" href="/" aria-label="Sotto home">
          <LogoMark />
          <span>Sotto</span>
        </a>
        <ThemeToggle />
      </header>

      <main className="setup-card">
        <span className="eyebrow">Configuration required</span>
        <h1>Connect your Supabase project.</h1>
        <p className="setup-lead">
          Sotto is ready, but this deployment does not have its Supabase URL and public key yet. Add
          both environment variables in Vercel, then redeploy.
        </p>

        <div className="setup-code" aria-label="Required environment variables">
          <code>VITE_SUPABASE_URL=https://your-project.supabase.co</code>
          <code>VITE_SUPABASE_ANON_KEY=your-public-anon-key</code>
        </div>

        <div className="setup-steps">
          <div className="setup-step">
            <Server size={19} aria-hidden="true" />
            <div>
              <strong>Run the database migration</strong>
              <p>Apply the SQL file in the Supabase SQL editor before the first signup.</p>
            </div>
          </div>
          <div className="setup-step">
            <LockKeyhole size={19} aria-hidden="true" />
            <div>
              <strong>Enable email confirmation</strong>
              <p>Turn off phone signup and require a verified email address for every account.</p>
            </div>
          </div>
          <div className="setup-step">
            <ShieldCheck size={19} aria-hidden="true" />
            <div>
              <strong>Keep the service role key private</strong>
              <p>Only the public anon key belongs in this browser application.</p>
            </div>
          </div>
        </div>

        <p className="setup-footnote">
          Full setup instructions are in <code>README.md</code> and <code>supabase/README.md</code>.
        </p>
      </main>
    </div>
  );
}
