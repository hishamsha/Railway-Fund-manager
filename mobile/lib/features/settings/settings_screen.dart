import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/ui/app_ui.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final currentPassword = TextEditingController();
  final newPassword = TextEditingController();
  final confirmPassword = TextEditingController();
  bool changing = false;
  String? passwordMessage;

  @override
  void dispose() {
    currentPassword.dispose();
    newPassword.dispose();
    confirmPassword.dispose();
    super.dispose();
  }

  Future<void> changePassword() async {
    if (changing) return;
    if (currentPassword.text.isEmpty) {
      setState(() => passwordMessage = 'Enter your current password.');
      return;
    }
    if (newPassword.text.length < 12) {
      setState(() => passwordMessage = 'Use at least 12 characters.');
      return;
    }
    if (newPassword.text != confirmPassword.text) {
      setState(() => passwordMessage = 'New passwords do not match.');
      return;
    }
    setState(() {
      changing = true;
      passwordMessage = null;
    });
    try {
      await ref
          .read(authControllerProvider)
          .changePassword(currentPassword.text, newPassword.text);
      currentPassword.clear();
      newPassword.clear();
      confirmPassword.clear();
      if (mounted) {
        setState(
          () => passwordMessage =
              'Password changed. Other sessions were signed out.',
        );
      }
    } on DioException catch (exception) {
      if (mounted) {
        setState(
          () => passwordMessage = exception.response?.statusCode == 401
              ? 'Current password is incorrect.'
              : 'Could not change the password. Check the connection and try again.',
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() => passwordMessage = 'Could not change the password.');
      }
    } finally {
      if (mounted) setState(() => changing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
          children: [
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Settings & Account',
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textMain,
                    letterSpacing: -0.4,
                  ),
                ),
                SizedBox(height: 2),
                Text(
                  'Operator profile, credentials and sessions',
                  style: TextStyle(fontSize: 13, color: AppColors.textMuted),
                ),
              ],
            ),
            const SizedBox(height: 20),

            // Profile Card
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
              child: Row(
                children: [
                  Container(
                    height: 52,
                    width: 52,
                    decoration: BoxDecoration(
                      color: AppColors.primaryLight,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: const Center(
                      child: Icon(
                        Icons.shield_outlined,
                        color: AppColors.primary,
                        size: 26,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Operator Account',
                          style: TextStyle(
                            fontSize: 13,
                            color: AppColors.textMuted,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          auth.email ?? 'Signed In',
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textMain,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const AppBadge(label: 'Verified', color: AppColors.success),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Change Password Section
            AppSectionCard(
              title: 'Change Password',
              subtitle: 'Ensure password contains at least 12 characters',
              icon: Icons.lock_outline_rounded,
              children: [
                AppTextField(
                  label: 'Current Password',
                  hint: 'Enter your existing password',
                  controller: currentPassword,
                  icon: Icons.key_rounded,
                  obscureText: true,
                  autofillHints: const [AutofillHints.password],
                ),
                const SizedBox(height: 14),
                AppTextField(
                  label: 'New Password',
                  hint: 'Enter new password (min 12 chars)',
                  controller: newPassword,
                  icon: Icons.lock_rounded,
                  obscureText: true,
                ),
                const SizedBox(height: 14),
                AppTextField(
                  label: 'Confirm New Password',
                  hint: 'Re-enter your new password',
                  controller: confirmPassword,
                  icon: Icons.check_circle_outline_rounded,
                  obscureText: true,
                ),
                if (passwordMessage != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: passwordMessage!.contains('changed')
                          ? AppColors.successLight
                          : AppColors.errorLight,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      passwordMessage!,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: passwordMessage!.contains('changed')
                            ? AppColors.success
                            : AppColors.error,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 18),
                AppButton(
                  label: changing ? 'Updating Password…' : 'Update Password',
                  icon: Icons.lock_reset_rounded,
                  busy: changing,
                  onPressed: changePassword,
                ),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () => context.push(
                      '/forgot-password',
                      extra: auth.email ?? '',
                    ),
                    child: const Text('Forgot current password?'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),

            // Sign Out Button
            AppButton(
              label: 'Sign Out',
              icon: Icons.logout_rounded,
              isDestructive: true,
              onPressed: () async {
                try {
                  await auth.logout();
                } catch (_) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text(
                          'Signed out locally. Server revocation could not be confirmed.',
                        ),
                      ),
                    );
                  }
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}
