import 'package:flutter/material.dart';

/// Design tokens and colors matching the modern UI reference designs.
abstract final class AppColors {
  static const primary = Color(0xFF007A55); // Rich Railway Emerald
  static const primaryLight = Color(0xFFECFDF5);
  static const primaryDark = Color(0xFF00583D);

  static const secondary = Color(0xFF5B4DFF); // Modern Royal Indigo accent
  static const secondaryLight = Color(0xFFEEF0FF);

  static const surface = Colors.white;
  static const background = Color(0xFFF8FAFC); // Clean Slate-50 background

  static const textMain = Color(0xFF0F172A); // Slate-900
  static const textMuted = Color(0xFF64748B); // Slate-500
  static const textSubtle = Color(0xFF94A3B8); // Slate-400

  static const border = Color(0xFFE2E8F0); // Slate-200 border
  static const borderLight = Color(0xFFF1F5F9); // Slate-100 border

  static const success = Color(0xFF10B981);
  static const successLight = Color(0xFFD1FAE5);

  static const warning = Color(0xFFF59E0B);
  static const warningLight = Color(0xFFFEF3C7);

  static const error = Color(0xFFEF4444);
  static const errorLight = Color(0xFFFEE2E2);
}

/// Senior-level container for grouping form fields with icon, title, and clean card styling.
class AppSectionCard extends StatelessWidget {
  const AppSectionCard({
    super.key,
    required this.title,
    this.subtitle,
    this.icon,
    this.action,
    required this.children,
    this.padding = const EdgeInsets.all(18),
  });

  final String title;
  final String? subtitle;
  final IconData? icon;
  final Widget? action;
  final List<Widget> children;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Container(
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
      padding: padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppColors.primaryLight,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(icon, size: 20, color: AppColors.primary),
                ),
                const SizedBox(width: 12),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textMain,
                        letterSpacing: -0.2,
                      ),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitle!,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              ?action,
            ],
          ),
          const SizedBox(height: 16),
          ...children,
        ],
      ),
    );
  }
}

/// Senior-level text input with rounded border, overall padding, prefix icon, and no underline.
class AppTextField extends StatelessWidget {
  const AppTextField({
    super.key,
    this.label,
    this.hint,
    this.controller,
    this.initialValue,
    this.icon,
    this.suffix,
    this.keyboardType,
    this.maxLength,
    this.maxLines = 1,
    this.obscureText = false,
    this.enabled = true,
    this.readOnly = false,
    this.onChanged,
    this.onSubmitted,
    this.autofillHints,
    this.helperText,
  });

  final String? label;
  final String? hint;
  final TextEditingController? controller;
  final String? initialValue;
  final IconData? icon;
  final Widget? suffix;
  final TextInputType? keyboardType;
  final int? maxLength;
  final int maxLines;
  final bool obscureText;
  final bool enabled;
  final bool readOnly;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final Iterable<String>? autofillHints;
  final String? helperText;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null) ...[
          Text(
            label!,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.textMain,
            ),
          ),
          const SizedBox(height: 6),
        ],
        TextField(
          controller: controller,
          enabled: enabled,
          readOnly: readOnly,
          obscureText: obscureText,
          keyboardType: keyboardType,
          maxLines: maxLines,
          maxLength: maxLength,
          onChanged: onChanged,
          onSubmitted: onSubmitted,
          autofillHints: autofillHints,
          buildCounter: (
            context, {
            required currentLength,
            required isFocused,
            maxLength,
          }) => null, // Suppress standard ugly counter
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w500,
            color: AppColors.textMain,
          ),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: const TextStyle(
              color: AppColors.textSubtle,
              fontSize: 14,
              fontWeight: FontWeight.w400,
            ),
            filled: true,
            fillColor: enabled ? AppColors.surface : const Color(0xFFF1F5F9),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 14,
            ),
            prefixIcon: icon != null
                ? Padding(
                    padding: const EdgeInsets.only(left: 14, right: 10),
                    child: Icon(icon, size: 20, color: AppColors.textMuted),
                  )
                : null,
            prefixIconConstraints: const BoxConstraints(
              minWidth: 44,
              minHeight: 44,
            ),
            suffixIcon: suffix,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(16),
              borderSide: const BorderSide(color: AppColors.border, width: 1.2),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(16),
              borderSide: const BorderSide(color: AppColors.border, width: 1.2),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(16),
              borderSide: const BorderSide(color: AppColors.primary, width: 1.8),
            ),
            disabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(16),
              borderSide: const BorderSide(color: Color(0xFFE2E8F0), width: 1),
            ),
          ),
        ),
        if (helperText != null) ...[
          const SizedBox(height: 4),
          Text(
            helperText!,
            style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
          ),
        ],
      ],
    );
  }
}

/// Senior-level dropdown selector with matching rounded border, padding, and prefix icon.
class AppDropdownField<T> extends StatelessWidget {
  const AppDropdownField({
    super.key,
    this.label,
    this.hint,
    required this.value,
    required this.items,
    required this.onChanged,
    this.icon,
    this.helperText,
  });

  final String? label;
  final String? hint;
  final T? value;
  final List<DropdownMenuItem<T>> items;
  final ValueChanged<T?> onChanged;
  final IconData? icon;
  final String? helperText;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null) ...[
          Text(
            label!,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.textMain,
            ),
          ),
          const SizedBox(height: 6),
        ],
        DropdownButtonFormField<T>(
          initialValue: value,
          items: items,
          onChanged: onChanged,
          icon: const Icon(
            Icons.keyboard_arrow_down_rounded,
            color: AppColors.textMuted,
          ),
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w500,
            color: AppColors.textMain,
          ),
          dropdownColor: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: const TextStyle(
              color: AppColors.textSubtle,
              fontSize: 14,
            ),
            filled: true,
            fillColor: AppColors.surface,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 14,
            ),
            prefixIcon: icon != null
                ? Padding(
                    padding: const EdgeInsets.only(left: 14, right: 10),
                    child: Icon(icon, size: 20, color: AppColors.textMuted),
                  )
                : null,
            prefixIconConstraints: const BoxConstraints(
              minWidth: 44,
              minHeight: 44,
            ),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(16),
              borderSide: const BorderSide(color: AppColors.border, width: 1.2),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(16),
              borderSide: const BorderSide(color: AppColors.border, width: 1.2),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(16),
              borderSide: const BorderSide(color: AppColors.primary, width: 1.8),
            ),
          ),
        ),
        if (helperText != null) ...[
          const SizedBox(height: 4),
          Text(
            helperText!,
            style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
          ),
        ],
      ],
    );
  }
}

/// Senior-level date picker field formatted identically to input boxes.
class AppDatePickerField extends StatelessWidget {
  const AppDatePickerField({
    super.key,
    this.label,
    required this.selectedDate,
    required this.onTap,
    this.hint = 'Choose date',
    this.icon = Icons.calendar_month_rounded,
    this.helperText,
  });

  final String? label;
  final String? selectedDate;
  final VoidCallback onTap;
  final String hint;
  final IconData icon;
  final String? helperText;

  @override
  Widget build(BuildContext context) {
    final hasValue = selectedDate != null && selectedDate!.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null) ...[
          Text(
            label!,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.textMain,
            ),
          ),
          const SizedBox(height: 6),
        ],
        InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Container(
            height: 52,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border, width: 1.2),
            ),
            child: Row(
              children: [
                Icon(icon, size: 20, color: AppColors.textMuted),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    hasValue ? selectedDate! : hint,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: hasValue ? FontWeight.w500 : FontWeight.w400,
                      color: hasValue ? AppColors.textMain : AppColors.textSubtle,
                    ),
                  ),
                ),
                const Icon(
                  Icons.arrow_drop_down,
                  color: AppColors.textMuted,
                ),
              ],
            ),
          ),
        ),
        if (helperText != null) ...[
          const SizedBox(height: 4),
          Text(
            helperText!,
            style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
          ),
        ],
      ],
    );
  }
}

/// Summary card showing fund movements and balance due clearly.
class AppSummaryRowData {
  const AppSummaryRowData({
    required this.label,
    required this.value,
    this.isBold = false,
    this.color,
  });

  final String label;
  final String value;
  final bool isBold;
  final Color? color;
}

class AppSummaryCard extends StatelessWidget {
  const AppSummaryCard({
    super.key,
    required this.title,
    required this.rows,
    this.highlightLabel,
    this.highlightValue,
    this.highlightColor,
    this.subtitle,
  });

  final String title;
  final String? subtitle;
  final List<AppSummaryRowData> rows;
  final String? highlightLabel;
  final String? highlightValue;
  final Color? highlightColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.borderLight, width: 1.5),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A0F172A),
            blurRadius: 16,
            offset: Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textMain,
                    ),
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      subtitle!,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ],
                ],
              ),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppColors.primaryLight,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.receipt_long_rounded,
                  size: 20,
                  color: AppColors.primary,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ...rows.map(
            (r) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      r.label,
                      style: TextStyle(
                        fontSize: 14,
                        color: AppColors.textMuted,
                        fontWeight: r.isBold ? FontWeight.w600 : FontWeight.w400,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Flexible(
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerRight,
                      child: Text(
                        r.value,
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: r.isBold ? FontWeight.w700 : FontWeight.w600,
                          color: r.color ?? AppColors.textMain,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (highlightLabel != null && highlightValue != null) ...[
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Divider(color: AppColors.border, height: 1),
            ),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: (highlightColor ?? AppColors.primary).withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      highlightLabel!,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: highlightColor ?? AppColors.primary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Flexible(
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerRight,
                      child: Text(
                        highlightValue!,
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          color: highlightColor ?? AppColors.primary,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Large CTA button with bold label, rounded corners, and smooth shadow.
class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.label,
    this.icon,
    this.onPressed,
    this.busy = false,
    this.isDestructive = false,
    this.isSecondary = false,
  });

  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool busy;
  final bool isDestructive;
  final bool isSecondary;

  @override
  Widget build(BuildContext context) {
    Color bg = AppColors.primary;
    Color fg = Colors.white;

    if (isDestructive) {
      bg = AppColors.error;
      fg = Colors.white;
    } else if (isSecondary) {
      bg = AppColors.surface;
      fg = AppColors.textMain;
    }

    return SizedBox(
      height: 52,
      width: double.infinity,
      child: ElevatedButton(
        onPressed: busy ? null : onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: bg,
          foregroundColor: fg,
          elevation: isSecondary ? 0 : 2,
          shadowColor: bg.withValues(alpha: 0.3),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: isSecondary
                ? const BorderSide(color: AppColors.border, width: 1.2)
                : BorderSide.none,
          ),
          padding: const EdgeInsets.symmetric(horizontal: 20),
        ),
        child: busy
            ? const SizedBox(
                height: 22,
                width: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2.4,
                  valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                ),
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (icon != null) ...[
                    Icon(icon, size: 20, color: fg),
                    const SizedBox(width: 8),
                  ],
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: fg,
                      letterSpacing: 0.1,
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

/// Status badge pill with clean background and border.
class AppBadge extends StatelessWidget {
  const AppBadge({
    super.key,
    required this.label,
    this.color = AppColors.primary,
  });

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.25), width: 1),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }
}
