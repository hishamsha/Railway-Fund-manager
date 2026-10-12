import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:go_router/go_router.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/money.dart';
import '../../core/ui/app_ui.dart';
import '../finance/finance_dialogs.dart';

class BookingDetailScreen extends ConsumerStatefulWidget {
  const BookingDetailScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<BookingDetailScreen> createState() =>
      _BookingDetailScreenState();
}

class _BookingDetailScreenState extends ConsumerState<BookingDetailScreen> {
  Map<String, dynamic>? booking;
  Map<String, dynamic>? financials;
  List<Map<String, dynamic>> entries = [];
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
      final api = ref.read(authControllerProvider).api;
      final results = await Future.wait([
        api.get<Map<String, dynamic>>('/bookings/${widget.id}'),
        api.get<Map<String, dynamic>>('/bookings/${widget.id}/entries'),
      ]);
      if (mounted) {
        setState(() {
          booking = results[0].data!['booking'] as Map<String, dynamic>;
          financials = results[0].data!['financials'] as Map<String, dynamic>;
          entries = (results[1].data!['items'] as List)
              .cast<Map<String, dynamic>>();
          nextOffset = results[1].data!['next_offset'] as int?;
          error = null;
        });
      }
    } on DioException {
      if (mounted) setState(() => error = 'Could not load this booking.');
    }
  }

  Future<void> loadMore() async {
    final offset = nextOffset;
    if (offset == null || loadingMore) return;
    setState(() => loadingMore = true);
    try {
      final response = await ref
          .read(authControllerProvider)
          .api
          .get<Map<String, dynamic>>(
            '/bookings/${widget.id}/entries',
            queryParameters: {'offset': offset},
          );
      if (mounted) {
        setState(() {
          entries.addAll(
            (response.data!['items'] as List).cast<Map<String, dynamic>>(),
          );
          nextOffset = response.data!['next_offset'] as int?;
          error = null;
        });
      }
    } on DioException {
      if (mounted) setState(() => error = 'Could not load more transactions.');
    } finally {
      if (mounted) setState(() => loadingMore = false);
    }
  }

  Future<void> addCollection() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => CollectionDialog(bookingId: widget.id),
    );
    if (saved == true) await load();
  }

  Future<void> addDeduction() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => BookingDeductionDialog(bookingId: widget.id),
    );
    if (saved == true) await load();
  }

  Future<void> correctReceipt(
    Map<String, dynamic> entry,
    FinanceAction action,
  ) async {
    final id = entry['id'] as String;
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => FinanceDialog(
        action: action,
        originalId: id,
        endpoint: action == FinanceAction.customerRefund
            ? '/bookings/${widget.id}/customer-refunds'
            : '/finance/$id/reverse',
      ),
    );
    if (saved == true) await load();
  }

  @override
  Widget build(BuildContext context) {
    final item = booking;
    final money = financials;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: load,
          child: ListView(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
            children: [
              // Top Bar with back button
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
                  const Expanded(
                    child: Text(
                      'Booking Details',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textMain,
                        letterSpacing: -0.4,
                      ),
                    ),
                  ),
                  if (item != null)
                    TextButton.icon(
                      onPressed: () async {
                        final saved = await context.push<bool>(
                          '/app/bookings/${widget.id}/edit',
                        );
                        if (saved == true) await load();
                      },
                      icon: const Icon(Icons.edit_outlined, size: 18),
                      label: const Text('Edit'),
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
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],

              if (item == null && error == null)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 40),
                  child: Center(child: CircularProgressIndicator()),
                ),

              if (item != null && money != null) ...[
                // Journey Hero Card
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                      color: AppColors.borderLight,
                      width: 1.5,
                    ),
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
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: AppColors.primaryLight,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: const Icon(
                              Icons.train_rounded,
                              color: AppColors.primary,
                              size: 24,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${item['boarding_station']} → ${item['destination_station']}',
                                  style: const TextStyle(
                                    fontSize: 18,
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.textMain,
                                    letterSpacing: -0.2,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  '${item['journey_date']} · ${item['train_identifier']}',
                                  style: const TextStyle(
                                    fontSize: 13,
                                    color: AppColors.textMuted,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      if ((item['booking_person_mobile'] as String?)
                              ?.isNotEmpty ==
                          true) ...[
                        const SizedBox(height: 14),
                        const Divider(color: AppColors.border),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            const Icon(
                              Icons.phone_outlined,
                              size: 18,
                              color: AppColors.primary,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: SelectableText(
                                'Booking person mobile: ${item['booking_person_mobile']}',
                                style: const TextStyle(
                                  fontSize: 13,
                                  color: AppColors.textMain,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 18),

                // Financial Breakdown Card (Reference 2 style!)
                AppSummaryCard(
                  title: 'Financial Breakdown',
                  subtitle: 'Live balance and fund movements',
                  rows: [
                    AppSummaryRowData(
                      label: 'Ticket Price',
                      value: formatPaise(money['ticket_price_paise'] as int),
                    ),
                    AppSummaryRowData(
                      label: 'Service Charge',
                      value: formatPaise(money['service_charge_paise'] as int),
                    ),
                    AppSummaryRowData(
                      label: 'Total Payable',
                      value: formatPaise(money['total_payable_paise'] as int),
                      isBold: true,
                    ),
                    AppSummaryRowData(
                      label: 'Collected Ticket Amount',
                      value: formatPaise(money['collected_paise'] as int),
                    ),
                    AppSummaryRowData(
                      label: 'Wallet Deduction',
                      value: formatPaise(money['wallet_deducted_paise'] as int),
                    ),
                    AppSummaryRowData(
                      label: 'Customer Due',
                      value: formatPaise(money['balance_due_paise'] as int),
                    ),
                  ],
                  highlightLabel: 'Fund Balance (ticket − wallet)',
                  highlightValue: formatPaise(
                    money['fund_balance_paise'] as int,
                  ),
                  highlightColor: (money['fund_balance_paise'] as int) < 0
                      ? AppColors.error
                      : AppColors.success,
                ),
                const SizedBox(height: 18),

                // Action Buttons
                Column(
                  children: [
                    AppButton(
                      label: 'Record Collection',
                      icon: Icons.payments_rounded,
                      onPressed: addCollection,
                    ),
                    const SizedBox(height: 10),
                    AppButton(
                      label: 'Record Deduction',
                      icon: Icons.wallet_rounded,
                      isSecondary: true,
                      onPressed: addDeduction,
                    ),
                  ],
                ),
                const SizedBox(height: 24),

                // Transaction History Section
                const Text(
                  'Transaction History',
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
                        'No fund movements yet.',
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
                          border: Border.all(
                            color: AppColors.borderLight,
                            width: 1.2,
                          ),
                        ),
                        child: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: entry['source'] != 'customer'
                                    ? AppColors.secondaryLight
                                    : AppColors.primaryLight,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Icon(
                                entry['source'] != 'customer'
                                    ? Icons.account_balance_wallet_outlined
                                    : Icons.payments_outlined,
                                color: entry['source'] != 'customer'
                                    ? AppColors.secondary
                                    : AppColors.primary,
                                size: 20,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _entryTitle(entry),
                                    style: const TextStyle(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w700,
                                      color: AppColors.textMain,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    _entrySubtitle(entry),
                                    style: const TextStyle(
                                      fontSize: 12,
                                      color: AppColors.textMuted,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (entry['source'] == 'customer' &&
                                entry['entry_type'] == 'receipt')
                              PopupMenuButton<String>(
                                tooltip: 'Receipt actions',
                                onSelected: (value) => correctReceipt(
                                  entry,
                                  value == 'refund'
                                      ? FinanceAction.customerRefund
                                      : FinanceAction.reverse,
                                ),
                                itemBuilder: (_) => const [
                                  PopupMenuItem(
                                    value: 'refund',
                                    child: Text('Refund packager'),
                                  ),
                                  PopupMenuItem(
                                    value: 'reverse',
                                    child: Text('Reverse mistaken receipt'),
                                  ),
                                ],
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 10,
                                    vertical: 6,
                                  ),
                                  decoration: BoxDecoration(
                                    color: AppColors.successLight,
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: Row(
                                    children: [
                                      Text(
                                        formatPaise(
                                          entry['amount_paise'] as int,
                                        ),
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w700,
                                          color: AppColors.success,
                                          fontSize: 13,
                                        ),
                                      ),
                                      const Icon(
                                        Icons.more_vert,
                                        size: 16,
                                        color: AppColors.success,
                                      ),
                                    ],
                                  ),
                                ),
                              )
                            else
                              Text(
                                formatPaise(entry['amount_paise'] as int),
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w800,
                                  color: AppColors.textMain,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),

                if (nextOffset != null)
                  Center(
                    child: TextButton(
                      onPressed: loadingMore ? null : loadMore,
                      child: Text(
                        loadingMore ? 'Loading…' : 'Load more transactions',
                      ),
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _entryTitle(Map<String, dynamic> entry) {
    final type = entry['entry_type'] as String;
    return switch (type) {
      'receipt' => 'Collected from packager',
      'collection_adjustment_increase' => 'Collection correction added',
      'collection_adjustment_decrease' => 'Collection correction reduced',
      'deduction_adjustment_decrease' => 'Wallet deduction correction reduced',
      'booking_debit' =>
        entry['source'] == 'recorded_deduction'
            ? 'Recorded wallet deduction'
            : 'Wallet booking debit',
      _ => type.replaceAll('_', ' '),
    };
  }

  String _entrySubtitle(Map<String, dynamic> entry) {
    final when = DateFormat(
      'dd MMM yyyy, hh:mm a',
    ).format(DateTime.parse(entry['occurred_at'] as String).toLocal());
    final method = entry['method'] as String?;
    return method == null ? when : '$when · ${method.toUpperCase()}';
  }
}

class CollectionDialog extends ConsumerStatefulWidget {
  const CollectionDialog({super.key, required this.bookingId});
  final String bookingId;
  @override
  ConsumerState<CollectionDialog> createState() => _CollectionDialogState();
}

class _CollectionDialogState extends ConsumerState<CollectionDialog> {
  final amount = TextEditingController();
  final note = TextEditingController();
  String method = 'upi';
  final occurredAt = DateTime.now().toUtc().toIso8601String();
  String? idempotencyKey;
  String? lastPayload;
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
      setState(() => error = 'Enter a positive collection amount.');
      return;
    }
    final body = <String, dynamic>{
      'amount_paise': paise,
      'method': method,
      'occurred_at': occurredAt,
      'note': note.text.trim().isEmpty ? null : note.text.trim(),
    };
    final fingerprint = jsonEncode(body);
    if (lastPayload != fingerprint) {
      lastPayload = fingerprint;
      idempotencyKey = newIdempotencyKey();
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await ref
          .read(authControllerProvider)
          .api
          .post(
            '/bookings/${widget.bookingId}/collections',
            data: body,
            options: Options(headers: {'Idempotency-Key': idempotencyKey}),
          );
      if (mounted) Navigator.of(context).pop(true);
    } on DioException {
      if (mounted) {
        setState(
          () => error =
              'Could not confirm the collection. Retry with the same details.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text(
      'Record Collection',
      style: TextStyle(fontWeight: FontWeight.w700),
    ),
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
          AppDropdownField<String>(
            label: 'Payment Method',
            value: method,
            icon: Icons.payment_rounded,
            items: const [
              DropdownMenuItem(value: 'upi', child: Text('UPI')),
              DropdownMenuItem(value: 'cash', child: Text('Cash')),
              DropdownMenuItem(value: 'bank', child: Text('Bank Transfer')),
              DropdownMenuItem(value: 'other', child: Text('Other')),
            ],
            onChanged: (value) {
              if (value != null) setState(() => method = value);
            },
          ),
          const SizedBox(height: 14),
          AppTextField(
            label: 'Note (optional)',
            hint: 'Receipt remarks or reference number',
            controller: note,
            icon: Icons.notes_rounded,
            maxLength: 2000,
          ),
          if (error != null) ...[
            const SizedBox(height: 10),
            Text(
              error!,
              style: const TextStyle(
                color: AppColors.error,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
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
        child: Text(busy ? 'Saving…' : 'Save Collection'),
      ),
    ],
  );
}
