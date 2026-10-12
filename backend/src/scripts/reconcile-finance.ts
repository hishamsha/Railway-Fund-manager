import 'dotenv/config';
import { closePrisma, getPrisma } from '../database/prisma.js';

const db = getPrisma();
try {
  const [wallets, receipts, debits, incomplete] = await Promise.all([
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM app.wallets w
      LEFT JOIN (
        SELECT wallet_id, sum(CASE
          WHEN entry_type IN ('top_up', 'wallet_refund', 'debit_reversal', 'manual_adjustment_credit')
            THEN amount_paise ELSE -amount_paise END) AS movement
        FROM app.wallet_entries GROUP BY wallet_id
      ) entries ON entries.wallet_id = w.id
      WHERE w.current_balance_paise <> w.opening_balance_paise + coalesce(entries.movement, 0)`,
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM app.customer_fund_entries original
      JOIN (
        SELECT reversal_of_entry_id, sum(amount_paise) AS returned
        FROM app.customer_fund_entries WHERE entry_type IN ('refund', 'reversal')
        GROUP BY reversal_of_entry_id
      ) linked ON linked.reversal_of_entry_id = original.id
      WHERE original.entry_type <> 'receipt' OR linked.returned > original.amount_paise`,
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM app.wallet_entries original
      JOIN (
        SELECT reversal_of_entry_id, sum(amount_paise) AS returned
        FROM app.wallet_entries WHERE entry_type IN ('wallet_refund', 'debit_reversal')
        GROUP BY reversal_of_entry_id
      ) linked ON linked.reversal_of_entry_id = original.id
      WHERE original.entry_type <> 'booking_debit' OR linked.returned > original.amount_paise`,
    db.operationRequest.count({ where: { completedAt: null,
      createdAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } } }),
  ]);
  const result = { wallet_mismatches: Number(wallets[0]!.count),
    receipt_over_corrections: Number(receipts[0]!.count),
    debit_over_corrections: Number(debits[0]!.count),
    incomplete_operations: incomplete };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (Object.values(result).some((value) => value !== 0)) process.exitCode = 1;
} finally {
  await closePrisma();
}
