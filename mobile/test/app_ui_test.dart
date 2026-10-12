import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:train_fund_manager/core/ui/app_ui.dart';

void main() {
  testWidgets('fund preview fits a narrow booking screen', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: Padding(
              padding: EdgeInsets.all(12),
              child: AppSummaryCard(
                title: 'Fund Preview',
                rows: [
                  AppSummaryRowData(
                    label: 'Collected Ticket Amount',
                    value: '₹12,345.00',
                  ),
                  AppSummaryRowData(label: 'Customer Due', value: '₹409.00'),
                ],
                highlightLabel: 'Fund Balance (excl. service charge)',
                highlightValue: '₹3,000.00',
              ),
            ),
          ),
        ),
      ),
    );

    expect(tester.takeException(), isNull);
    expect(find.text('Fund Balance (excl. service charge)'), findsOneWidget);
    expect(find.text('₹3,000.00'), findsOneWidget);
  });

  testWidgets('renders AppTextField, AppSectionCard, AppSummaryCard, and AppButton correctly', (tester) async {
    final controller = TextEditingController();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: AppSectionCard(
              title: 'Journey Details',
              subtitle: 'Origin and destination stations',
              icon: Icons.train_rounded,
              children: [
                AppTextField(
                  label: 'Boarding Station',
                  hint: 'e.g. NDLS',
                  controller: controller,
                  icon: Icons.flight_takeoff_rounded,
                ),
                const SizedBox(height: 12),
                const AppSummaryCard(
                  title: 'Fund Preview',
                  rows: [
                    AppSummaryRowData(label: 'Ticket Price', value: '₹1,500.00'),
                    AppSummaryRowData(label: 'Total Payable', value: '₹1,600.00', isBold: true),
                  ],
                  highlightLabel: 'Balance Due',
                  highlightValue: '₹600.00',
                ),
                const SizedBox(height: 12),
                AppButton(
                  label: 'Save Booking',
                  icon: Icons.check_circle_rounded,
                  onPressed: () {},
                ),
              ],
            ),
          ),
        ),
      ),
    );

    expect(find.text('Journey Details'), findsOneWidget);
    expect(find.text('Origin and destination stations'), findsOneWidget);
    expect(find.text('Boarding Station'), findsOneWidget);
    expect(find.text('Fund Preview'), findsOneWidget);
    expect(find.text('Ticket Price'), findsOneWidget);
    expect(find.text('₹1,500.00'), findsOneWidget);
    expect(find.text('Balance Due'), findsOneWidget);
    expect(find.text('₹600.00'), findsOneWidget);
    expect(find.text('Save Booking'), findsOneWidget);
  });
}

