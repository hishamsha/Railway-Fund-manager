import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/auth/auth_controller.dart';
import '../features/shell/home_shell.dart';
import '../features/login/login_screen.dart';
import '../features/login/forgot_password_screen.dart';
import '../features/packagers/packagers_screen.dart';
import '../features/packagers/packager_detail_screen.dart';
import '../features/bookings/bookings_screen.dart';
import '../features/bookings/booking_form_screen.dart';
import '../features/bookings/booking_detail_screen.dart';
import '../features/dashboard/dashboard_screen.dart';
import '../features/reports/reports_screen.dart';
import '../features/settings/settings_screen.dart';

final appRouterProvider = Provider<GoRouter>((ref) {
  final auth = ref.watch(authControllerProvider);
  final router = GoRouter(
    initialLocation: '/login',
    refreshListenable: auth,
    redirect: (_, state) {
      if (auth.loading) return state.uri.path == '/loading' ? null : '/loading';
      final isLogin = state.uri.path == '/login';
      final isRecovery = state.uri.path == '/forgot-password';
      if (!auth.authenticated && !isLogin && !isRecovery) return '/login';
      if (auth.authenticated && (isLogin || state.uri.path == '/loading')) {
        return '/app/dashboard';
      }
      if (auth.authenticated && state.uri.path.startsWith('/app/wallets')) {
        return '/app/bookings';
      }
      return null;
    },
    routes: [
      GoRoute(path: '/', redirect: (_, _) => '/app/dashboard'),
      GoRoute(
        path: '/loading',
        builder: (_, _) => const Center(child: Text('Loading session…')),
      ),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(
        path: '/forgot-password',
        builder: (_, state) => ForgotPasswordScreen(
          initialEmail: state.extra is String ? state.extra as String : '',
        ),
      ),
      ShellRoute(
        builder: (_, state, child) =>
            HomeShell(location: state.uri.path, child: child),
        routes: [
          GoRoute(
            path: '/app/dashboard',
            builder: (_, _) => const DashboardScreen(),
          ),
          GoRoute(
            path: '/app/packagers',
            builder: (_, _) => const PackagersScreen(),
            routes: [
              GoRoute(
                path: ':id',
                builder: (_, state) =>
                    PackagerDetailScreen(id: state.pathParameters['id']!),
              ),
            ],
          ),
          GoRoute(
            path: '/app/bookings',
            builder: (_, _) => const BookingsScreen(),
            routes: [
              GoRoute(
                path: 'new',
                builder: (_, _) => const BookingFormScreen(),
              ),
              GoRoute(
                path: ':id',
                builder: (_, state) =>
                    BookingDetailScreen(id: state.pathParameters['id']!),
                routes: [
                  GoRoute(
                    path: 'edit',
                    builder: (_, state) => BookingFormScreen(
                      bookingId: state.pathParameters['id']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
          GoRoute(
            path: '/app/reports',
            builder: (_, _) => const ReportsScreen(),
          ),
          GoRoute(
            path: '/app/settings',
            builder: (_, _) => const SettingsScreen(),
          ),
        ],
      ),
    ],
    errorBuilder: (_, _) => const Center(child: Text('Page not found')),
  );
  ref.onDispose(router.dispose);
  return router;
});
