import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/money.dart';
import '../../core/ui/app_ui.dart';

class Wallet {
  Wallet.fromJson(Map<String, dynamic> json)
      : id = json['id'] as String,
        name = json['name'] as String,
        openingPaise = json['opening_balance_paise'] as int,
        balancePaise = json['current_balance_paise'] as int,
        isActive = json['is_active'] as bool;
  final String id;
  final String name;
  final int openingPaise;
  final int balancePaise;
  final bool isActive;
}

class WalletsScreen extends ConsumerStatefulWidget {
  const WalletsScreen({super.key});
  @override
  ConsumerState<WalletsScreen> createState() => _WalletsScreenState();
}

class _WalletsScreenState extends ConsumerState<WalletsScreen> {
  final wallets = <Wallet>[];
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
    setState(() { wallets.clear(); cursor = null; });
    await loadMore();
  }

  Future<void> loadMore() async {
    if (loading) return;
    setState(() { loading = true; error = null; });
    try {
      final response = await ref.read(authControllerProvider).api.get<Map<String, dynamic>>(
        '/wallets', queryParameters: {'limit': 20, if (cursor != null) 'cursor': cursor},
      );
      if (!mounted) return;
      setState(() {
        wallets.addAll((response.data!['items'] as List)
          .map((item) => Wallet.fromJson(item as Map<String, dynamic>)));
        cursor = response.data!['next_cursor'] as String?;
      });
    } on DioException {
      if (mounted) setState(() => error = 'Could not load wallets.');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> create() async {
    final saved = await showDialog<bool>(context: context, builder: (_) => const CreateWalletDialog());
    if (saved == true) await refresh();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
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
                    'Wallets',
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textMain,
                      letterSpacing: -0.4,
                    ),
                  ),
                  SizedBox(height: 2),
                  Text(
                    'Booking portal balances and provider funds',
                    style: TextStyle(fontSize: 13, color: AppColors.textMuted),
                  ),
                ],
              ),
              InkWell(
                onTap: create,
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
                        'Add',
                        style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w700),
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
                    child: Text(error!, style: const TextStyle(color: AppColors.error, fontWeight: FontWeight.w600)),
                  ),
                  TextButton(onPressed: refresh, child: const Text('Retry')),
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],

          if (loading && wallets.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 40),
              child: Center(child: CircularProgressIndicator()),
            ),

          if (!loading && wallets.isEmpty && error == null)
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
                    child: const Icon(Icons.account_balance_wallet_rounded, color: AppColors.primary, size: 36),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'No Wallets Added',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: AppColors.textMain),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Set up your provider or portal wallets to debit booking costs.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13, color: AppColors.textMuted),
                  ),
                  const SizedBox(height: 18),
                  AppButton(label: 'Add Wallet', icon: Icons.add_rounded, onPressed: create),
                ],
              ),
            ),

          for (final wallet in wallets)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: InkWell(
                onTap: () async {
                  await context.push('/app/wallets/${wallet.id}');
                  if (mounted) await refresh();
                },
                borderRadius: BorderRadius.circular(20),
                child: Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(20),
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
                          color: AppColors.secondaryLight,
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: const Icon(
                          Icons.account_balance_wallet_rounded,
                          color: AppColors.secondary,
                          size: 24,
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              wallet.name,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textMain,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Available Balance',
                              style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                            ),
                          ],
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            formatPaise(wallet.balancePaise),
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w800,
                              color: AppColors.textMain,
                            ),
                          ),
                          const SizedBox(height: 4),
                          const Icon(Icons.arrow_forward_ios_rounded, size: 12, color: AppColors.textSubtle),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),

          if (cursor != null)
            Center(
              child: TextButton(
                onPressed: loading ? null : loadMore,
                child: Text(loading ? 'Loading…' : 'Load more wallets'),
              ),
            ),
        ],
      ),
    ),
  );
}

class CreateWalletDialog extends ConsumerStatefulWidget {
  const CreateWalletDialog({super.key});
  @override
  ConsumerState<CreateWalletDialog> createState() => _CreateWalletDialogState();
}

class _CreateWalletDialogState extends ConsumerState<CreateWalletDialog> {
  final name = TextEditingController();
  final opening = TextEditingController(text: '0');
  final key = newIdempotencyKey();
  bool busy = false;
  String? error;

  @override
  void dispose() {
    name.dispose();
    opening.dispose();
    super.dispose();
  }

  Future<void> save() async {
    final paise = parseRupeesToPaise(opening.text);
    if (name.text.trim().isEmpty || paise == null) {
      setState(() => error = 'Enter a name and a valid opening amount.');
      return;
    }
    setState(() { busy = true; error = null; });
    try {
      await ref.read(authControllerProvider).api.post('/wallets', data: {
        'name': name.text.trim(),
        'opening_balance_paise': paise,
      }, options: Options(headers: {'Idempotency-Key': key}));
      if (mounted) Navigator.of(context).pop(true);
    } on DioException {
      if (mounted) setState(() => error = 'Could not create wallet. Retry with the same request.');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Add Wallet', style: TextStyle(fontWeight: FontWeight.w700)),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppTextField(
            label: 'Wallet Name',
            hint: 'e.g. IRCTC Portal / Provider 1',
            controller: name,
            icon: Icons.account_balance_wallet_outlined,
            maxLength: 120,
          ),
          const SizedBox(height: 14),
          AppTextField(
            label: 'Opening Balance (₹)',
            hint: '0.00',
            controller: opening,
            icon: Icons.currency_rupee_rounded,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
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
        child: Text(busy ? 'Creating…' : 'Create Wallet'),
      ),
    ],
  );
}
