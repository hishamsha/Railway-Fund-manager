import { useState, type FormEvent } from 'react';
import { ApiFailure, api, type User } from '../api';
import { Field, Notice, PageHeader, Panel, useAction } from '../ui';

const minPassword = 12;

export function Account({ user }: { user: User }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saved, setSaved] = useState(false);
  const { busy, error, setError, run } = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    if (next !== confirm) { setError(new Error("The two new passwords don't match.")); return; }
    void run(async () => {
      try {
        await api('/auth/change-password', { method: 'POST', body: { current_password: current, new_password: next } });
      } catch (failure) {
        if (failure instanceof ApiFailure && failure.status === 401) throw new Error('Your current password is wrong.');
        throw failure;
      }
      setCurrent(''); setNext(''); setConfirm('');
      setSaved(true);
    });
  };
  return (
    <>
      <PageHeader title="My account" subtitle={user.email} />
      <Panel title="Change password">
        <form className="narrow-form" onSubmit={submit}>
          <Field label="Current password"><input type="password" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)} /></Field>
          <Field label="New password" hint={`At least ${minPassword} characters. Other devices are signed out.`}><input type="password" autoComplete="new-password" required minLength={minPassword} value={next} onChange={(event) => setNext(event.target.value)} /></Field>
          <Field label="Repeat new password"><input type="password" autoComplete="new-password" required minLength={minPassword} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></Field>
          <Notice error={error} />
          {saved && !error && <div className="notice good" role="status">Your password is changed.</div>}
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
        </form>
      </Panel>
    </>
  );
}
