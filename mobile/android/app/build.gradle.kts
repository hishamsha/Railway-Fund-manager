plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val releaseStore = System.getenv("TRAIN_FUND_KEYSTORE_PATH")
val releaseAlias = System.getenv("TRAIN_FUND_KEY_ALIAS")
val releaseStorePassword = System.getenv("TRAIN_FUND_STORE_PASSWORD")
val releaseKeyPassword = System.getenv("TRAIN_FUND_KEY_PASSWORD")
val releaseSigningReady = listOf(releaseStore, releaseAlias, releaseStorePassword,
    releaseKeyPassword).all { !it.isNullOrBlank() }
val releaseRequested = gradle.startParameter.taskNames.any {
    it.contains("Release", ignoreCase = true)
}

android {
    namespace = "com.example.train_fund_manager"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.example.train_fund_manager"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (releaseSigningReady) {
            create("release") {
                storeFile = file(releaseStore!!)
                storePassword = releaseStorePassword!!
                keyAlias = releaseAlias!!
                keyPassword = releaseKeyPassword!!
            }
        }
    }

    buildTypes {
        release {
            if (releaseSigningReady) {
                signingConfig = signingConfigs.getByName("release")
            } else if (releaseRequested) {
                throw GradleException("Release signing environment variables are required")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
