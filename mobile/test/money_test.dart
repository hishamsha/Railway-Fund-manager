import 'package:flutter_test/flutter_test.dart';
import 'package:train_fund_manager/core/money.dart';

void main() {
  test('parses rupees into exact integer paise', () {
    expect(parseRupeesToPaise('20000'), 2000000);
    expect(parseRupeesToPaise('20000.50'), 2000050);
    expect(parseRupeesToPaise('0.05'), 5);
    expect(parseRupeesToPaise('1.234'), isNull);
    expect(parseRupeesToPaise('-1'), isNull);
    expect(parseRupeesToPaise('10000000001'), isNull);
  });
}
