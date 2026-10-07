import 'dart:convert';
import 'dart:io';
import '../../app/lib/core/exercises/exercise_catalog_binding.dart';
import '../../app/lib/core/exercises/exercise_catalog_identity.dart';
import '../../app/lib/core/exercises/exercise_identity.dart';
import '../../app/lib/data/exercicios/exercicios.dart';

// Generated projection: editorial authority remains the existing Dart binder.
void main(List<String> args) {
  final identity = ExerciseCatalogIdentity(bancoExercicios);
  final binder = ExerciseCatalogBinder(bancoExercicios);
  final names = <String>{};
  for (final entry in identity.entries) {
    names.add(ExerciseIdentity.normalizeName(entry.canonicalName));
    names.addAll(entry.aliases);
  }
  final bindings = <String, String>{};
  final sorted = names.toList()..sort();
  for (final name in sorted) {
    final binding = binder.bindAi(
      templateItemId: 'export',
      remoteExerciseId: '',
      exerciseName: name,
    );
    if (binding.isResolved) bindings[name] = binding.canonicalExerciseId;
  }
  final payload = const JsonEncoder.withIndent('  ').convert({
    'contract': ExerciseCatalogBindingContract.identifier,
    'source': 'app/lib/data/exercicios + ExerciseCatalogBinder.bindAi',
    'sourceRevision': args.isEmpty ? 'UNRECORDED' : args.first,
    'canonicalIds': identity.entries.map((entry) => entry.canonicalId).toList()
      ..sort(),
    'nameBindings': bindings,
    'exerciseMetadata': {
      for (final entry in identity.entries)
        entry.canonicalId: {
          'category': entry.exercise.categoria,
          'primaryMuscles': entry.exercise.musculos,
          'movementPattern': entry.movementPattern.name,
        },
    },
  });
  final target = File.fromUri(
    Platform.script.resolve(
      '../src/modules/ai/gateway/catalog-projection.json',
    ),
  );
  if (args.contains('--check')) {
    if (!target.existsSync() || target.readAsStringSync() != '$payload\n') {
      stderr.writeln(
        'Catalog projection drift. Regenerate from the approved app revision.',
      );
      exitCode = 1;
    }
  } else {
    target.writeAsStringSync('$payload\n');
  }
  stdout.writeln(
    'Catalog projection: ${identity.entries.length} IDs, ${bindings.length} resolved names.',
  );
}
