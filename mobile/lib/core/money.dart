import 'dart:math';
import 'package:intl/intl.dart';

final _rupees = NumberFormat.currency(locale: 'en_IN', symbol: '₹');

String formatPaise(int paise) => _rupees.format(paise / 100);

int? parseRupeesToPaise(String input) {
  final value = input.trim();
  if (!RegExp(r'^\d+(?:\.\d{1,2})?$').hasMatch(value)) return null;
  final parts = value.split('.');
  final whole = int.tryParse(parts[0]);
  if (whole == null) return null;
  final fraction = parts.length == 2 ? int.parse(parts[1].padRight(2, '0')) : 0;
  final paise = whole * 100 + fraction;
  return paise <= 1000000000000 ? paise : null;
}

String newIdempotencyKey() {
  final bytes = List<int>.generate(16, (_) => Random.secure().nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
