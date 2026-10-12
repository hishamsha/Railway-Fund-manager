import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/money.dart';
import '../../core/ui/app_ui.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});
  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  Map<String, dynamic>? summary;
  bool loading = true;
  bool hideBalance = false;
  String? error;

  static const brandGreen = Color(0xFF00A859);
  static const brandGreenGradientStart = Color(0xFF00B360);
  static const brandGreenGradientEnd = Color(0xFF008C4A);

  @override
  void initState() {
    super.initState();
    Future.microtask(load);
  }

  Future<void> load() async {
    if (mounted) {
      setState(() {
        loading = true;
        error = null;
      });
    }
    try {
      final result = await ref
          .read(authControllerProvider)
          .api
          .get<Map<String, dynamic>>('/dashboard');
      if (mounted) setState(() => summary = result.data);
    } on DioException {
      if (mounted) setState(() => error = 'Could not load your dashboard.');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = summary;
    final recent =
        (data?['recent_bookings'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    final auth = ref.watch(authControllerProvider);

    // Operator display name
    String userName = 'Operator';
    if (auth.email != null && auth.email!.isNotEmpty) {
      final handle = auth.email!.split('@').first;
      userName = handle.isNotEmpty
          ? '${handle[0].toUpperCase()}${handle.substring(1)}'
          : 'Operator';
    }

    final collectedPaise = data?['collected_paise'] as int? ?? 0;
    final fundBalancePaise = data?['fund_balance_paise'] as int? ?? 0;
    final duePaise = data?['balance_due_paise'] as int? ?? 0;
    final totalPaise = collectedPaise + duePaise;
    final double completionRate = totalPaise > 0
        ? (collectedPaise / totalPaise).clamp(0.0, 1.0)
        : 1.0;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAF9),
      body: RefreshIndicator(
        onRefresh: load,
        color: brandGreen,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          children: [
            // 1. Top Header: User Avatar & Greeting
            Row(
              children: [
                Container(
                  height: 48,
                  width: 48,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: const Color(0xFFE2E8F0),
                    border: Border.all(color: brandGreen, width: 2),
                  ),
                  child: ClipOval(
                    child: Container(
                      color: const Color(0xFF0F172A),
                      child: Center(
                        child: Text(
                          userName.isNotEmpty ? userName[0].toUpperCase() : 'O',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                            fontSize: 20,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Welcome back',
                        style: TextStyle(
                          fontSize: 12,
                          color: Color(0xFF64748B),
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Hello, $userName',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 19,
                          fontWeight: FontWeight.w800,
                          color: Color(0xFF0F172A),
                          letterSpacing: -0.3,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),

            if (loading && data == null)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 40),
                child: Center(
                  child: CircularProgressIndicator(color: brandGreen),
                ),
              ),

            if (error != null) ...[
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.errorLight,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: AppColors.error.withValues(alpha: 0.3),
                  ),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.error_outline_rounded,
                      color: AppColors.error,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        error!,
                        style: const TextStyle(
                          color: AppColors.error,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    TextButton(onPressed: load, child: const Text('Retry')),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],

            if (data != null) ...[
              // 2. Hero Total Balance Card (Lush vibrant green matching reference)
              Container(
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [brandGreenGradientStart, brandGreenGradientEnd],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(26),
                  boxShadow: [
                    BoxShadow(
                      color: brandGreen.withValues(alpha: 0.35),
                      blurRadius: 22,
                      offset: const Offset(0, 10),
                    ),
                  ],
                ),
                padding: const EdgeInsets.all(22),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Top row: Total balance + Eye toggle
                    Row(
                      children: [
                        const Text(
                          'Fund balance · ticket − wallet',
                          style: TextStyle(
                            fontSize: 13,
                            color: Colors.white70,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const SizedBox(width: 8),
                        InkWell(
                          onTap: () =>
                              setState(() => hideBalance = !hideBalance),
                          borderRadius: BorderRadius.circular(12),
                          child: Padding(
                            padding: const EdgeInsets.all(2),
                            child: Icon(
                              hideBalance
                                  ? Icons.visibility_off_outlined
                                  : Icons.visibility_outlined,
                              color: Colors.white70,
                              size: 16,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),

                    // Amount Text
                    Text(
                      hideBalance
                          ? '₹ ••••••••'
                          : formatPaise(fundBalancePaise),
                      style: const TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                        letterSpacing: -0.5,
                      ),
                    ),
                    const SizedBox(height: 14),

                    // Bottom Pill: Collected status
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.arrow_upward_rounded,
                            size: 13,
                            color: Colors.white,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            '${formatPaise(collectedPaise)} collected from packagers',
                            style: const TextStyle(
                              fontSize: 11.5,
                              color: Colors.white,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              // Operations / Quick Services
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Operations',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFF0F172A),
                      letterSpacing: -0.2,
                    ),
                  ),
                  InkWell(
                    onTap: () => context.go('/app/packagers'),
                    child: const Text(
                      'See all',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: brandGreen,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),

              // 4 Pastel Squircle Category Cards Row
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _PastelServiceSquircle(
                    icon: Icons.groups_rounded,
                    label: 'Packagers',
                    bgColor: const Color(0xFFFEF3C7),
                    iconColor: const Color(0xFFD97706),
                    onTap: () => context.go('/app/packagers'),
                  ),
                  _PastelServiceSquircle(
                    icon: Icons.receipt_long_rounded,
                    label: 'Bookings',
                    bgColor: const Color(0xFFD1FAE5),
                    iconColor: brandGreen,
                    onTap: () => context.go('/app/bookings'),
                  ),
                  _PastelServiceSquircle(
                    icon: Icons.bar_chart_rounded,
                    label: 'Analytics',
                    bgColor: const Color(0xFFDBEAFE),
                    iconColor: const Color(0xFF2563EB),
                    onTap: () => context.go('/app/reports'),
                  ),
                  _PastelServiceSquircle(
                    icon: Icons.tune_rounded,
                    label: 'Settings',
                    bgColor: const Color(0xFFEDE9FE),
                    iconColor: const Color(0xFF7C3AED),
                    onTap: () => context.go('/app/settings'),
                  ),
                ],
              ),
              const SizedBox(height: 26),

              // 5. Savings Goal / Progress Card ("Savings goal" in reference)
              const Text(
                'Collection goal',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                  color: Color(0xFF0F172A),
                  letterSpacing: -0.2,
                ),
              ),
              const SizedBox(height: 12),

              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(22),
                  border: Border.all(
                    color: const Color(0xFFF1F5F9),
                    width: 1.5,
                  ),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x060F172A),
                      blurRadius: 14,
                      offset: Offset(0, 4),
                    ),
                  ],
                ),
                child: Row(
                  children: [
                    // Circular Progress Indicator
                    SizedBox(
                      width: 54,
                      height: 54,
                      child: Stack(
                        alignment: Alignment.center,
                        children: [
                          CircularProgressIndicator(
                            value: completionRate,
                            strokeWidth: 5,
                            backgroundColor: const Color(0xFFF1F5F9),
                            valueColor: const AlwaysStoppedAnimation<Color>(
                              brandGreen,
                            ),
                          ),
                          Text(
                            '${(completionRate * 100).toInt()}%',
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                              color: Color(0xFF0F172A),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Fund Clearance',
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF0F172A),
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '${formatPaise(collectedPaise)} of ${formatPaise(totalPaise > 0 ? totalPaise : collectedPaise)}',
                            style: const TextStyle(
                              fontSize: 12.5,
                              color: Color(0xFF64748B),
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ),
                    // Plus Action Button
                    InkWell(
                      onTap: () => context.push('/app/bookings/new'),
                      borderRadius: BorderRadius.circular(16),
                      child: Container(
                        height: 38,
                        width: 38,
                        decoration: BoxDecoration(
                          color: const Color(0xFFD1FAE5),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.add_rounded,
                          color: brandGreen,
                          size: 22,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 26),

              // 6. Recent Transactions ("Recent transactions" in reference)
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Recent transactions',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                      color: Color(0xFF0F172A),
                      letterSpacing: -0.2,
                    ),
                  ),
                  InkWell(
                    onTap: () => context.go('/app/bookings'),
                    child: const Text(
                      'See all',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: brandGreen,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              if (recent.isEmpty)
                Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: const Color(0xFFF1F5F9)),
                  ),
                  child: const Center(
                    child: Text(
                      'No bookings yet. Create one to start tracking funds.',
                      style: TextStyle(color: Color(0xFF64748B)),
                    ),
                  ),
                )
              else
                ...recent.map((booking) {
                  final due = booking['balance_due_paise'] as int;
                  final isSettled = due <= 0;

                  return Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: InkWell(
                      onTap: () async {
                        await context.push('/app/bookings/${booking['id']}');
                        if (mounted) await load();
                      },
                      borderRadius: BorderRadius.circular(20),
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: const Color(0xFFF1F5F9),
                            width: 1.2,
                          ),
                          boxShadow: const [
                            BoxShadow(
                              color: Color(0x040F172A),
                              blurRadius: 10,
                              offset: Offset(0, 2),
                            ),
                          ],
                        ),
                        child: Row(
                          children: [
                            // Squircle Icon Badge (Red for active booking due, Green for settled)
                            Container(
                              height: 46,
                              width: 46,
                              decoration: BoxDecoration(
                                color: isSettled
                                    ? const Color(0xFFD1FAE5)
                                    : const Color(0xFFE50914),
                                borderRadius: BorderRadius.circular(16),
                              ),
                              child: Center(
                                child: isSettled
                                    ? const Icon(
                                        Icons.check_rounded,
                                        color: brandGreen,
                                        size: 22,
                                      )
                                    : const Text(
                                        'N', // Red squircle brand badge style like Netflix in reference!
                                        style: TextStyle(
                                          color: Colors.white,
                                          fontWeight: FontWeight.w900,
                                          fontSize: 20,
                                        ),
                                      ),
                              ),
                            ),
                            const SizedBox(width: 14),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    '${booking['boarding_station']} → ${booking['destination_station']}',
                                    style: const TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w700,
                                      color: Color(0xFF0F172A),
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    '${booking['journey_date']} · ${booking['train_identifier']}',
                                    style: const TextStyle(
                                      fontSize: 12,
                                      color: Color(0xFF64748B),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            // Amount (Red negative due or green settled)
                            Text(
                              isSettled ? 'Settled' : '-${formatPaise(due)}',
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w800,
                                color: isSettled
                                    ? brandGreen
                                    : const Color(0xFF0F172A),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                }),
              const SizedBox(height: 20),
            ],
          ],
        ),
      ),
    );
  }
}

/// Pastel Tinted Squircle Service Button (Row 2 "Pay bills" from reference)
class _PastelServiceSquircle extends StatelessWidget {
  const _PastelServiceSquircle({
    required this.icon,
    required this.label,
    required this.bgColor,
    required this.iconColor,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final Color bgColor;
  final Color iconColor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
        child: Column(
          children: [
            Container(
              height: 58,
              width: 58,
              decoration: BoxDecoration(
                color: bgColor,
                borderRadius: BorderRadius.circular(18),
              ),
              child: Center(child: Icon(icon, color: iconColor, size: 24)),
            ),
            const SizedBox(height: 6),
            Text(
              label,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: Color(0xFF0F172A),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
