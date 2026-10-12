import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:dio/dio.dart';

const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3000/api/v1',
);

final authControllerProvider = Provider<AuthController>((ref) {
  final controller = AuthController();
  ref.onDispose(controller.dispose);
  return controller;
});

class AuthController extends ChangeNotifier {
  AuthController({Dio? dio, FlutterSecureStorage? storage})
    : _dio = dio ?? Dio(BaseOptions(
        baseUrl: apiBaseUrl,
        // Render's free instance can take about a minute to wake after idle.
        connectTimeout: const Duration(seconds: 90),
        receiveTimeout: const Duration(seconds: 90),
      )),
      _storage = storage ?? const FlutterSecureStorage() {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (_accessToken != null &&
              options.path != '/auth/login' &&
              options.path != '/auth/refresh') {
            options.headers['Authorization'] = 'Bearer $_accessToken';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          final request = error.requestOptions;
          if (error.response?.statusCode != 401 ||
              request.extra['retried'] == true ||
              (request.path.startsWith('/auth/') &&
                  request.path != '/auth/me')) {
            handler.next(error);
            return;
          }
          final refreshed = await _refreshOnce();
          if (!refreshed) {
            handler.next(error);
            return;
          }
          try {
            request.extra['retried'] = true;
            request.headers['Authorization'] = 'Bearer $_accessToken';
            handler.resolve(await _dio.fetch<dynamic>(request));
          } on DioException catch (retryError) {
            handler.next(retryError);
          }
        },
      ),
    );
  }

  final Dio _dio;
  final FlutterSecureStorage _storage;
  String? _accessToken;
  Future<bool>? _refreshInFlight;
  bool loading = true;
  bool authenticated = false;
  String? email;

  Future<void> restore() async {
    try {
      if (await _storage.read(key: 'refresh_token') != null) {
        await _refreshOnce();
      }
    } catch (_) {
      await _clearLocal();
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> login(String emailInput, String password) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/auth/login',
      data: {'email': emailInput.trim().toLowerCase(), 'password': password},
    );
    final data = response.data!;
    await _storage.write(
      key: 'refresh_token',
      value: data['refresh_token'] as String,
    );
    _accessToken = data['access_token'] as String;
    email = (data['user'] as Map<String, dynamic>)['email'] as String;
    authenticated = true;
    notifyListeners();
  }

  Future<bool> _refreshOnce() =>
      _refreshInFlight ??= _refresh().whenComplete(() {
        _refreshInFlight = null;
      });

  Future<bool> _refresh() async {
    try {
      final token = await _storage.read(key: 'refresh_token');
      if (token == null) return false;
      final response = await _dio.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refresh_token': token},
      );
      final data = response.data!;
      await _storage.write(
        key: 'refresh_token',
        value: data['refresh_token'] as String,
      );
      _accessToken = data['access_token'] as String;
      email = (data['user'] as Map<String, dynamic>?)?['email'] as String?;
      authenticated = true;
      notifyListeners();
      return true;
    } catch (_) {
      await _clearLocal();
      return false;
    }
  }

  Future<void> logout() async {
    try {
      await _dio.post<void>(
        '/auth/logout',
        options: Options(headers: {'Authorization': 'Bearer $_accessToken'}),
      );
    } finally {
      await _clearLocal();
    }
  }

  Future<void> changePassword(
    String currentPassword,
    String newPassword,
  ) async {
    await _dio.post<void>(
      '/auth/change-password',
      data: {'current_password': currentPassword, 'new_password': newPassword},
    );
  }

  Future<void> resetPassword(
    String emailInput,
    String recoveryCode,
    String newPassword,
  ) async {
    await _dio.post<void>(
      '/auth/reset-password',
      data: {
        'email': emailInput.trim().toLowerCase(),
        'recovery_code': recoveryCode.trim(),
        'new_password': newPassword,
      },
    );
    await _clearLocal();
  }

  Future<void> _clearLocal() async {
    _accessToken = null;
    email = null;
    authenticated = false;
    try {
      await _storage.delete(key: 'refresh_token');
    } catch (_) {
      /* OS store unavailable */
    }
    notifyListeners();
  }

  Dio get api => _dio;
}
