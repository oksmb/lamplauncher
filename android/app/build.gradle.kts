plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// GitHub Actions passes its run number (-PbuildNumber=N), so every released build
// has a higher version than the one before and installs over it as an update.
// Local builds are 3.0.0.
val buildNumber = (findProperty("buildNumber") as String?)?.toIntOrNull()

// The release signing key is private and kept out of the repository. GitHub Actions
// decodes it from the repository's secrets and passes it in (see the workflow).
// Without it (your own builds, pull requests) the APK is signed with Android's
// debug key instead: fine to try out, but it can't update a released LampLauncher.
val releaseKeystore = System.getenv("LAMPLAUNCHER_KEYSTORE")?.let { file(it) }?.takeIf { it.isFile }

android {
    namespace = "com.lamplauncher.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.lamplauncher.tv"
        minSdk = 26
        targetSdk = 34
        versionCode = buildNumber ?: 3
        versionName = if (buildNumber != null) "3.0.$buildNumber" else "3.0.0"
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = System.getenv("LAMPLAUNCHER_KEYSTORE_PASSWORD")?.trim()
                keyAlias = System.getenv("LAMPLAUNCHER_KEY_ALIAS") ?: "lamplauncher"
                keyPassword = System.getenv("LAMPLAUNCHER_KEYSTORE_PASSWORD")?.trim()
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName(if (releaseKeystore != null) "release" else "debug")
        }
    }

    sourceSets {
        // the web app (../web) is the APK's assets
        getByName("main").assets.srcDirs(rootProject.file("../web"))
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

base {
    archivesName.set("LampLauncher")
}
