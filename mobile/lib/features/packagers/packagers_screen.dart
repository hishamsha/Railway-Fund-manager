import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/ui/app_ui.dart';

class Packager {
  Packager.fromJson(Map<String, dynamic> json)
      : id = json['id'] as String,
        name = json['name'] as String,
        phone = json['phone'] as String?,
        notes = json['notes'] as String?,
        isArchived = json['is_archived'] as bool;

  final String id;
  final String name;
  final String? phone;
  final String? notes;
  final bool isArchived;
}

class PackagersScreen extends ConsumerStatefulWidget {
  const PackagersScreen({super.key});

  @override
  ConsumerState<PackagersScreen> createState() => _PackagersScreenState();
}

class _PackagersScreenState extends ConsumerState<PackagersScreen> {
  final search = TextEditingController();
  final items = <Packager>[];
  String? cursor;
  bool loading = false;
  bool initialized = false;
  String? error;
  int generation = 0;

  @override
  void initState() {
    super.initState();
    Future.microtask(refresh);
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  Future<void> refresh() async {
    generation++;
    if (!mounted) return;
    setState(() { items.clear(); cursor = null; initialized = false; });
    await loadMore();
  }

  Future<void> loadMore() async {
    if (loading) return;
    final current = generation;
    setState(() { loading = true; error = null; });
    try {
      final response = await ref.read(authControllerProvider).api.get<Map<String, dynamic>>(
        '/packagers', queryParameters: {
          'limit': 20,
          if (cursor != null) 'cursor': cursor,
          if (search.text.trim().isNotEmpty) 'search': search.text.trim(),
        },
      );
      if (!mounted || current != generation) return;
      final data = response.data!;
      setState(() {
        items.addAll((data['items'] as List).map((item) => Packager.fromJson(item as Map<String, dynamic>)));
        cursor = data['next_cursor'] as String?;
        initialized = true;
      });
    } on DioException {
      if (mounted) setState(() { error = 'Could not load packagers. Check your connection.'; });
    } finally {
      if (mounted) {
        setState(() { loading = false; });
        if (current != generation && !initialized) Future.microtask(loadMore);
      }
    }
  }

  Future<void> add() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => const PackagerFormDialog(),
    );
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
                    'Packagers',
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textMain,
                      letterSpacing: -0.4,
                    ),
                  ),
                  SizedBox(height: 2),
                  Text(
                    'Client accounts and agent statements',
                    style: TextStyle(fontSize: 13, color: AppColors.textMuted),
                  ),
                ],
              ),
              InkWell(
                onTap: add,
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

          // Search Field
          AppTextField(
            hint: 'Search packager by name…',
            controller: search,
            icon: Icons.search_rounded,
            onSubmitted: (_) => refresh(),
            suffix: IconButton(
              icon: const Icon(Icons.arrow_forward_rounded, size: 18, color: AppColors.primary),
              onPressed: refresh,
            ),
          ),
          const SizedBox(height: 16),

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

          if (loading && !initialized)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 40),
              child: Center(child: CircularProgressIndicator()),
            ),

          if (initialized && items.isEmpty)
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
                      color: AppColors.secondaryLight,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.groups_rounded, color: AppColors.secondary, size: 36),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'No Packagers Found',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: AppColors.textMain),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Add a packager to start associating journey bookings.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13, color: AppColors.textMuted),
                  ),
                  const SizedBox(height: 18),
                  AppButton(label: 'Add Packager', icon: Icons.add_rounded, onPressed: add),
                ],
              ),
            ),

          for (final packager in items)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: InkWell(
                onTap: () async {
                  await context.push('/app/packagers/${packager.id}');
                  if (mounted) await refresh();
                },
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
                        height: 44,
                        width: 44,
                        decoration: BoxDecoration(
                          color: AppColors.primaryLight,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Center(
                          child: Text(
                            packager.name.isNotEmpty ? packager.name[0].toUpperCase() : 'P',
                            style: const TextStyle(
                              fontSize: 18,
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
                              packager.name,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textMain,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              packager.phone ?? 'No phone number',
                              style: const TextStyle(fontSize: 13, color: AppColors.textMuted),
                            ),
                          ],
                        ),
                      ),
                      const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: AppColors.textSubtle),
                    ],
                  ),
                ),
              ),
            ),

          if (cursor != null)
            Center(
              child: TextButton(
                onPressed: loading ? null : loadMore,
                child: Text(loading ? 'Loading…' : 'Load more packagers'),
              ),
            ),
        ],
      ),
    ),
  );
}

class PackagerFormDialog extends ConsumerStatefulWidget {
  const PackagerFormDialog({super.key, this.packager});
  final Packager? packager;

  @override
  ConsumerState<PackagerFormDialog> createState() => _PackagerFormDialogState();
}

class _PackagerFormDialogState extends ConsumerState<PackagerFormDialog> {
  late final name = TextEditingController(text: widget.packager?.name);
  late final phone = TextEditingController(text: widget.packager?.phone);
  late final notes = TextEditingController(text: widget.packager?.notes);
  bool busy = false;
  String? error;

  @override
  void dispose() {
    name.dispose();
    phone.dispose();
    notes.dispose();
    super.dispose();
  }

  Future<void> save() async {
    final trimmed = name.text.trim();
    if (trimmed.isEmpty) {
      setState(() => error = 'Name is required');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final data = {
        'name': trimmed,
        'phone': phone.text.trim().isEmpty ? null : phone.text.trim(),
        'notes': notes.text.trim().isEmpty ? null : notes.text.trim(),
      };
      final api = ref.read(authControllerProvider).api;
      if (widget.packager == null) {
        await api.post('/packagers', data: data);
      } else {
        await api.patch('/packagers/${widget.packager!.id}', data: data);
      }
      if (mounted) Navigator.of(context).pop(true);
    } on DioException {
      if (mounted) {
        setState(() => error = 'Could not save packager. Check fields and retry.');
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(
      widget.packager == null ? 'Add Packager' : 'Edit Packager',
      style: const TextStyle(fontWeight: FontWeight.w700),
    ),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppTextField(
            label: 'Name',
            hint: 'Enter packager or agency name',
            controller: name,
            icon: Icons.person_rounded,
            maxLength: 120,
          ),
          const SizedBox(height: 14),
          AppTextField(
            label: 'Phone (optional)',
            hint: 'e.g. +91 98765 43210',
            controller: phone,
            icon: Icons.phone_rounded,
            keyboardType: TextInputType.phone,
            maxLength: 30,
          ),
          const SizedBox(height: 14),
          AppTextField(
            label: 'Notes (optional)',
            hint: 'Client terms or station references',
            controller: notes,
            icon: Icons.notes_rounded,
            maxLines: 3,
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
        onPressed: busy ? null : () => Navigator.of(context).pop(false),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: busy ? null : save,
        child: Text(busy ? 'Saving…' : 'Save'),
      ),
    ],
  );
}
