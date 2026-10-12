import 'dart:math' as math;
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/money.dart';
import '../../core/ui/app_ui.dart';
import '../packagers/packagers_screen.dart';
import 'report_export.dart';

class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});
  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen> {
  String? packagerId;
  List<Packager> packagers = [];
  List<Map<String, dynamic>> rows = [];
  Map<String, dynamic>? overview;
  bool overviewLoading = true;
  String? overviewError;
  bool searched = false;
  bool loading = false;
  String? exportingPackagerId;
  String? error;
  String? downloadMessage;
  int generation = 0;

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      loadPackagers();
      loadOverview();
    });
  }

  Future<void> loadPackagers() async {
    try {
      final all = <Packager>[];
      String? cursor;
      do {
        final filters = <String, dynamic>{
          'limit': 100,
          'include_archived': 'true',
        };
        if (cursor != null) filters['cursor'] = cursor;
        final response = await ref
            .read(authControllerProvider)
            .api
            .get<Map<String, dynamic>>('/packagers', queryParameters: filters);
        all.addAll(
          (response.data!['items'] as List).map(
            (item) => Packager.fromJson(item as Map<String, dynamic>),
          ),
        );
        cursor = response.data!['next_cursor'] as String?;
      } while (cursor != null);
      if (mounted) setState(() => packagers = all);
    } on DioException {
      if (mounted) {
        setState(() => error = 'Could not load packagers. Retry this page.');
      }
    }
  }

  Future<void> loadOverview() async {
    if (mounted) {
      setState(() {
        overviewLoading = true;
        overviewError = null;
      });
    }
    try {
      final result = await ref
          .read(authControllerProvider)
          .api
          .get<Map<String, dynamic>>('/dashboard');
      if (mounted) setState(() => overview = result.data);
    } on DioException {
      if (mounted) {
        setState(() => overviewError = 'Could not load analytics totals.');
      }
    } finally {
      if (mounted) setState(() => overviewLoading = false);
    }
  }

  void changeFilters() {
    generation++;
    setState(() {
      searched = false;
      rows = [];
      error = null;
      downloadMessage = null;
    });
  }

  Future<void> refreshAll() async {
    await loadOverview();
    if (searched) await search();
  }

  Future<void> search() async {
    final current = ++generation;
    final chosenPackagerId = packagerId;
    setState(() {
      loading = true;
      searched = false;
      rows = [];
      error = null;
      downloadMessage = null;
    });
    try {
      final all = <Map<String, dynamic>>[];
      int? offset = 0;
      int? expected;
      while (offset != null) {
        if (offset > 10000) {
          throw StateError('Too many bookings for this report');
        }
        final filters = <String, dynamic>{'limit': 100, 'offset': offset};
        if (chosenPackagerId != null) filters['packager_id'] = chosenPackagerId;
        final response = await ref
            .read(authControllerProvider)
            .api
            .get<Map<String, dynamic>>(
              '/reports/bookings',
              queryParameters: filters,
            );
        if (!mounted || current != generation) return;
        expected ??=
            (response.data!['summary'] as Map<String, dynamic>)['booking_count']
                as int;
        all.addAll(
          (response.data!['items'] as List).cast<Map<String, dynamic>>(),
        );
        offset = response.data!['next_offset'] as int?;
      }
      if (all.length != expected ||
          all.map((row) => row['id']).toSet().length != all.length) {
        throw StateError('Report changed during search');
      }
      if (mounted && current == generation) {
        setState(() {
          rows = all;
          searched = true;
        });
      }
    } catch (_) {
      if (mounted && current == generation) {
        setState(
          () => error =
              'Could not load a complete report. Try selecting one packager.',
        );
      }
    } finally {
      if (mounted && current == generation) setState(() => loading = false);
    }
  }

  Future<void> exportPackager(
    String id,
    String name,
    List<Map<String, dynamic>> bookings,
  ) async {
    if (exportingPackagerId != null) return;
    setState(() {
      exportingPackagerId = id;
      error = null;
      downloadMessage = null;
    });
    try {
      final download = await downloadPackagerPdf(name, bookings);
      if (mounted && download.filename != null) {
        setState(() {
          downloadMessage =
              'Saved to Downloads/TrainFundManager/${download.filename}. '
              '${download.opened ? 'PDF opened.' : 'No PDF viewer is available; open it from Downloads.'}'
              '${download.notified ? ' Tap the notification to reopen it.' : ' Allow notifications for this app to see download alerts.'}';
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => error = 'Could not save this packager PDF.');
      }
    } finally {
      if (mounted) setState(() => exportingPackagerId = null);
    }
  }

  Map<String, List<Map<String, dynamic>>> get groups {
    final grouped = <String, List<Map<String, dynamic>>>{};
    for (final row in rows) {
      (grouped[row['packager_id'] as String] ??= []).add(row);
    }
    final ids = grouped.keys.toList()
      ..sort((a, b) {
        final nameA = (grouped[a]!.first['packager_name'] as String)
            .toLowerCase();
        final nameB = (grouped[b]!.first['packager_name'] as String)
            .toLowerCase();
        return nameA.compareTo(nameB);
      });
    return {for (final id in ids) id: grouped[id]!};
  }

  @override
  Widget build(BuildContext context) {
    final resultGroups = groups;
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: refreshAll,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
            children: [
              const Text(
                'Analytics',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textMain,
                ),
              ),
              const SizedBox(height: 2),
              const Text(
                'Your railway funds at a glance',
                style: TextStyle(fontSize: 13, color: AppColors.textMuted),
              ),
              const SizedBox(height: 18),
              if (overview != null) ...[
                _AnalyticsOverviewCard(data: overview!),
                const SizedBox(height: 22),
              ] else if (overviewLoading) ...[
                const _OverviewLoadingCard(),
                const SizedBox(height: 22),
              ],
              if (overviewError != null) ...[
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        overviewError!,
                        style: const TextStyle(color: AppColors.error),
                      ),
                    ),
                    TextButton(
                      onPressed: loadOverview,
                      child: const Text('Retry'),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
              ],
              const Text(
                'Packager Reports',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textMain,
                ),
              ),
              const SizedBox(height: 3),
              const Text(
                'Search bookings and download each packager as a PDF',
                style: TextStyle(fontSize: 12, color: AppColors.textMuted),
              ),
              const SizedBox(height: 14),
              AppSectionCard(
                title: 'Report Search',
                subtitle: 'Filter by packager',
                icon: Icons.filter_list_rounded,
                children: [
                  AppDropdownField<String>(
                    label: 'Packager',
                    value: packagerId ?? '',
                    icon: Icons.person_outline_rounded,
                    items: [
                      const DropdownMenuItem(
                        value: '',
                        child: Text('All Packagers'),
                      ),
                      for (final packager in packagers)
                        DropdownMenuItem(
                          value: packager.id,
                          child: Text(packager.name),
                        ),
                    ],
                    onChanged: (value) {
                      packagerId = value == null || value.isEmpty
                          ? null
                          : value;
                      changeFilters();
                    },
                  ),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: loading ? null : search,
                      icon: const Icon(Icons.search_rounded),
                      label: Text(loading ? 'Searching…' : 'Search'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              if (error != null) ...[
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AppColors.errorLight,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Text(
                    error!,
                    style: const TextStyle(color: AppColors.error),
                  ),
                ),
                const SizedBox(height: 14),
              ],
              if (downloadMessage != null) ...[
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AppColors.primaryLight,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Text(
                    downloadMessage!,
                    style: const TextStyle(color: AppColors.primary),
                  ),
                ),
                const SizedBox(height: 14),
              ],
              if (loading)
                const Padding(
                  padding: EdgeInsets.all(30),
                  child: Center(child: CircularProgressIndicator()),
                ),
              if (!searched && !loading && error == null)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 20),
                  child: Center(
                    child: Text(
                      'Choose a packager or search all packagers.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.textMuted),
                    ),
                  ),
                ),
              if (searched && rows.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(22),
                  child: Center(
                    child: Text(
                      'No bookings found.',
                      style: TextStyle(color: AppColors.textMuted),
                    ),
                  ),
                ),
              if (searched && rows.isNotEmpty) ...[
                Text(
                  '${rows.length} ${rows.length == 1 ? 'booking' : 'bookings'} | ${resultGroups.length} ${resultGroups.length == 1 ? 'packager' : 'packagers'}',
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textMuted,
                  ),
                ),
                const SizedBox(height: 12),
                for (final entry in resultGroups.entries) ...[
                  _PackagerReportCard(
                    name: entry.value.first['packager_name'] as String,
                    bookings: entry.value,
                    exporting: exportingPackagerId == entry.key,
                    onExport: () => exportPackager(
                      entry.key,
                      entry.value.first['packager_name'] as String,
                      entry.value,
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _PackagerReportCard extends StatelessWidget {
  const _PackagerReportCard({
    required this.name,
    required this.bookings,
    required this.exporting,
    required this.onExport,
  });
  final String name;
  final List<Map<String, dynamic>> bookings;
  final bool exporting;
  final VoidCallback onExport;

  int total(String field) =>
      bookings.fold(0, (sum, row) => sum + (row[field] as int? ?? 0));

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: AppColors.borderLight, width: 1.5),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          name,
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w800,
            color: AppColors.textMain,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          '${bookings.length} ${bookings.length == 1 ? 'booking' : 'bookings'}',
          style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
        ),
        const SizedBox(height: 14),
        Wrap(
          spacing: 14,
          runSpacing: 8,
          children: [
            _GroupTotal(label: 'Collected', value: total('collected_paise')),
            _GroupTotal(
              label: 'Service charges',
              value: total('service_charge_paise'),
            ),
            _GroupTotal(
              label: 'Fund balance',
              value: total('fund_balance_paise'),
            ),
          ],
        ),
        const SizedBox(height: 16),
        for (final booking in bookings) ...[
          _BookingReportRow(data: booking),
          const SizedBox(height: 10),
        ],
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: exporting ? null : onExport,
            icon: const Icon(Icons.picture_as_pdf_outlined),
            label: Text(
              exporting ? 'Preparing PDF…' : 'Download $name PDF',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.primary,
              side: const BorderSide(color: AppColors.primary),
              padding: const EdgeInsets.symmetric(vertical: 13),
            ),
          ),
        ),
      ],
    ),
  );
}

class _GroupTotal extends StatelessWidget {
  const _GroupTotal({required this.label, required this.value});
  final String label;
  final int value;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
      ),
      Text(
        formatPaise(value),
        style: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w800,
          color: AppColors.textMain,
        ),
      ),
    ],
  );
}

class _BookingReportRow extends StatelessWidget {
  const _BookingReportRow({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: AppColors.background,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: AppColors.border),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${data['boarding_station']} → ${data['destination_station']}',
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w800,
            color: AppColors.textMain,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          '${data['journey_date']} · ${data['train_identifier']}',
          style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
        ),
        if ((data['booking_person_mobile'] as String?)?.isNotEmpty == true) ...[
          const SizedBox(height: 3),
          Text(
            'Booking person mobile: ${data['booking_person_mobile']}',
            style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
          ),
        ],
        const SizedBox(height: 12),
        _ReportAmount(
          label: 'Ticket price',
          value: data['ticket_price_paise'] as int,
        ),
        _ReportAmount(
          label: 'Service charge',
          value: data['service_charge_paise'] as int,
        ),
        _ReportAmount(
          label: 'Total payable',
          value: data['total_payable_paise'] as int,
        ),
        _ReportAmount(
          label: 'Collected',
          value: data['collected_paise'] as int,
        ),
        _ReportAmount(
          label: 'Wallet deduction',
          value: data['wallet_deducted_paise'] as int,
        ),
        _ReportAmount(
          label: 'Customer due',
          value: data['balance_due_paise'] as int,
        ),
        _ReportAmount(
          label: 'Fund balance',
          value: data['fund_balance_paise'] as int,
          highlighted: true,
        ),
        if ((data['notes'] as String?)?.isNotEmpty == true) ...[
          const SizedBox(height: 8),
          Text(
            'Notes: ${data['notes']}',
            style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
          ),
        ],
      ],
    ),
  );
}

class _ReportAmount extends StatelessWidget {
  const _ReportAmount({
    required this.label,
    required this.value,
    this.highlighted = false,
  });
  final String label;
  final int value;
  final bool highlighted;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 5),
    child: Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: highlighted ? AppColors.primary : AppColors.textMuted,
              fontWeight: highlighted ? FontWeight.w700 : FontWeight.w400,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Text(
          formatPaise(value),
          style: TextStyle(
            fontSize: 12,
            color: highlighted ? AppColors.primary : AppColors.textMain,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}

class _OverviewLoadingCard extends StatelessWidget {
  const _OverviewLoadingCard();

  @override
  Widget build(BuildContext context) => const SizedBox(
    height: 208,
    child: DecoratedBox(
      decoration: BoxDecoration(
        color: Color(0xFF111C2B),
        borderRadius: BorderRadius.all(Radius.circular(24)),
      ),
      child: Center(child: CircularProgressIndicator(color: Color(0xFF34D399))),
    ),
  );
}

class _AnalyticsOverviewCard extends StatelessWidget {
  const _AnalyticsOverviewCard({required this.data});

  final Map<String, dynamic> data;
  static const emerald = Color(0xFF37D5AA);
  static const violet = Color(0xFF9D8BFF);
  static const orange = Color(0xFFFFB547);

  @override
  Widget build(BuildContext context) {
    final collected = data['collected_paise'] as int? ?? 0;
    final charges = data['service_charge_paise'] as int? ?? 0;
    final balance = data['fund_balance_paise'] as int? ?? 0;
    final payable = data['total_payable_paise'] as int? ?? 0;
    final ticket = math.max(0, payable - charges);
    final ringBalance = balance.clamp(0, ticket);
    final ringWallet = ticket - ringBalance;
    final ringCharges = math.max(0, charges);
    final ringTotal = ringBalance + ringWallet + ringCharges;
    final count = data['booking_count'] as int? ?? 0;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF111C2B),
        borderRadius: BorderRadius.circular(24),
        boxShadow: const [
          BoxShadow(
            color: Color(0x190F172A),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Funds overview',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 17,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFF263445),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  'All time | $count ${count == 1 ? 'booking' : 'bookings'}',
                  style: const TextStyle(
                    color: Color(0xFFD1DCE6),
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              SizedBox(
                width: 124,
                height: 124,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    CustomPaint(
                      size: const Size.square(124),
                      painter: _FundRingPainter(
                        balanceShare: ringTotal > 0
                            ? ringBalance / ringTotal
                            : 0,
                        walletShare: ringTotal > 0 ? ringWallet / ringTotal : 0,
                        chargeShare: ringTotal > 0
                            ? ringCharges / ringTotal
                            : 0,
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(19),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Text(
                            'Balance',
                            style: TextStyle(
                              color: Color(0xFFC4D0DD),
                              fontSize: 11,
                            ),
                          ),
                          const SizedBox(height: 2),
                          FittedBox(
                            fit: BoxFit.scaleDown,
                            child: Text(
                              formatPaise(balance),
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 17,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  children: [
                    _OverviewMetric(
                      label: 'Fund collected',
                      amount: collected,
                      color: violet,
                    ),
                    const SizedBox(height: 11),
                    _OverviewMetric(
                      label: 'Service charges billed',
                      amount: charges,
                      color: orange,
                    ),
                    const SizedBox(height: 11),
                    _OverviewMetric(
                      label: 'Fund balance',
                      amount: balance,
                      color: emerald,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 15),
          const Text(
            'Ring: balance (green) | wallet (purple) | charges (orange)',
            style: TextStyle(color: Color(0xFF9FB0C1), fontSize: 10),
          ),
          const SizedBox(height: 3),
          const Text(
            'Balance = ticket price - wallet deductions',
            style: TextStyle(color: Color(0xFF9FB0C1), fontSize: 11),
          ),
        ],
      ),
    );
  }
}

class _OverviewMetric extends StatelessWidget {
  const _OverviewMetric({
    required this.label,
    required this.amount,
    required this.color,
  });
  final String label;
  final int amount;
  final Color color;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(
        padding: const EdgeInsets.only(top: 5),
        child: Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
      ),
      const SizedBox(width: 8),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(color: Color(0xFFC4D0DD), fontSize: 11),
            ),
            const SizedBox(height: 2),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                formatPaise(amount),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
      ),
    ],
  );
}

class _FundRingPainter extends CustomPainter {
  const _FundRingPainter({
    required this.balanceShare,
    required this.walletShare,
    required this.chargeShare,
  });
  final double balanceShare;
  final double walletShare;
  final double chargeShare;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromLTWH(8, 8, size.width - 16, size.height - 16);
    const start = -math.pi / 2;
    final track = Paint()
      ..color = const Color(0xFF334155)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 15;
    canvas.drawArc(rect, 0, 2 * math.pi, false, track);
    var angle = start;
    for (final segment in [
      (balanceShare, _AnalyticsOverviewCard.emerald),
      (walletShare, _AnalyticsOverviewCard.violet),
      (chargeShare, _AnalyticsOverviewCard.orange),
    ]) {
      if (segment.$1 <= 0) continue;
      final sweep = 2 * math.pi * segment.$1;
      canvas.drawArc(
        rect,
        angle,
        sweep,
        false,
        Paint()
          ..color = segment.$2
          ..style = PaintingStyle.stroke
          ..strokeWidth = 15,
      );
      angle += sweep;
    }
  }

  @override
  bool shouldRepaint(covariant _FundRingPainter oldDelegate) =>
      oldDelegate.balanceShare != balanceShare ||
      oldDelegate.walletShare != walletShare ||
      oldDelegate.chargeShare != chargeShare;
}
