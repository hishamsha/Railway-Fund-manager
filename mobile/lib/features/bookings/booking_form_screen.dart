import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/money.dart';
import '../../core/ui/app_ui.dart';
import '../packagers/packagers_screen.dart';

class BookingFormScreen extends ConsumerStatefulWidget {
  const BookingFormScreen({super.key, this.bookingId});
  final String? bookingId;
  @override
  ConsumerState<BookingFormScreen> createState() => _BookingFormScreenState();
}

class _BookingFormScreenState extends ConsumerState<BookingFormScreen> {
  final boarding = TextEditingController();
  final destination = TextEditingController();
  final train = TextEditingController();
  final bookingPersonMobile = TextEditingController();
  final price = TextEditingController();
  final fee = TextEditingController();
  final collected = TextEditingController();
  final deducted = TextEditingController();
  final notes = TextEditingController();
  final correctionReason = TextEditingController();
  List<Packager> packagers = [];
  String? packagerId;
  DateTime? journeyDate;
  bool loading = true;
  bool saving = false;
  String? error;
  String? lastPayload;
  String? idempotencyKey;
  String? expectedUpdatedAt;
  int? expectedCollectedPaise;
  int? expectedDeductedPaise;
  bool get editing => widget.bookingId != null;

  @override
  void initState() {
    super.initState();
    for (final controller in [price, fee, collected, deducted]) {
      controller.addListener(_refreshPreview);
    }
    Future.microtask(loadOptions);
  }

  void _refreshPreview() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    for (final controller in [
      boarding,
      destination,
      train,
      bookingPersonMobile,
      price,
      fee,
      collected,
      deducted,
      notes,
      correctionReason,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> loadOptions({bool refreshBooking = true}) async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final api = ref.read(authControllerProvider).api;
      final response = await api.get<Map<String, dynamic>>(
        '/packagers',
        queryParameters: {'limit': 100},
      );
      final existing = editing && refreshBooking
          ? await api.get<Map<String, dynamic>>('/bookings/${widget.bookingId}')
          : null;
      if (!mounted) return;
      final availablePackagers = (response.data!['items'] as List)
          .map((item) => Packager.fromJson(item as Map<String, dynamic>))
          .toList();
      if (existing != null) {
        final currentId =
            (existing.data!['booking'] as Map<String, dynamic>)['packager_id']
                as String;
        if (!availablePackagers.any((packager) => packager.id == currentId)) {
          final current = await api.get<Map<String, dynamic>>(
            '/packagers/$currentId',
          );
          availablePackagers.insert(
            0,
            Packager.fromJson(
              current.data!['packager'] as Map<String, dynamic>,
            ),
          );
        }
      }
      if (editing &&
          existing == null &&
          packagerId != null &&
          !availablePackagers.any((packager) => packager.id == packagerId)) {
        final current = await api.get<Map<String, dynamic>>(
          '/packagers/$packagerId',
        );
        availablePackagers.insert(
          0,
          Packager.fromJson(current.data!['packager'] as Map<String, dynamic>),
        );
      }
      if (!mounted) return;
      setState(() {
        packagers = availablePackagers;
        if (existing != null) {
          final item = existing.data!['booking'] as Map<String, dynamic>;
          final money = existing.data!['financials'] as Map<String, dynamic>;
          packagerId = item['packager_id'] as String;
          boarding.text = item['boarding_station'] as String;
          destination.text = item['destination_station'] as String;
          train.text = item['train_identifier'] as String;
          bookingPersonMobile.text =
              (item['booking_person_mobile'] as String?) ?? '';
          journeyDate = DateTime.parse(item['journey_date'] as String);
          price.text = _editableMoney(money['ticket_price_paise'] as int);
          fee.text = _editableOptionalMoney(
            money['service_charge_paise'] as int,
          );
          collected.text = _editableOptionalMoney(
            money['collected_paise'] as int,
          );
          deducted.text = _editableOptionalMoney(
            money['wallet_deducted_paise'] as int,
          );
          notes.text = (item['notes'] as String?) ?? '';
          expectedUpdatedAt = item['updated_at'] as String;
          expectedCollectedPaise = money['collected_paise'] as int;
          expectedDeductedPaise = money['wallet_deducted_paise'] as int;
        }
      });
    } on DioException {
      if (mounted) {
        setState(
          () => error = editing
              ? 'Could not load this booking.'
              : 'Could not load packagers.',
        );
      }
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  String _editableMoney(int paise) => (paise / 100).toStringAsFixed(2);
  String _editableOptionalMoney(int paise) =>
      paise == 0 ? '' : _editableMoney(paise);

  Future<void> pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: journeyDate ?? DateTime.now(),
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null && mounted) setState(() => journeyDate = picked);
  }

  int? get pricePaise => parseRupeesToPaise(price.text);
  int? get feePaise =>
      fee.text.trim().isEmpty ? 0 : parseRupeesToPaise(fee.text);
  int? get collectedPaise =>
      collected.text.trim().isEmpty ? 0 : parseRupeesToPaise(collected.text);
  int? get deductedPaise =>
      deducted.text.trim().isEmpty ? 0 : parseRupeesToPaise(deducted.text);

  String _saveErrorMessage(DioException failure) {
    final responseBody = failure.response?.data;
    if (responseBody is Map && responseBody['error'] is Map) {
      final apiError = responseBody['error'] as Map;
      final fields = apiError['fields'];
      if (fields is Map) {
        if (fields.containsKey('wallet_id')) {
          return 'The API needs an update. Try again after it is redeployed.';
        }
        for (final messages in fields.values) {
          if (messages is List &&
              messages.isNotEmpty &&
              messages.first is String) {
            return messages.first as String;
          }
        }
      }
      final message = apiError['message'];
      if (message is String &&
          message.isNotEmpty &&
          failure.response!.statusCode != null &&
          failure.response!.statusCode! < 500) {
        return message;
      }
    }
    if (failure.response == null) {
      return 'Cannot connect to the API. Check your connection, then retry.';
    }
    return 'Could not confirm booking. Retry with the same details.';
  }

  Future<void> save() async {
    final mobile = bookingPersonMobile.text.trim();
    if (mobile.isNotEmpty &&
        !RegExp(r'^\+?[1-9][0-9]{9,14}$').hasMatch(mobile)) {
      setState(
        () => error =
            'Enter a mobile number with 10–15 digits, optionally starting with +.',
      );
      return;
    }
    final p = pricePaise;
    final f = feePaise;
    final c = collectedPaise;
    final d = deductedPaise;
    if (packagerId == null ||
        boarding.text.trim().isEmpty ||
        destination.text.trim().isEmpty ||
        boarding.text.trim().toLowerCase() ==
            destination.text.trim().toLowerCase() ||
        train.text.trim().isEmpty ||
        journeyDate == null ||
        p == null ||
        p <= 0 ||
        f == null ||
        c == null ||
        d == null) {
      setState(() => error = 'Complete all journey and money fields.');
      return;
    }
    final body = <String, dynamic>{
      'packager_id': packagerId,
      'boarding_station': boarding.text.trim(),
      'destination_station': destination.text.trim(),
      'journey_date': DateFormat('yyyy-MM-dd').format(journeyDate!),
      'train_identifier': train.text.trim(),
      'booking_person_mobile': mobile.isEmpty ? null : mobile,
      'ticket_price_paise': p,
      'service_charge_paise': f,
      'wallet_deducted_paise': d,
      'notes': notes.text.trim().isEmpty ? null : notes.text.trim(),
      if (editing) ...{
        'collected_paise': c,
        'expected_updated_at': expectedUpdatedAt,
        'expected_collected_paise': expectedCollectedPaise,
        'expected_wallet_deducted_paise': expectedDeductedPaise,
        'correction_reason': correctionReason.text.trim().isEmpty
            ? null
            : correctionReason.text.trim(),
      } else
        'initial_collected_paise': c,
    };
    if (editing &&
        (c != expectedCollectedPaise || d != expectedDeductedPaise) &&
        correctionReason.text.trim().isEmpty) {
      setState(() => error = 'Explain the collection or deduction correction.');
      return;
    }
    final fingerprint = jsonEncode(body);
    if (fingerprint != lastPayload) {
      lastPayload = fingerprint;
      idempotencyKey = newIdempotencyKey();
    }
    setState(() {
      saving = true;
      error = null;
    });
    try {
      final api = ref.read(authControllerProvider).api;
      final result = editing
          ? await api.patch<Map<String, dynamic>>(
              '/bookings/${widget.bookingId}',
              data: body,
              options: Options(headers: {'Idempotency-Key': idempotencyKey}),
            )
          : await api.post<Map<String, dynamic>>(
              '/bookings',
              data: body,
              options: Options(headers: {'Idempotency-Key': idempotencyKey}),
            );
      if (mounted) {
        if (editing) {
          context.pop(true);
        } else {
          context.go(
            '/app/bookings/${(result.data!['booking'] as Map<String, dynamic>)['id']}',
          );
        }
      }
    } on DioException catch (failure) {
      if (mounted) {
        setState(() => error = _saveErrorMessage(failure));
      }
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = pricePaise;
    final f = feePaise;
    final c = collectedPaise;
    final d = deductedPaise;
    final total = p != null && f != null ? p + f : null;
    final signed = total != null && c != null ? total - c : null;
    final fundBalance = p != null && d != null ? p - d : null;

    final summaryRows = <AppSummaryRowData>[
      AppSummaryRowData(
        label: 'Ticket Price',
        value: p != null ? formatPaise(p) : '—',
      ),
      AppSummaryRowData(
        label: 'Service Charge',
        value: f != null ? formatPaise(f) : '—',
      ),
      AppSummaryRowData(
        label: 'Total Payable',
        value: total != null ? formatPaise(total) : '—',
        isBold: true,
      ),
      AppSummaryRowData(
        label: 'Collected Ticket Amount',
        value: c != null ? formatPaise(c) : '—',
      ),
      AppSummaryRowData(
        label: 'Wallet Deduction',
        value: d != null ? formatPaise(d) : '—',
      ),
      AppSummaryRowData(
        label: 'Customer Due',
        value: signed != null ? formatPaise(signed > 0 ? signed : 0) : '—',
      ),
    ];

    String? highlightLabel;
    String? highlightValue;
    Color? highlightColor;

    if (fundBalance != null) {
      highlightLabel = 'Fund Balance (ticket − wallet)';
      highlightValue = formatPaise(fundBalance);
      highlightColor = fundBalance < 0 ? AppColors.error : AppColors.success;
    }

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
          children: [
            // Top Navigation & Header
            Row(
              children: [
                InkWell(
                  onTap: () => context.canPop()
                      ? context.pop()
                      : context.go('/app/bookings'),
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
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        editing ? 'Edit Booking' : 'New Booking',
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textMain,
                          letterSpacing: -0.4,
                        ),
                      ),
                      Text(
                        editing
                            ? 'Update booking and correct totals.'
                            : 'One train per booking. Customer dues separate.',
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),

            // Error Display Banner
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
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons.error_outline_rounded,
                      color: AppColors.error,
                      size: 20,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        error!,
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.error,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
            ],

            if (loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 40),
                child: Center(child: CircularProgressIndicator()),
              )
            else ...[
              // Section 1: Packager Details
              AppSectionCard(
                title: 'Client / Packager',
                subtitle: 'Select customer account for this booking',
                icon: Icons.person_outline_rounded,
                action: TextButton.icon(
                  onPressed: () async {
                    await context.push('/app/packagers');
                    if (mounted) await loadOptions(refreshBooking: false);
                  },
                  icon: const Icon(Icons.add_circle_outline_rounded, size: 16),
                  label: const Text(
                    'Manage',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.primary,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                  ),
                ),
                children: [
                  AppDropdownField<String>(
                    label: 'Packager Name',
                    hint: 'Select packager',
                    icon: Icons.person_rounded,
                    value: packagerId,
                    items: [
                      for (final packager in packagers)
                        DropdownMenuItem(
                          value: packager.id,
                          child: Text(packager.name),
                        ),
                    ],
                    onChanged: (value) => setState(() => packagerId = value),
                  ),
                ],
              ),
              const SizedBox(height: 18),

              // Section 2: Journey Information
              AppSectionCard(
                title: 'Journey Details',
                subtitle: 'Origin, destination, schedule and train',
                icon: Icons.train_outlined,
                children: [
                  AppTextField(
                    label: 'Boarding Station',
                    hint: 'e.g. New Delhi (NDLS)',
                    controller: boarding,
                    icon: Icons.my_location_rounded,
                    maxLength: 160,
                  ),
                  const SizedBox(height: 14),
                  AppTextField(
                    label: 'Destination Station',
                    hint: 'e.g. Howrah Junction (HWH)',
                    controller: destination,
                    icon: Icons.location_on_rounded,
                    maxLength: 160,
                  ),
                  const SizedBox(height: 14),
                  AppDatePickerField(
                    label: 'Journey Date',
                    hint: 'Choose journey date',
                    icon: Icons.calendar_today_rounded,
                    selectedDate: journeyDate == null
                        ? null
                        : DateFormat('dd MMM yyyy').format(journeyDate!),
                    onTap: pickDate,
                  ),
                  const SizedBox(height: 14),
                  AppTextField(
                    label: 'Train Number or Name',
                    hint: 'e.g. 12302 Howrah Rajdhani',
                    controller: train,
                    icon: Icons.directions_railway_filled_rounded,
                    maxLength: 160,
                  ),
                  const SizedBox(height: 14),
                  AppTextField(
                    label: 'Booking Person Mobile Number',
                    hint: 'e.g. +919876543210',
                    controller: bookingPersonMobile,
                    icon: Icons.phone_outlined,
                    keyboardType: TextInputType.phone,
                    maxLength: 16,
                    helperText:
                        'Optional. 10–15 digits, with an optional + country code.',
                  ),
                ],
              ),
              const SizedBox(height: 18),

              // Section 3: Fare & Payment
              AppSectionCard(
                title: 'Fare & Deductions',
                subtitle:
                    'Ticket cost, service charges and initial collections',
                icon: Icons.account_balance_wallet_outlined,
                children: [
                  AppTextField(
                    label: 'Ticket Booking Price (₹)',
                    hint: '0.00',
                    controller: price,
                    icon: Icons.currency_rupee_rounded,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                  ),
                  const SizedBox(height: 14),
                  AppTextField(
                    label: 'Service Charge (₹)',
                    hint: 'Optional',
                    controller: fee,
                    icon: Icons.receipt_outlined,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                  ),
                  const SizedBox(height: 14),
                  AppTextField(
                    label: editing
                        ? 'Total Collected Ticket Amount (₹)'
                        : 'Initially Collected Ticket Amount (₹)',
                    hint: 'Optional',
                    controller: collected,
                    icon: Icons.payments_rounded,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                  ),
                  const SizedBox(height: 14),
                  AppTextField(
                    label: 'Wallet Deduction (₹)',
                    hint: 'Optional',
                    controller: deducted,
                    icon: Icons.wallet_rounded,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    helperText:
                        'Amount spent from your own wallet for this booking.',
                  ),
                ],
              ),
              const SizedBox(height: 18),

              // Section 4: Notes
              AppSectionCard(
                title: 'Additional Notes',
                subtitle: 'Optional reference or remarks',
                icon: Icons.description_outlined,
                children: [
                  AppTextField(
                    hint: 'Write any specific booking instructions or notes...',
                    controller: notes,
                    icon: Icons.edit_note_rounded,
                    maxLines: 3,
                    maxLength: 2000,
                  ),
                ],
              ),
              const SizedBox(height: 18),

              if (editing) ...[
                AppSectionCard(
                  title: 'Correction Reason',
                  subtitle:
                      'Required when changing collection or deduction totals',
                  icon: Icons.history_rounded,
                  children: [
                    AppTextField(
                      hint: 'Explain the amount correction',
                      controller: correctionReason,
                      icon: Icons.edit_note_rounded,
                      maxLines: 2,
                      maxLength: 2000,
                    ),
                  ],
                ),
                const SizedBox(height: 18),
              ],

              // Section 5: Fund Summary Preview
              AppSummaryCard(
                title: 'Fund Preview',
                subtitle: 'Calculated instantly from input details',
                rows: summaryRows,
                highlightLabel: highlightLabel,
                highlightValue: highlightValue,
                highlightColor: highlightColor,
              ),
              const SizedBox(height: 24),

              // Action CTA Button
              AppButton(
                label: saving
                    ? 'Saving booking…'
                    : editing
                    ? 'Save changes'
                    : 'Save booking',
                icon: Icons.check_circle_rounded,
                busy: saving,
                onPressed: save,
              ),
              const SizedBox(height: 32),
            ],
          ],
        ),
      ),
    );
  }
}
