plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.familyexpense.tracker"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.familyexpense.tracker"
        minSdk = 26
        targetSdk = 35
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Android refuses to install an APK whose versionCode is not higher than
        // the installed one, so this MUST go up for every build you hand out.
        // Override per build with -PversionCode=N -PversionName=1.1 if you like.
        versionCode = (project.findProperty("versionCode") as? String)?.toInt() ?: 2
        versionName = (project.findProperty("versionName") as? String) ?: "1.1"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }

        // Defaults are the same values budget/config.js ships publicly. The
        // publishable key is designed to be public -- RLS is the real boundary --
        // so baking it in means a built APK works without extra setup. Override
        // in ~/.gradle/gradle.properties to point at a different project.
        val supabaseUrl = project.findProperty("SUPABASE_URL") as? String
            ?: "https://bprstbkdwojtznkzqjqe.supabase.co"
        val supabaseAnonKey = project.findProperty("SUPABASE_ANON_KEY") as? String
            ?: "sb_publishable_obIYnaOQK4J6Fe1HNQGdSA_lXTuhyFm"

        buildConfigField("String", "SUPABASE_URL", "\"$supabaseUrl\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"$supabaseAnonKey\"")
        buildConfigField("String", "AUTH_REDIRECT", "\"budgetpadmanabham://auth\"")
    }

    /**
     * One key, forever.
     *
     * Android only upgrades an app in place when the new APK carries the same
     * signature as the installed one. Same key => the install replaces the old
     * app and KEEPS its data, so the saved Supabase refresh token survives and
     * nobody signs in again. A different key => the installer refuses outright,
     * and the only way forward is uninstall-then-install, which wipes the token
     * and signs the whole family out.
     *
     * So the keystore is the thing to back up. Credentials live in
     * ~/.gradle/gradle.properties, never in this repo.
     */
    signingConfigs {
        val storePath = project.findProperty("BUDGET_RELEASE_STORE_FILE") as? String
        if (storePath != null && file(storePath).exists()) {
            create("release") {
                storeFile = file(storePath)
                storePassword = project.findProperty("BUDGET_RELEASE_STORE_PASSWORD") as String
                keyAlias = project.findProperty("BUDGET_RELEASE_KEY_ALIAS") as String
                keyPassword = project.findProperty("BUDGET_RELEASE_KEY_PASSWORD") as String
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Absent only on a machine without the keystore; the build then
            // produces an unsigned APK rather than silently using the debug key,
            // which would be the one signature that cannot be upgraded from.
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.activity:activity-compose:1.9.1")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.navigation:navigation-compose:2.7.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.4")

    // Chrome Custom Tabs: hosts the Supabase/Google sign-in page. A real browser
    // rather than a WebView, so the user can see the address bar and the session
    // is not trapped in an in-app view.
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    implementation("io.ktor:ktor-client-core:2.3.12")
    implementation("io.ktor:ktor-client-android:2.3.12")
    implementation("io.ktor:ktor-client-content-negotiation:2.3.12")
    implementation("io.ktor:ktor-serialization-kotlinx-json:2.3.12")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
