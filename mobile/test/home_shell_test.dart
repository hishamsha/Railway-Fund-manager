import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:train_fund_manager/features/shell/home_shell.dart';
import 'package:train_fund_manager/app/train_fund_theme.dart';

void main() {
  testWidgets('renders custom bottom navigation bar with tabs and floating plus button', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: TrainFundTheme.materialLightTheme,
        home: const HomeShell(
          location: '/app/dashboard',
          child: Text('Dashboard Content'),
        ),
      ),
    );

    // Verify tabs from reference
    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Calendar'), findsOneWidget);
    expect(find.text('Analytics'), findsOneWidget);
    expect(find.text('Profile'), findsOneWidget);

    // Verify center plus button icon
    expect(find.byIcon(Icons.add_rounded), findsOneWidget);

    // Verify child content
    expect(find.text('Dashboard Content'), findsOneWidget);
  });
}

