-- Booking edits append corrections instead of rewriting posted financial entries.
ALTER TABLE app.customer_fund_entries
  DROP CONSTRAINT customer_fund_entries_type_check;
ALTER TABLE app.customer_fund_entries
  ADD CONSTRAINT customer_fund_entries_type_check
  CHECK (entry_type IN ('receipt', 'refund', 'reversal',
    'collection_adjustment_increase', 'collection_adjustment_decrease')
    AND amount_paise BETWEEN 1 AND 1000000000000
    AND (method IS NULL OR method IN ('cash', 'upi', 'bank', 'other'))
    AND (entry_type IN ('refund', 'reversal')) = (reversal_of_entry_id IS NOT NULL));

ALTER TABLE app.booking_deduction_entries
  ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'booking_debit';
ALTER TABLE app.booking_deduction_entries
  ADD CONSTRAINT booking_deduction_entries_type_check
  CHECK (entry_type IN ('booking_debit', 'deduction_adjustment_decrease'));
