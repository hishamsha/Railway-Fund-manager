import 'package:flutter/widgets.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app/app.dart';
import 'core/auth/auth_controller.dart';

void main() {
  if (!kDebugMode && Uri.tryParse(apiBaseUrl)?.scheme != 'https') {
    throw StateError('Profile and release builds require an HTTPS API_BASE_URL');
  }
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: TrainFundApp()));
}
