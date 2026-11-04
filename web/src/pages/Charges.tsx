import { useEffect, useState, type FormEvent } from 'react';
import { api, type ChargeRule } from '../api';
import { paiseToInput, parseRupees } from '../money';
import { Field, Notice, PageHeader, Panel, useAction, useApi } from '../ui';

function RuleRow({ ticketType, rule, packagerId, fallback, onSaved }: { ticketType: string; rule?: ChargeRule;
  packagerId: string | null; fallback?: ChargeRule; onSaved: () => void }) {
  const [amount, setAmount] = useState(rule ? paiseToInput(rule.charge_paise) : '');
  useEffect(() => { setAmount(rule ? paiseToInput(rule.charge_paise) : ''); }, [rule]);
  const { busy, error, setError, run } = useAction();
  const label = ticketType === 'direct' ? 'Direct ticket (₹)' : 'Connected ticket (₹)';
  const save = (event: FormEvent) => {
    event.preventDefault();
    const paise = parseRupees(amount);
    if (paise === null) { setError(new Error('Enter an amount in rupees, such as 50.')); return; }
    void run(async () => {
      await api('/service-charge-rules', { method: 'PUT', body: { packager_id: packagerId, ticket_type: ticketType, charge_paise: paise } });
      onSaved();
    });
  };
  const remove = () => void run(async () => {
    await api(`/service-charge-rules/${rule!.id}`, { method: 'DELETE' });
    onSaved();
  });
  const hint = packagerId && !rule ? (fallback ? `Uses your default: ₹${paiseToInput(fallback.charge_paise)}` : 'No default set, so ₹0') : undefined;
  return (
    <form className="rule" onSubmit={save}>
      <Field label={label} hint={hint}><input inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
      <div className="row">
        <button className="primary" disabled={busy}>Save</button>
        {rule && <button type="button" className="ghost" disabled={busy} onClick={remove}>{packagerId ? 'Use default' : 'Remove'}</button>}
      </div>
      <Notice error={error} />
    </form>
  );
}

/** Direct and connected charges, either the defaults or one agency's own. */
export function RuleEditor({ packagerId }: { packagerId: string | null }) {
  const rules = useApi<{ items: ChargeRule[] }>(packagerId ? `/service-charge-rules?packager_id=${packagerId}` : '/service-charge-rules');
  const find = (ticketType: string, owner: string | null) =>
    rules.data?.items.find((rule) => rule.ticket_type === ticketType && rule.packager_id === owner);
  return (
    <>
      <Notice error={rules.error} />
      <div className="form-grid">
        {['direct', 'connected'].map((ticketType) => (
          <RuleRow key={ticketType} ticketType={ticketType} packagerId={packagerId} rule={find(ticketType, packagerId)}
            fallback={find(ticketType, null)} onSaved={rules.reload} />
        ))}
      </div>
    </>
  );
}

export function Charges() {
  return (
    <>
      <PageHeader title="Service charges" subtitle="Filled in automatically on each new booking. You can still change it per booking." />
      <Panel title="Default charges"><RuleEditor packagerId={null} /></Panel>
      <div className="notice info">To give one agency a different rate, open it from Agencies.</div>
    </>
  );
}
