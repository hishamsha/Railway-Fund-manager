import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/ui/app_ui.dart';

class BookingSummary {
  BookingSummary.fromJson(Map<String, dynamic> json)
      : id = json['id'] as String,
        boarding = json['boarding_station'] as String,
        destination = json['destination_station'] as String,
        journeyDate = json['journey_date'] as String,
        train = json['train_identifier'] as String;
  final String id;
  final String boarding;
  final String destination;
  final String journeyDate;
  final String train;
}

class BookingsScreen extends ConsumerStatefulWidget {
  const BookingsScreen({super.key});
  @override
  ConsumerState<BookingsScreen> createState() => _BookingsScreenState();
}

class _BookingsScreenState extends ConsumerState<BookingsScreen> {
  final bookings = <BookingSummary>[];
  String? cursor;
  bool loading = false;
  String? error;

  @override
  void initState() {
    super.initState();
    Future.microtask(refresh);
  }

  Future<void> refresh() async {
    if (!mounted) return;
    setState(() {
      bookings.clear();
      cursor = null;
    });
    await loadMore();
  }

  Future<void> loadMore() async {
    if (loading) return;
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final response = await ref.read(authControllerProvider).api.get<Map<String, dynamic>>(
        '/bookings',
        queryParameters: {'limit': 20, if (cursor != null) 'cursor': cursor},
      );
      if (!mounted) return;
      setState(() {
        bookings.addAll((response.data!['items'] as List).map(
          (item) => BookingSummary.fromJson(item as Map<String, dynamic>)));
        cursor = response.data!['next_cursor'] as String?;
      });
    } on DioException {
      if (mounted) setState(() => error = 'Could not load bookings.');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Bookings',
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textMain,
                        letterSpacing: -0.4,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'All recorded railway journey bookings',
                      style: TextStyle(fontSize: 13, color: AppColors.textMuted),
                    ),
                  ],
                ),
                InkWell(
                  onTap: () async {
                    await context.push('/app/bookings/new');
                    if (mounted) await refresh();
                  },
                  borderRadius: BorderRadius.circular(16),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    decoration: BoxDecoration(
                      color: AppColors.primary,
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: [
                        BoxShadow(
                          color: AppColors.primary.withValues(alpha: 0.3),
                          blurRadius: 10,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.add, color: Colors.white, size: 18),
                        SizedBox(width: 6),
                        Text(
                          'New',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
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
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.error.withValues(alpha: 0.3)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline_rounded, color: AppColors.error),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        error!,
                        style: const TextStyle(color: AppColors.error, fontWeight: FontWeight.w600),
                      ),
                    ),
                    TextButton(onPressed: refresh, child: const Text('Retry')),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],

            if (loading && bookings.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 40),
                child: Center(child: CircularProgressIndicator()),
              ),

            if (!loading && bookings.isEmpty && error == null)
              Container(
                padding: const EdgeInsets.all(32),
                margin: const EdgeInsets.only(top: 20),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: AppColors.borderLight),
                ),
                child: Column(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: AppColors.primaryLight,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.train_rounded, color: AppColors.primary, size: 36),
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'No Bookings Yet',
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: AppColors.textMain),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Create your first booking to start recording journey funds.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 13, color: AppColors.textMuted),
                    ),
                    const SizedBox(height: 18),
                    AppButton(
                      label: 'Create Booking',
                      icon: Icons.add_rounded,
                      onPressed: () => context.push('/app/bookings/new'),
                    ),
                  ],
                ),
              ),

            for (final booking in bookings)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: InkWell(
                  onTap: () => context.push('/app/bookings/${booking.id}'),
                  borderRadius: BorderRadius.circular(18),
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: AppColors.borderLight, width: 1.2),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x060F172A),
                          blurRadius: 10,
                          offset: Offset(0, 3),
                        ),
                      ],
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.primaryLight,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: const Icon(Icons.directions_train_rounded, color: AppColors.primary, size: 22),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${booking.boarding} → ${booking.destination}',
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.textMain,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Row(
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFF1F5F9),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: Text(
                                      booking.journeyDate,
                                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.textMuted),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      booking.train,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        const Icon(
                          Icons.arrow_forward_ios_rounded,
                          size: 14,
                          color: AppColors.textSubtle,
                        ),
                      ],
                    ),
                  ),
                ),
              ),

            if (cursor != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Center(
                  child: TextButton.icon(
                    onPressed: loading ? null : loadMore,
                    icon: const Icon(Icons.refresh_rounded, size: 16),
                    label: Text(loading ? 'Loading…' : 'Load more bookings'),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
