import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:train_fund_manager/features/reports/report_export.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('packager PDF contains an individual booking report', () async {
    final bytes = await packagerPdfBytes('Shahal', [
      <String, dynamic>{
        'boarding_station': 'Delhi',
        'destination_station': 'Jammu',
        'journey_date': '2026-12-10',
        'train_identifier': 'Jhelum',
        'ticket_price_paise': 2354100,
        'service_charge_paise': 40900,
        'total_payable_paise': 2395000,
        'collected_paise': 2395000,
        'wallet_deducted_paise': 2318000,
        'fund_balance_paise': 36100,
        'balance_due_paise': 0,
        'advance_credit_paise': 0,
        'notes': 'Test booking',
      },
    ]);
    expect(ascii.decode(bytes.take(4).toList()), '%PDF');
    expect(bytes.length, greaterThan(1000));
  });
}
