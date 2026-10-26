import { LogoMark } from './ui/LogoMark';
import { ThemeToggle } from './ui/ThemeToggle';

export function SetupNotice() {
  return (
    <div className="setup-shell">
      <header className="auth-topbar">
        <div className="brand">
          <LogoMark />
          <span>Khidki</span>
        </div>
        <ThemeToggle />
      </header>

      <main className="setup-card">
        <span className="eyebrow">Environment setup required</span>
        <h1>Connect Supabase to start Khidki</h1>
        <p>
          Khidki uses Supabase for verified email authentication, username lookup, and real-time
          encrypted delivery. Add your project URL and public key to <code>.env.local</code>, then
          restart the dev server.
        </p>

        <pre className="code-block" aria-label="Environment variables example">
          {`VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key`}
        </pre>

        <ol className="setup-steps">
          <li>
            Create a free project at <strong>supabase.com</strong> and open the SQL Editor.
          </li>
          <li>
            Run the migrations inside <code>supabase/migrations/</code> to create profiles,
            conversations, encrypted message storage, and Row Level Security policies.
          </li>
          <li>
            Copy your Project URL and anon public key from <strong>Project Settings → API</strong>{' '}
            into <code>.env.local</code> (or into Vercel Environment Variables when deploying).
          </li>
        </ol>
      </main>
    </div>
  );
}
