import { useState, type FormEvent } from 'react';
import { TrainFront } from 'lucide-react';
import { resetPassword, signIn, type User } from '../api';
import { Field, Notice, useAction } from '../ui';

const minPassword = 12;

export function Login({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [mode, setMode] = useState<'sign-in' | 'set-password'>('sign-in');
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const { busy, error, setError, run } = useAction();

  const switchMode = (next: 'sign-in' | 'set-password') => {
    setMode(next); setError(null); setDone(false); setPassword(''); setConfirm('');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const user = await signIn(email, password);
      setPassword('');
      onSignedIn(user);
    });
  };
  const setNewPassword = (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) { setError(new Error("The two passwords don't match.")); return; }
    void run(async () => {
      await resetPassword(email, code.trim(), password);
      setCode(''); setPassword(''); setConfirm('');
      setMode('sign-in');
      setDone(true);
    });
  };

  return (
    <main className="login">
      {mode === 'sign-in' ? (
        <form className="panel login-card" onSubmit={submit}>
          <div className="brand"><TrainFront aria-hidden="true" /><span>Train Fund Manager</span></div>
          <h1>Sign in</h1>
          {done && <div className="notice good" role="status">Your password is set. Sign in with it now.</div>}
          <Notice error={error} />
          <Field label="Email">
            <input type="email" autoComplete="username" required autoFocus value={email}
              onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label="Password">
            <input type="password" autoComplete="current-password" required value={password}
              onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <button type="button" className="link-button" onClick={() => switchMode('set-password')}>First time here, or forgot your password?</button>
        </form>
      ) : (
        <form className="panel login-card" onSubmit={setNewPassword}>
          <div className="brand"><TrainFront aria-hidden="true" /><span>Train Fund Manager</span></div>
          <h1>Set your password</h1>
          <p className="muted">Use the one-time setup code you were given. If you don't have one or it has expired, ask for a new one.</p>
          <Notice error={error} />
          <Field label="Email">
            <input type="email" autoComplete="username" required autoFocus value={email}
              onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label="Setup code">
            <input required autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />
          </Field>
          <Field label="New password" hint={`At least ${minPassword} characters.`}>
            <input type="password" autoComplete="new-password" required minLength={minPassword} value={password}
              onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <Field label="Repeat new password">
            <input type="password" autoComplete="new-password" required minLength={minPassword} value={confirm}
              onChange={(event) => setConfirm(event.target.value)} />
          </Field>
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button>
          <button type="button" className="link-button" onClick={() => switchMode('sign-in')}>Back to sign in</button>
        </form>
      )}
    </main>
  );
}
