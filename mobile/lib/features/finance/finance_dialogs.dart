import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/money.dart';
import '../../core/ui/app_ui.dart';

enum FinanceAction { customerRefund, walletRefund, reverse, adjustment }

class FinanceDialog extends ConsumerStatefulWidget {
  const FinanceDialog({
    super.key,
    required this.action,
    required this.endpoint,
    this.originalId,
  });
  final FinanceAction action;
  final String endpoint;
  final String? originalId;

  @override
  ConsumerState<FinanceDialog> createState() => _FinanceDialogState();
}

class BookingDeductionDialog extends ConsumerStatefulWidget {
  const BookingDeductionDialog({super.key, required this.bookingId});
  final String bookingId;

  @override
  ConsumerState<BookingDeductionDialog> createState() =>
      _BookingDeductionDialogState();
}

class _BookingDeductionDialogState
    extends ConsumerState<BookingDeductionDialog> {
  final amount = TextEditingController();
  final note = TextEditingController();
  final occurredAt = DateTime.now().toUtc().toIso8601String();
  String? lastPayload;
  String? key;
  String? error;
  bool busy = false;

  @override
  void dispose() {
    amount.dispose();
    note.dispose();
    super.dispose();
  }

  Future<void> save() async {
    final paise = parseRupeesToPaise(amount.text);
    if (paise == null || paise <= 0) {
      setState(() => error = 'Enter a positive deduction amount.');
      return;
    }
    final body = <String, dynamic>{
      'amount_paise': paise,
      'occurred_at': occurredAt,
      'note': note.text.trim().isEmpty ? null : note.text.trim(),
    };
    final fingerprint = jsonEncode(body);
    if (fingerprint != lastPayload) {
      key = newIdempotencyKey();
      lastPayload = fingerprint;
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
            '/bookings/${widget.bookingId}/deductions',
            data: body,
            options: Options(headers: {'Idempotency-Key': key}),
          );
      if (mounted) Navigator.of(context).pop(true);
    } on DioException {
      if (mounted) {
        setState(
          () => error =
              'Could not record the deduction. Retry with the same details.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Record Wallet Deduction'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Enter the amount spent in your external wallet. No source wallet is needed.',
          ),
          const SizedBox(height: 14),
          AppTextField(
            label: 'Deduction amount (₹)',
            hint: '0.00',
            controller: amount,
            icon: Icons.currency_rupee_rounded,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
          ),
          const SizedBox(height: 14),
          AppTextField(
            label: 'Note (optional)',
            hint: 'Reason or reference',
            controller: note,
            icon: Icons.notes_rounded,
            maxLength: 2000,
          ),
          if (error != null) ...[
            const SizedBox(height: 10),
            Text(
              error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
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
        child: Text(busy ? 'Saving…' : 'Record deduction'),
      ),
    ],
  );
}

class _FinanceDialogState extends ConsumerState<FinanceDialog> {
  final amount = TextEditingController();
  final reason = TextEditingController();
  final occurredAt = DateTime.now().toUtc().toIso8601String();
  String method = 'upi';
  String direction = 'credit';
  String? lastPayload;
  String? key;
  bool busy = false;
  String? error;

  String get title => switch (widget.action) {
    FinanceAction.customerRefund => 'Refund Packager',
    FinanceAction.walletRefund => 'Record Provider Refund',
    FinanceAction.reverse => 'Reverse Mistaken Entry',
    FinanceAction.adjustment => 'Adjust Wallet Balance',
  };

  @override
  void dispose() {
    amount.dispose();
    reason.dispose();
    super.dispose();
  }

  Future<void> save() async {
    final paise = parseRupeesToPaise(amount.text);
    if (widget.action != FinanceAction.reverse &&
        (paise == null || paise <= 0)) {
      setState(() => error = 'Enter a positive amount.');
      return;
    }
    if (reason.text.trim().length < 3) {
      setState(() => error = 'Enter a reason of at least 3 characters.');
      return;
    }
    final body = <String, dynamic>{
      'occurred_at': occurredAt,
      'reason': reason.text.trim(),
      if (widget.action != FinanceAction.reverse) 'amount_paise': paise,
      if (widget.action == FinanceAction.customerRefund) ...{
        'original_receipt_id': widget.originalId,
        'method': method,
      },
      if (widget.action == FinanceAction.walletRefund)
        'original_debit_id': widget.originalId,
      if (widget.action == FinanceAction.adjustment) 'direction': direction,
    };
    final fingerprint = jsonEncode(body);
    if (fingerprint != lastPayload) {
      key = newIdempotencyKey();
      lastPayload = fingerprint;
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
            widget.endpoint,
            data: body,
            options: Options(headers: {'Idempotency-Key': key}),
          );
      if (mounted) Navigator.of(context).pop(true);
    } on DioException catch (failure) {
      if (mounted) {
        final errorBody = failure.response?.data;
        final code = errorBody is Map && errorBody['error'] is Map
            ? (errorBody['error'] as Map)['code']
            : null;
        setState(
          () => error = code == 'AMOUNT_EXCEEDS_REMAINING'
              ? 'Amount exceeds what remains on the original entry.'
              : code == 'INSUFFICIENT_WALLET_BALANCE'
              ? 'Wallet balance is insufficient.'
              : 'Could not confirm the change. Retry with the same details.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (widget.action != FinanceAction.reverse) ...[
            AppTextField(
              label: 'Amount (â‚¹)',
              hint: '0.00',
              controller: amount,
              icon: Icons.currency_rupee_rounded,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
            ),
            const SizedBox(height: 14),
          ],
          if (widget.action == FinanceAction.customerRefund) ...[
            AppDropdownField<String>(
              label: 'Refund Method',
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
          ],
          if (widget.action == FinanceAction.adjustment) ...[
            AppDropdownField<String>(
              label: 'Direction',
              value: direction,
              icon: Icons.sync_alt_rounded,
              items: const [
                DropdownMenuItem(
                  value: 'credit',
                  child: Text('Add to wallet (Credit)'),
                ),
                DropdownMenuItem(
                  value: 'debit',
                  child: Text('Deduct from wallet (Debit)'),
                ),
              ],
              onChanged: (value) {
                if (value != null) setState(() => direction = value);
              },
            ),
            const SizedBox(height: 14),
          ],
          AppTextField(
            label: 'Reason',
            hint: 'Describe reason for change (min 3 chars)',
            controller: reason,
            icon: Icons.edit_note_rounded,
            maxLength: 2000,
            maxLines: 2,
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
        child: Text(busy ? 'Savingâ€¦' : 'Confirm'),
      ),
    ],
  );
}
