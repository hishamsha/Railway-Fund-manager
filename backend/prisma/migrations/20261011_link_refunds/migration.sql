-- Refunds reference the original receipt or booking debit. A reversal may
-- consume only the remaining amount after refunds, and can happen once.
ALTER TABLE app.customer_fund_entries
  DROP CONSTRAINT customer_fund_entries_type_check;
ALTER TABLE app.customer_fund_entries
  ADD CONSTRAINT customer_fund_entries_type_check
  CHECK (entry_type IN ('receipt', 'refund', 'reversal')
    AND amount_paise BETWEEN 1 AND 1000000000000
    AND (method IS NULL OR method IN ('cash', 'upi', 'bank', 'other'))
    AND (entry_type IN ('refund', 'reversal')) = (reversal_of_entry_id IS NOT NULL));

ALTER TABLE app.wallet_entries
  DROP CONSTRAINT wallet_entries_type_check;
ALTER TABLE app.wallet_entries
  ADD CONSTRAINT wallet_entries_type_check
  CHECK (entry_type IN ('top_up', 'booking_debit', 'wallet_refund', 'debit_reversal',
    'manual_adjustment_credit', 'manual_adjustment_debit')
    AND amount_paise BETWEEN 1 AND 1000000000000
    AND (entry_type NOT IN ('booking_debit', 'wallet_refund', 'debit_reversal') OR booking_id IS NOT NULL)
    AND (entry_type IN ('wallet_refund', 'debit_reversal')) = (reversal_of_entry_id IS NOT NULL));

CREATE UNIQUE INDEX customer_receipt_one_reversal
  ON app.customer_fund_entries (owner_id, booking_id, reversal_of_entry_id)
  WHERE entry_type = 'reversal';
CREATE UNIQUE INDEX wallet_debit_one_reversal
  ON app.wallet_entries (owner_id, wallet_id, reversal_of_entry_id)
  WHERE entry_type = 'debit_reversal';
