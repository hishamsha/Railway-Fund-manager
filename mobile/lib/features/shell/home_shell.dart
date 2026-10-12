import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/ui/app_ui.dart';

class HomeShell extends StatelessWidget {
  const HomeShell({super.key, required this.location, required this.child});

  final String location;
  final Widget child;

  static const drawerDestinations = <(String, String, IconData)>[
    ('Dashboard', '/app/dashboard', Icons.dashboard_rounded),
    ('Packagers', '/app/packagers', Icons.groups_rounded),
    ('Bookings', '/app/bookings', Icons.train_rounded),
    ('Analytics', '/app/reports', Icons.bar_chart_rounded),
    ('Settings', '/app/settings', Icons.settings_rounded),
  ];

  @override
  Widget build(BuildContext context) {
    final isHome = location == '/app/dashboard' || location.startsWith('/app/dashboard/');
    final isBookings = location == '/app/bookings' || location.startsWith('/app/bookings/');
    final isReports = location == '/app/reports' || location.startsWith('/app/reports/');
    final isSettings = location == '/app/settings' || location.startsWith('/app/settings/');

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text(
          'Train Fund Manager',
          style: TextStyle(
            fontSize: 19,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.3,
          ),
        ),
        backgroundColor: AppColors.surface,
        elevation: 0,
        scrolledUnderElevation: 0,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(color: AppColors.borderLight, height: 1),
        ),
      ),
      drawer: Drawer(
        backgroundColor: AppColors.surface,
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: AppColors.primaryLight,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: const Icon(Icons.train_rounded, color: AppColors.primary, size: 24),
                    ),
                    const SizedBox(width: 12),
                    const Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Train Fund Manager',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                            color: AppColors.textMain,
                          ),
                        ),
                        Text(
                          'Railway Accounting Desk',
                          style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const Divider(color: AppColors.borderLight),
              const SizedBox(height: 8),
              for (final destination in drawerDestinations)
                Builder(
                  builder: (context) {
                    final selected = location == destination.$2 || location.startsWith('${destination.$2}/');
                    return Container(
                      margin: const EdgeInsets.only(bottom: 6),
                      decoration: BoxDecoration(
                        color: selected ? AppColors.primaryLight : Colors.transparent,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: ListTile(
                        leading: Icon(
                          destination.$3,
                          color: selected ? AppColors.primary : AppColors.textMuted,
                          size: 22,
                        ),
                        title: Text(
                          destination.$1,
                          style: TextStyle(
                            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                            color: selected ? AppColors.primary : AppColors.textMain,
                            fontSize: 14,
                          ),
                        ),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        onTap: () {
                          Navigator.of(context).pop();
                          context.go(destination.$2);
                        },
                      ),
                    );
                  },
                ),
            ],
          ),
        ),
      ),
      body: child,
      bottomNavigationBar: Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.bottomCenter,
        children: [
          Container(
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF0F172A).withValues(alpha: 0.08),
                  blurRadius: 20,
                  offset: const Offset(0, -4),
                ),
              ],
            ),
            padding: const EdgeInsets.only(top: 10, bottom: 8, left: 12, right: 12),
            child: SafeArea(
              top: false,
              child: SizedBox(
                height: 56,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    // Tab 1: Home
                    _NavBarItem(
                      label: 'Home',
                      icon: isHome ? Icons.home_rounded : Icons.home_outlined,
                      isSelected: isHome,
                      onTap: () => context.go('/app/dashboard'),
                    ),
                    // Tab 2: Calendar / Bookings
                    _NavBarItem(
                      label: 'Calendar',
                      icon: isBookings ? Icons.calendar_month_rounded : Icons.calendar_today_outlined,
                      isSelected: isBookings,
                      onTap: () => context.go('/app/bookings'),
                    ),
                    // Placeholder for center floating plus button
                    const SizedBox(width: 58),
                    // Tab 3: Analytics / Reports
                    _NavBarItem(
                      label: 'Analytics',
                      icon: isReports ? Icons.analytics_rounded : Icons.analytics_outlined,
                      isSelected: isReports,
                      onTap: () => context.go('/app/reports'),
                    ),
                    // Tab 4: Profile / Settings
                    _NavBarItem(
                      label: 'Profile',
                      icon: isSettings ? Icons.person_rounded : Icons.person_outline_rounded,
                      isSelected: isSettings,
                      onTap: () => context.go('/app/settings'),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // Prominent Center Circular Plus Button
          Positioned(
            top: -18,
            child: Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: () => context.push('/app/bookings/new'),
                customBorder: const CircleBorder(),
                child: Container(
                  height: 56,
                  width: 56,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: const LinearGradient(
                      colors: [Color(0xFF008E63), Color(0xFF006646)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.primary.withValues(alpha: 0.4),
                        blurRadius: 14,
                        offset: const Offset(0, 6),
                      ),
                    ],
                  ),
                  child: const Center(
                    child: Icon(
                      Icons.add_rounded,
                      color: Colors.white,
                      size: 30,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _NavBarItem extends StatelessWidget {
  const _NavBarItem({
    required this.label,
    required this.icon,
    required this.isSelected,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final activeColor = AppColors.primary;
    const inactiveColor = Color(0xFF94A3B8);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 24,
              color: isSelected ? activeColor : inactiveColor,
            ),
            const SizedBox(height: 3),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                color: isSelected ? activeColor : inactiveColor,
                letterSpacing: -0.1,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
