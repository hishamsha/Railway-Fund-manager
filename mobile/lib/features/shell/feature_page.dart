import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

class FeaturePage extends StatelessWidget {
  const FeaturePage({super.key, required this.title, required this.description});

  final String title;
  final String description;

  @override
  Widget build(BuildContext context) => SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: ShadCard(
                title: Text(title),
                description: Text(description),
                child: const Padding(
                  padding: EdgeInsets.only(top: 24),
                  child: Text('No financial data is stored or displayed in this preview.'),
                ),
              ),
            ),
          ),
        ),
      );
}
