import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/ui/app_ui.dart';

class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key, this.initialEmail = ''});

  final String initialEmail;

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  late final TextEditingController email = TextEditingController(
    text: widget.initialEmail,
  );
  final code = TextEditingController();
  final newPassword = TextEditingController();
  final confirmPassword = TextEditingController();
  bool busy = false;
  bool done = false;
  String? error;

  @override
  void dispose() {
    email.dispose();
    code.dispose();
    newPassword.dispose();
    confirmPassword.dispose();
    super.dispose();
  }

  Future<void> reset() async {
    if (busy) return;
    final address = email.text.trim();
    if (address.isEmpty || !address.contains('@')) {
      setState(() => error = 'Enter your operator email address.');
      return;
    }
    if (code.text.trim().isEmpty) {
      setState(() => error = 'Enter the recovery code from the API computer.');
      return;
    }
    if (newPassword.text.length < 12) {
      setState(() => error = 'Use a new password with at least 12 characters.');
      return;
    }
    if (newPassword.text != confirmPassword.text) {
      setState(() => error = 'New passwords do not match.');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await ref
          .read(authControllerProvider)
          .resetPassword(address, code.text, newPassword.text);
      code.clear();
      newPassword.clear();
      confirmPassword.clear();
      if (mounted) setState(() => done = true);
    } on DioException catch (exception) {
      if (mounted) {
        setState(
          () => error = switch (exception.response?.statusCode) {
            401 =>
              'Invalid or expired recovery code. Generate a new code and try again.',
            429 => 'Too many attempts. Wait a minute and try again.',
            null =>
              'Cannot connect to the API. Check your connection and try again.',
            _ => 'Could not reset the password. Try again shortly.',
          },
        );
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => error = 'Could not reset the password. Try again shortly.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        foregroundColor: AppColors.textMain,
        title: const Text('Reset password'),
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AppSectionCard(
                title: done ? 'Password updated' : 'Forgot your password?',
                subtitle: done
                    ? 'Use your new password to sign in.'
                    : 'Get a one-time recovery code from your API administrator.',
                icon: Icons.lock_reset_rounded,
                children: done
                    ? [
                        AppButton(
                          label: 'Back to login',
                          icon: Icons.login_rounded,
                          onPressed: () => context.go('/login'),
                        ),
                      ]
                    : [
                        const Text(
                          'On the API computer, run: npm run owner:recovery-code\n'
                          'The code expires after 15 minutes and works once.',
                          style: TextStyle(
                            fontSize: 13,
                            color: AppColors.textMuted,
                          ),
                        ),
                        const SizedBox(height: 18),
                        AppTextField(
                          label: 'Operator Email',
                          hint: 'Email address',
                          controller: email,
                          keyboardType: TextInputType.emailAddress,
                          icon: Icons.mail_outline_rounded,
                        ),
                        const SizedBox(height: 14),
                        AppTextField(
                          label: 'Recovery Code',
                          hint: 'Enter one-time code',
                          controller: code,
                          icon: Icons.key_rounded,
                        ),
                        const SizedBox(height: 14),
                        AppTextField(
                          label: 'New Password',
                          hint: 'At least 12 characters',
                          controller: newPassword,
                          obscureText: true,
                          icon: Icons.lock_outline_rounded,
                        ),
                        const SizedBox(height: 14),
                        AppTextField(
                          label: 'Confirm New Password',
                          hint: 'Re-enter new password',
                          controller: confirmPassword,
                          obscureText: true,
                          icon: Icons.check_circle_outline_rounded,
                        ),
                        if (error != null) ...[
                          const SizedBox(height: 12),
                          Text(
                            error!,
                            style: const TextStyle(
                              color: AppColors.error,
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                        const SizedBox(height: 18),
                        AppButton(
                          label: 'Reset Password',
                          icon: Icons.lock_reset_rounded,
                          busy: busy,
                          onPressed: reset,
                        ),
                      ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
