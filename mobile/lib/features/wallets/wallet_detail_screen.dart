import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/money.dart';
import '../../core/ui/app_ui.dart';
import '../finance/finance_dialogs.dart';
import 'wallets_screen.dart';

class WalletDetailScreen extends ConsumerStatefulWidget {
  const WalletDetailScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<WalletDetailScreen> createState() => _WalletDetailScreenState();
}

class _WalletDetailScreenState extends ConsumerState<WalletDetailScreen> {
  Wallet? wallet;
  List<Map<String, dynamic>> entries = [];
  String? nextCursor;
  bool loadingMore = false;
  String? error;

  @override
  void initState() {
    super.initState();
    Future.microtask(load);
  }

  Future<void> load() async {
    try {
      final api = ref.read(authControllerProvider).api;
      final detail = await api.get<Map<String, dynamic>>('/wallets/${widget.id}');
      final history = await api.get<Map<String, dynamic>>('/wallets/${widget.id}/entries');
      if (mounted) {
        setState(() {
          wallet = Wallet.fromJson(detail.data!['wallet'] as Map<String, dynamic>);
          entries = (history.data!['items'] as List).cast<Map<String, dynamic>>();
          nextCursor = history.data!['next_cursor'] as String?;
          error = null;
        });
      }
    } on DioException {
      if (mounted) { setState(() => error = 'Could not load wallet details.'); }
    }
  }

  Future<void> loadMore() async {
    final cursor = nextCursor;
    if (cursor == null || loadingMore) return;
    setState(() => loadingMore = true);
    try {
      final response = await ref.read(authControllerProvider).api
        .get<Map<String, dynamic>>('/wallets/${widget.id}/entries',
          queryParameters: {'cursor': cursor});
      if (mounted) {
        setState(() {
          entries.addAll((response.data!['items'] as List).cast<Map<String, dynamic>>());
          nextCursor = response.data!['next_cursor'] as String?;
          error = null;
        });
      }
    } on DioException {
      if (mounted) setState(() => error = 'Could not load more wallet entries.');
    } finally {
      if (mounted) setState(() => loadingMore = false);
    }
  }

  Future<void> topUp() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => TopUpDialog(walletId: widget.id),
    );
    if (saved == true) await load();
  }

  Future<void> financeAction(FinanceAction action, {String? originalId}) async {
    final endpoint = switch (action) {
      FinanceAction.walletRefund => '/wallets/${widget.id}/refunds',
      FinanceAction.adjustment => '/wallets/${widget.id}/adjustments',
      FinanceAction.reverse => '/finance/$originalId/reverse',
      FinanceAction.customerRefund => throw ArgumentError('Use booking detail for customer refunds'),
    };
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => FinanceDialog(action: action, endpoint: endpoint, originalId: originalId),
    );
    if (saved == true) await load();
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
                  'Wallet Details',
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
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],

            if (wallet == null && error == null)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 40),
                child: Center(child: CircularProgressIndicator()),
              ),

            if (wallet case final value?) ...[
              // Hero Balance Card (Reference 2 style!)
              Container(
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF5B4DFF), Color(0xFF3F37C9)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(24),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF5B4DFF).withValues(alpha: 0.28),
                      blurRadius: 18,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                padding: const EdgeInsets.all(22),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          value.name,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: const Text(
                            'Active',
                            style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                    const Text(
                      'Available Balance',
                      style: TextStyle(color: Colors.white70, fontSize: 13),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      formatPaise(value.balancePaise),
                      style: const TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                        letterSpacing: -0.6,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      'Opening: ${formatPaise(value.openingPaise)}',
                      style: TextStyle(
                        fontSize: 13,
                        color: Colors.white.withValues(alpha: 0.8),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),

              // Action Buttons
              Row(
                children: [
                  Expanded(
                    child: AppButton(
                      label: 'Top Up',
                      icon: Icons.add_circle_outline_rounded,
                      onPressed: topUp,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: AppButton(
                      label: 'Adjust Balance',
                      icon: Icons.tune_rounded,
                      isSecondary: true,
                      onPressed: () => financeAction(FinanceAction.adjustment),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),

              // Movements History
              const Text(
                'Recent Movements',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textMain,
                ),
              ),
              const SizedBox(height: 12),

              if (entries.isEmpty)
                Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: const Center(
                    child: Text(
                      'No movements in this wallet yet.',
                      style: TextStyle(color: AppColors.textMuted),
                    ),
                  ),
                )
              else
                ...entries.map(
                  (entry) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Container(
                      padding: const EdgeInsets.all(14),
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
                              color: entry['direction'] == 'debit' || entry['entry_type'] == 'booking_debit'
                                  ? AppColors.errorLight
                                  : AppColors.successLight,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Icon(
                              entry['direction'] == 'debit' || entry['entry_type'] == 'booking_debit'
                                  ? Icons.arrow_outward_rounded
                                  : Icons.arrow_downward_rounded,
                              color: entry['direction'] == 'debit' || entry['entry_type'] == 'booking_debit'
                                  ? AppColors.error
                                  : AppColors.success,
                              size: 20,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  (entry['entry_type'] as String).replaceAll('_', ' ').toUpperCase(),
                                  style: const TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.textMain,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  DateFormat('dd MMM yyyy, hh:mm a').format(
                                    DateTime.parse(entry['occurred_at'] as String).toLocal(),
                                  ),
                                  style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
                                ),
                              ],
                            ),
                          ),
                          if (entry['entry_type'] == 'booking_debit')
                            PopupMenuButton<String>(
                              tooltip: 'Debit actions',
                              onSelected: (actionVal) => financeAction(
                                actionVal == 'refund' ? FinanceAction.walletRefund : FinanceAction.reverse,
                                originalId: entry['id'] as String,
                              ),
                              itemBuilder: (_) => const [
                                PopupMenuItem(value: 'refund', child: Text('Provider refund')),
                                PopupMenuItem(value: 'reverse', child: Text('Reverse debit')),
                              ],
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                decoration: BoxDecoration(
                                  color: AppColors.errorLight,
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Row(
                                  children: [
                                    Text(
                                      formatPaise(entry['amount_paise'] as int),
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w700,
                                        color: AppColors.error,
                                        fontSize: 13,
                                      ),
                                    ),
                                    const Icon(Icons.more_vert, size: 16, color: AppColors.error),
                                  ],
                                ),
                              ),
                            )
                          else
                            Text(
                              formatPaise(entry['amount_paise'] as int),
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w800,
                                color: entry['direction'] == 'debit' || entry['entry_type'] == 'booking_debit'
                                    ? AppColors.error
                                    : AppColors.success,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),

              if (nextCursor != null)
                Center(
                  child: TextButton(
                    onPressed: loadingMore ? null : loadMore,
                    child: Text(loadingMore ? 'Loading…' : 'Load more movements'),
                  ),
                ),
            ],
          ],
        ),
      ),
    ),
  );
}

class TopUpDialog extends ConsumerStatefulWidget {
  const TopUpDialog({super.key, required this.walletId});
  final String walletId;
  @override
  ConsumerState<TopUpDialog> createState() => _TopUpDialogState();
}

class _TopUpDialogState extends ConsumerState<TopUpDialog> {
  final amount = TextEditingController();
  final note = TextEditingController();
  String? key;
  String? lastPayload;
  final occurredAt = DateTime.now().toUtc().toIso8601String();
  bool busy = false;
  String? error;

  @override
  void dispose() {
    amount.dispose();
    note.dispose();
    super.dispose();
  }

  Future<void> save() async {
    final paise = parseRupeesToPaise(amount.text);
    if (paise == null || paise <= 0) {
      setState(() => error = 'Enter a positive amount.');
      return;
    }
    final body = {
      'amount_paise': paise,
      'occurred_at': occurredAt,
      'note': note.text.trim().isEmpty ? null : note.text.trim(),
    };
    final fingerprint = jsonEncode(body);
    if (fingerprint != lastPayload) {
      key = newIdempotencyKey();
      lastPayload = fingerprint;
    }
    setState(() { busy = true; error = null; });
    try {
      await ref.read(authControllerProvider).api.post(
        '/wallets/${widget.walletId}/top-ups',
        data: body,
        options: Options(headers: {'Idempotency-Key': key}),
      );
      if (mounted) Navigator.of(context).pop(true);
    } on DioException {
      if (mounted) setState(() => error = 'Could not confirm top-up. Retry with the same request.');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Top Up Wallet', style: TextStyle(fontWeight: FontWeight.w700)),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppTextField(
            label: 'Amount (₹)',
            hint: '0.00',
            controller: amount,
            icon: Icons.currency_rupee_rounded,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
          ),
          const SizedBox(height: 14),
          AppTextField(
            label: 'Note (optional)',
            hint: 'e.g. Bank load reference number',
            controller: note,
            icon: Icons.notes_rounded,
            maxLength: 2000,
          ),
          if (error != null) ...[
            const SizedBox(height: 10),
            Text(error!, style: const TextStyle(color: AppColors.error, fontSize: 13, fontWeight: FontWeight.w600)),
          ],
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: busy ? null : () => Navigator.pop(context, false),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: busy ? null : save,
        child: Text(busy ? 'Adding…' : 'Add Funds'),
      ),
    ],
  );
}
