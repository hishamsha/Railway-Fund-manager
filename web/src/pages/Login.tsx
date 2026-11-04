import { useState, type FormEvent } from 'react';
import { TrainFront } from 'lucide-react';
import { signIn, signOut, type User } from '../api';
import { Field, Notice, useAction } from '../ui';

export function Login({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const user = await signIn(email, password);
      setPassword('');
      if (user.role !== 'owner') {
        await signOut();
        throw new Error('This page is for the business owner. Agency logins cannot use it.');
      }
      onSignedIn(user);
    });
  };

  return (
    <main className="login">
      <form className="panel login-card" onSubmit={submit}>
        <div className="brand"><TrainFront aria-hidden="true" /><span>Train Fund Manager</span></div>
        <h1>Sign in</h1>
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
      </form>
    </main>
  );
}
