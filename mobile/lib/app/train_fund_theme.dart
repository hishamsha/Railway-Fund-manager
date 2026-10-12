import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

/// sRGB equivalents of the shared shadcn OKLCH tokens in web/app/globals.css.
abstract final class TrainFundTheme {
  static const lightColors = ShadColorScheme(
    background: Color(0xfff8fafc),
    foreground: Color(0xff0f172a),
    card: Color(0xffffffff),
    cardForeground: Color(0xff0f172a),
    popover: Color(0xffffffff),
    popoverForeground: Color(0xff0f172a),
    primary: Color(0xff007a55),
    primaryForeground: Color(0xffecfdf5),
    secondary: Color(0xfff1f5f9),
    secondaryForeground: Color(0xff0f172a),
    muted: Color(0xfff1f5f9),
    mutedForeground: Color(0xff64748b),
    accent: Color(0xffecfdf5),
    accentForeground: Color(0xff007a55),
    destructive: Color(0xffef4444),
    destructiveForeground: Color(0xffffffff),
    border: Color(0xffe2e8f0),
    input: Color(0xffe2e8f0),
    ring: Color(0xff007a55),
    selection: Color(0x33007a55),
  );

  static const darkColors = ShadColorScheme(
    background: Color(0xff0f172a),
    foreground: Color(0xfff8fafc),
    card: Color(0xff1e293b),
    cardForeground: Color(0xfff8fafc),
    popover: Color(0xff1e293b),
    popoverForeground: Color(0xfff8fafc),
    primary: Color(0xff10b981),
    primaryForeground: Color(0xff0f172a),
    secondary: Color(0xff334155),
    secondaryForeground: Color(0xfff8fafc),
    muted: Color(0xff334155),
    mutedForeground: Color(0xff94a3b8),
    accent: Color(0xff1e293b),
    accentForeground: Color(0xfff8fafc),
    destructive: Color(0xfff87171),
    destructiveForeground: Color(0xff0f172a),
    border: Color(0x26ffffff),
    input: Color(0x33ffffff),
    ring: Color(0xff10b981),
    selection: Color(0x4d10b981),
  );

  static final light = ShadThemeData(
    brightness: Brightness.light,
    colorScheme: lightColors,
    radius: const BorderRadius.all(Radius.circular(16)),
  );

  static final dark = ShadThemeData(
    brightness: Brightness.dark,
    colorScheme: darkColors,
    radius: const BorderRadius.all(Radius.circular(16)),
  );

  static ThemeData get materialLightTheme {
    const primary = Color(0xff007a55);
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      scaffoldBackgroundColor: const Color(0xfff8fafc),
      colorScheme: ColorScheme.fromSeed(
        seedColor: primary,
        primary: primary,
        surface: Colors.white,
      ),
      cardTheme: CardThemeData(
        color: Colors.white,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: const BorderSide(color: Color(0xfff1f5f9), width: 1.5),
        ),
        margin: EdgeInsets.zero,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Color(0xffe2e8f0), width: 1.2),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Color(0xffe2e8f0), width: 1.2),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: primary, width: 1.8),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Color(0xffef4444), width: 1.2),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Color(0xffef4444), width: 1.8),
        ),
        hintStyle: const TextStyle(color: Color(0xff94a3b8), fontSize: 14),
        labelStyle: const TextStyle(color: Color(0xff475569), fontSize: 14, fontWeight: FontWeight.w500),
        prefixIconColor: const Color(0xff64748b),
        suffixIconColor: const Color(0xff64748b),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          elevation: 0,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(48),
          side: const BorderSide(color: Color(0xffcbd5e1), width: 1.2),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.white,
        foregroundColor: Color(0xff0f172a),
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: Color(0xff0f172a),
          fontSize: 20,
          fontWeight: FontWeight.bold,
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        elevation: 8,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: Colors.white,
        elevation: 2,
        indicatorColor: const Color(0xffecfdf5),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const TextStyle(color: primary, fontSize: 12, fontWeight: FontWeight.w600);
          }
          return const TextStyle(color: Color(0xff64748b), fontSize: 12);
        }),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const IconThemeData(color: primary);
          }
          return const IconThemeData(color: Color(0xff64748b));
        }),
      ),
    );
  }
}
