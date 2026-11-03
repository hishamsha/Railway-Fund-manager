import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:train_fund_manager/app/app.dart';
import 'package:train_fund_manager/core/auth/auth_controller.dart';

class TestAuthController extends AuthController {
  @override
  Future<void> restore() async {
    loading = false;
    notifyListeners();
  }
}

void main() {
  testWidgets('shows the redesigned login screen matching reference', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [authControllerProvider.overrideWithValue(TestAuthController())],
      child: const TrainFundApp(),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('Log in to your account'), findsOneWidget);
    expect(find.text('Email address'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);
    expect(find.text('Log In'), findsOneWidget);
    expect(find.text('Forgot password?'), findsOneWidget);
    expect(find.text('Sign up'), findsNothing);
  });
}
