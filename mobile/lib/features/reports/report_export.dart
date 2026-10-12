import 'dart:typed_data';
import 'package:flutter/services.dart'
    show MethodChannel, PlatformException, rootBundle;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:share_plus/share_plus.dart';
import '../../core/money.dart';

Future<Uint8List> packagerPdfBytes(
  String packagerName,
  List<Map<String, dynamic>> bookings,
) async {
  final document = pw.Document();
  final latin = pw.Font.ttf(await rootBundle.load('assets/fonts/NotoSans.ttf'));
  final devanagari = pw.Font.ttf(
    await rootBundle.load('assets/fonts/NotoSansDevanagariUI-Regular.ttf'),
  );
  int total(String field) =>
      bookings.fold(0, (sum, row) => sum + (row[field] as int? ?? 0));
  pw.Widget amountCell(String label, int paise) => pw.Expanded(
    child: pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Text(
          label,
          style: const pw.TextStyle(fontSize: 7, color: PdfColors.grey700),
        ),
        pw.Text(
          formatPaise(paise),
          style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold),
        ),
      ],
    ),
  );
  document.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      maxPages: 500,
      margin: const pw.EdgeInsets.all(30),
      theme: pw.ThemeData.withFont(
        base: latin,
        bold: latin,
        fontFallback: [devanagari],
      ),
      footer: (context) => pw.Align(
        alignment: pw.Alignment.centerRight,
        child: pw.Text(
          'Page ${context.pageNumber} of ${context.pagesCount}',
          style: const pw.TextStyle(fontSize: 8, color: PdfColors.grey600),
        ),
      ),
      build: (_) => [
        pw.Text(
          'Train Fund Manager',
          style: pw.TextStyle(
            fontSize: 11,
            color: PdfColors.green800,
            fontWeight: pw.FontWeight.bold,
          ),
        ),
        pw.SizedBox(height: 4),
        pw.Text(
          'Packager Booking Report',
          style: pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold),
        ),
        pw.SizedBox(height: 8),
        pw.Text(
          packagerName,
          style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold),
        ),
        pw.Text(
          'All bookings  |  ${bookings.length} ${bookings.length == 1 ? 'booking' : 'bookings'}',
          style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey700),
        ),
        pw.SizedBox(height: 14),
        pw.Container(
          padding: const pw.EdgeInsets.all(10),
          decoration: pw.BoxDecoration(
            color: PdfColors.grey100,
            borderRadius: pw.BorderRadius.circular(8),
          ),
          child: pw.Column(
            children: [
              pw.Row(
                children: [
                  amountCell('Ticket total', total('ticket_price_paise')),
                  amountCell('Service charges', total('service_charge_paise')),
                  amountCell('Collected', total('collected_paise')),
                ],
              ),
              pw.SizedBox(height: 8),
              pw.Row(
                children: [
                  amountCell(
                    'Wallet deductions',
                    total('wallet_deducted_paise'),
                  ),
                  amountCell('Customer due', total('balance_due_paise')),
                  amountCell('Fund balance', total('fund_balance_paise')),
                ],
              ),
            ],
          ),
        ),
        pw.SizedBox(height: 14),
        for (final booking in bookings)
          pw.Container(
            margin: const pw.EdgeInsets.only(bottom: 10),
            padding: const pw.EdgeInsets.all(11),
            decoration: pw.BoxDecoration(
              border: pw.Border.all(color: PdfColors.grey300),
              borderRadius: pw.BorderRadius.circular(8),
            ),
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text(
                  '${booking['boarding_station']} to ${booking['destination_station']}',
                  style: pw.TextStyle(
                    fontSize: 11,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
                pw.Text(
                  'Journey: ${booking['journey_date']}  |  Train: ${booking['train_identifier']}',
                  style: const pw.TextStyle(
                    fontSize: 8,
                    color: PdfColors.grey700,
                  ),
                ),
                if ((booking['booking_person_mobile'] as String?)?.isNotEmpty ==
                    true) ...[
                  pw.SizedBox(height: 3),
                  pw.Text(
                    'Booking person mobile: ${booking['booking_person_mobile']}',
                    style: const pw.TextStyle(
                      fontSize: 8,
                      color: PdfColors.grey700,
                    ),
                  ),
                ],
                pw.SizedBox(height: 9),
                pw.Row(
                  children: [
                    amountCell(
                      'Ticket price',
                      booking['ticket_price_paise'] as int,
                    ),
                    amountCell(
                      'Service charge',
                      booking['service_charge_paise'] as int,
                    ),
                    amountCell(
                      'Total payable',
                      booking['total_payable_paise'] as int,
                    ),
                    amountCell('Collected', booking['collected_paise'] as int),
                  ],
                ),
                pw.SizedBox(height: 7),
                pw.Row(
                  children: [
                    amountCell(
                      'Wallet deduction',
                      booking['wallet_deducted_paise'] as int,
                    ),
                    amountCell(
                      'Customer due',
                      booking['balance_due_paise'] as int,
                    ),
                    amountCell(
                      'Fund balance',
                      booking['fund_balance_paise'] as int,
                    ),
                    amountCell(
                      'Advance credit',
                      booking['advance_credit_paise'] as int,
                    ),
                  ],
                ),
                if ((booking['notes'] as String?)?.isNotEmpty == true) ...[
                  pw.SizedBox(height: 7),
                  pw.Text(
                    'Notes: ${booking['notes']}',
                    style: const pw.TextStyle(fontSize: 8),
                  ),
                ],
              ],
            ),
          ),
      ],
    ),
  );
  return document.save();
}

Future<String?> downloadPackagerPdf(
  String packagerName,
  List<Map<String, dynamic>> bookings,
) async {
  final bytes = await packagerPdfBytes(packagerName, bookings);
  final safeName = packagerName
      .replaceAll(RegExp(r'[^A-Za-z0-9_-]+'), '_')
      .replaceAll(RegExp(r'^_+|_+$'), '');
  final shortName = safeName.isEmpty
      ? 'report'
      : safeName.substring(0, safeName.length > 50 ? 50 : safeName.length);
  final filename = 'packager_${shortName}_all_bookings.pdf';
  try {
    return await const MethodChannel(
      'train_fund_manager/downloads',
    ).invokeMethod<String>('savePdf', {'name': filename, 'bytes': bytes});
  } on PlatformException catch (error) {
    if (error.code != 'UNSUPPORTED') rethrow;
    await SharePlus.instance.share(
      ShareParams(
        files: [XFile.fromData(bytes, mimeType: 'application/pdf')],
        fileNameOverrides: [filename],
      ),
    );
    return null;
  }
}
