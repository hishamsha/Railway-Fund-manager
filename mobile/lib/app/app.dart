import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/auth/auth_controller.dart';
import 'router.dart';
import 'train_fund_theme.dart';

class TrainFundApp extends ConsumerStatefulWidget {
  const TrainFundApp({super.key});

  @override
  ConsumerState<TrainFundApp> createState() => _TrainFundAppState();
}

class _TrainFundAppState extends ConsumerState<TrainFundApp> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(authControllerProvider).restore());
  }

  @override
  Widget build(BuildContext context) => ShadApp.router(
    title: 'Train Fund Manager',
    color: TrainFundTheme.lightColors.primary,
    theme: TrainFundTheme.light,
    darkTheme: TrainFundTheme.dark,
    materialThemeBuilder: (context, theme) => TrainFundTheme.materialLightTheme,
    routerConfig: ref.watch(appRouterProvider),
    debugShowCheckedModeBanner: false,
  );
}
