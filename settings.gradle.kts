pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        google()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        maven("https://jitpack.io") {
            content {
                includeGroup("com.github.livefront.sealed-enum")
                includeGroup("com.github.MatteoBattilana")
                // includeGroup("com.github.plattysoft")
            }
        }
        maven("https://api.xposed.info/") {
            content {
                includeGroup("de.robv.android.xposed")
            }
        }
        mavenCentral()
        maven("https://maven.tmpfs.dev/repository/maven-public/") {
            // I have no idea why sometimes jitpack.io is not working for
            // "com.github.plattysoft:Leonids:1746429"
            // So I added this repo as a backup.
            // I have encountered this wired issue twice in 2024.
            // The jitpack.io says "Not found" or "File not found. Build ok".
            content {
                includeGroup("com.github.plattysoft")
            }
        }
    }
}

rootProject.name = "Zram_WebUI"
include(
    ":module"
)
