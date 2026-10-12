import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/money.dart';
import '../../core/ui/app_ui.dart';
import 'packagers_screen.dart';

class PackagerDetailScreen extends ConsumerStatefulWidget {
  const PackagerDetailScreen({super.key, required this.id});
  final String id;

  @override
  ConsumerState<PackagerDetailScreen> createState() => _PackagerDetailScreenState();
}

class _PackagerDetailScreenState extends ConsumerState<PackagerDetailScreen> {
  Packager? packager;
  Map<String, dynamic>? summary;
  List<Map<String, dynamic>> bookings = [];
  int? nextOffset;
  bool loadingMore = false;
  String? error;

  @override
  void initState() {
    super.initState();
    Future.microtask(load);
  }

  Future<void> load() async {
    try {
      final response = await ref.read(authControllerProvider).api
          .get<Map<String, dynamic>>('/packagers/${widget.id}/statement');
      if (mounted) {
        setState(() {
          packager = Packager.fromJson(response.data!['packager'] as Map<String, dynamic>);
          summary = response.data!['summary'] as Map<String, dynamic>;
          bookings = (response.data!['items'] as List).cast<Map<String, dynamic>>();
          nextOffset = response.data!['next_offset'] as int?;
          error = null;
        });
      }
    } on DioException {
      if (mounted) setState(() => error = 'Could not load this packager.');
    }
  }

  Future<void> loadMore() async {
    final offset = nextOffset;
    if (offset == null || loadingMore) return;
    setState(() => loadingMore = true);
    try {
      final response = await ref.read(authControllerProvider).api
          .get<Map<String, dynamic>>('/packagers/${widget.id}/statement',
            queryParameters: {'offset': offset});
      if (mounted) {
        setState(() {
          bookings.addAll((response.data!['items'] as List).cast<Map<String, dynamic>>());
          nextOffset = response.data!['next_offset'] as int?;
        });
      }
    } on DioException {
      if (mounted) setState(() => error = 'Could not load more bookings.');
    } finally {
      if (mounted) setState(() => loadingMore = false);
    }
  }

  Future<void> archive() async {
    try {
      await ref.read(authControllerProvider).api.patch('/packagers/${widget.id}', data: {'is_archived': true});
      await load();
    } on DioException {
      if (mounted) setState(() => error = 'Could not archive this packager.');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.background,
    body: SafeArea(
      child: RefreshIndicator(
        onRefresh: load,
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
          children: [
            Row(
              children: [
                InkWell(
                  onTap: () => Navigator.of(context).pop(),
                  borderRadius: BorderRadius.circular(14),
                  child: Container(
                    height: 44,
                    width: 44,
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: AppColors.border, width: 1.2),
                    ),
                    child: const Icon(
                      Icons.arrow_back_ios_new_rounded,
                      size: 18,
                      color: AppColors.textMain,
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                const Text(
                  'Packager Statement',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textMain,
                    letterSpacing: -0.4,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),

            if (error != null) ...[
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.errorLight,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.error.withValues(alpha: 0.3)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline_rounded, color: AppColors.error),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(error!, style: const TextStyle(color: AppColors.error, fontWeight: FontWeight.w600)),
                    ),
                    TextButton(onPressed: load, child: const Text('Retry')),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],

            if (packager == null && error == null)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 40),
                child: Center(child: CircularProgressIndicator()),
              ),

            if (packager case final value?) ...[
              // Profile Header Card
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: AppColors.borderLight, width: 1.5),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x080F172A),
                      blurRadius: 14,
                      offset: Offset(0, 4),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          height: 52,
                          width: 52,
                          decoration: BoxDecoration(
                            color: AppColors.primaryLight,
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: Center(
                            child: Text(
                              value.name.isNotEmpty ? value.name[0].toUpperCase() : 'P',
                              style: const TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.w800,
                                color: AppColors.primary,
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
                                value.name,
                                style: const TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w800,
                                  color: AppColors.textMain,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                value.phone ?? 'No phone number added',
                                style: const TextStyle(fontSize: 13, color: AppColors.textMuted),
                              ),
                            ],
                          ),
                        ),
                        if (value.isArchived)
                          const AppBadge(label: 'Archived', color: AppColors.warning),
                      ],
                    ),
                    if (value.notes != null && value.notes!.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppColors.borderLight),
                        ),
                        child: Text(
                          value.notes!,
                          style: const TextStyle(fontSize: 13, color: AppColors.textMuted),
                        ),
                      ),
                    ],
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: AppButton(
                            label: 'Edit Profile',
                            icon: Icons.edit_rounded,
                            isSecondary: true,
                            onPressed: () async {
                              final saved = await showDialog<bool>(
                                context: context,
                                builder: (_) => PackagerFormDialog(packager: value),
                              );
                              if (saved == true) await load();
                            },
                          ),
                        ),
                        if (!value.isArchived) ...[
                          const SizedBox(width: 12),
                          Expanded(
                            child: AppButton(
                              label: 'Archive',
                              icon: Icons.archive_outlined,
                              isDestructive: true,
                              onPressed: archive,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),

              if (summary case final totals?) ...[
                // Fund Statement Card
                AppSummaryCard(
                  title: 'Fund Statement',
                  subtitle: 'Consolidated balance across ${totals['booking_count']} bookings',
                  rows: [
                    AppSummaryRowData(
                      label: 'Total Payable',
                      value: formatPaise(totals['total_payable_paise'] as int),
                    ),
                    AppSummaryRowData(
                      label: 'Total Collected',
                      value: formatPaise(totals['collected_paise'] as int),
                    ),
                    if ((totals['net_credit_paise'] as int) > 0)
                      AppSummaryRowData(
                        label: 'Net Credit',
                        value: formatPaise(totals['net_credit_paise'] as int),
                        color: AppColors.success,
                      ),
                  ],
                  highlightLabel: 'Net Balance Due',
                  highlightValue: formatPaise(totals['net_due_paise'] as int),
                  highlightColor: (totals['net_due_paise'] as int) > 0 ? AppColors.error : AppColors.success,
                ),
                const SizedBox(height: 24),

                const Text(
                  'Bookings History',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textMain,
                  ),
                ),
                const SizedBox(height: 12),

                if (bookings.isEmpty)
                  Container(
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: AppColors.borderLight),
                    ),
                    child: const Center(
                      child: Text(
                        'No bookings for this packager yet.',
                        style: TextStyle(color: AppColors.textMuted),
                      ),
                    ),
                  )
                else
                  ...bookings.map(
                    (booking) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: InkWell(
                        onTap: () => context.push('/app/bookings/${booking['id']}'),
                        borderRadius: BorderRadius.circular(18),
                        child: Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: AppColors.surface,
                            borderRadius: BorderRadius.circular(18),
                            border: Border.all(color: AppColors.borderLight, width: 1.2),
                          ),
                          child: Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(10),
                                decoration: BoxDecoration(
                                  color: AppColors.primaryLight,
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: const Icon(Icons.train_rounded, color: AppColors.primary, size: 20),
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
                                        color: AppColors.textMain,
                                      ),
                                    ),
                                    const SizedBox(height: 3),
                                    Text(
                                      '${booking['journey_date']} · ${booking['train_identifier']}',
                                      style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
                                    ),
                                  ],
                                ),
                              ),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Text(
                                    (booking['balance_due_paise'] as int) > 0
                                        ? 'Due'
                                        : ((booking['advance_credit_paise'] as int) > 0 ? 'Credit' : 'Settled'),
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                      color: (booking['balance_due_paise'] as int) > 0
                                          ? AppColors.error
                                          : AppColors.success,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    formatPaise((booking['balance_due_paise'] as int) > 0
                                        ? booking['balance_due_paise'] as int
                                        : booking['advance_credit_paise'] as int),
                                    style: TextStyle(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w800,
                                      color: (booking['balance_due_paise'] as int) > 0
                                          ? AppColors.error
                                          : AppColors.textMain,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),

                if (nextOffset != null)
                  Center(
                    child: TextButton(
                      onPressed: loadingMore ? null : loadMore,
                      child: Text(loadingMore ? 'Loading…' : 'Load more bookings'),
                    ),
                  ),
              ],
            ],
          ],
        ),
      ),
    ),
  );
}
