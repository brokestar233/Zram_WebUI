import java.util.TreeSet
import java.nio.ByteOrder
import java.nio.ByteBuffer
import java.security.Signature
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.spec.EdECPrivateKeySpec
import java.security.spec.NamedParameterSpec
import org.apache.tools.ant.filters.FixCrLfFilter

plugins {
    base
}

val moduleId: String by rootProject.extra
val moduleName: String by rootProject.extra
val verName: String by rootProject.extra
val verType: String by rootProject.extra
val verCode: Int by rootProject.extra
val commitHash: String by rootProject.extra

val ndkPath: String? = System.getenv("ANDROID_NDK_HOME")
val targetMappings = mapOf(
    "arm64-v8a" to "aarch64",
    "armeabi-v7a" to "arm",
    "x86" to "x86",
    "x86_64" to "x86_64"
)

val compilerMappings = mapOf(
    "arm64-v8a" to "aarch64-linux-android21-clang++",
    "armeabi-v7a" to "armv7a-linux-androideabi21-clang++",
    "x86" to "i686-linux-android21-clang++",
    "x86_64" to "x86_64-linux-android21-clang++"
)

fun getPrebuiltPath(): String {
    val osName = if (System.getProperty("os.name").lowercase().contains("windows")) "windows" else "linux"
    return "$ndkPath/toolchains/llvm/prebuilt/${osName}-x86_64/bin"
}

fun compileLogmonitor(variantName: String, buildDir: File) {
    if (ndkPath == null) {
        logger.warn("ANDROID_NDK_HOME not set, skipping native binary compilation")
        return
    }
    
    val prebuiltPath = getPrebuiltPath()
    val binDir = File(buildDir, "bin")
    binDir.mkdirs()

    val logmonitorSource = File(projectDir, "cpp/logmonitor.cpp")
    if (logmonitorSource.exists()) {
        targetMappings.forEach { (abi, target) ->
            val compiler = compilerMappings[abi]
            val outputFile = File(binDir, "logmonitor-${moduleId}-${target}")
            val cmd = listOf(
                "$prebuiltPath/$compiler",
                "-O3", "-flto", "-std=c++20", "-Wall", "-Wextra", "-static-libstdc++",
                "-I", "${projectDir}/cpp",
                "-o", outputFile.absolutePath,
                logmonitorSource.absolutePath
            )
            
            logger.lifecycle("Compiling logmonitor for $abi ($target)...")
            val process = Runtime.getRuntime().exec(cmd.toTypedArray())
            process.waitFor()
            if (process.exitValue() != 0) {
                logger.lifecycle("Error compiling logmonitor for $abi")
            }
        }
    }
}

fun compileFilewatcher(variantName: String, buildDir: File) {
    if (ndkPath == null) {
        logger.warn("ANDROID_NDK_HOME not set, skipping native binary compilation")
        return
    }
    
    val filewatcherDir = File(projectDir, "cpp/filewatcher")
    if (!filewatcherDir.exists()) {
        logger.lifecycle("Filewatcher directory not found, skipping...")
        return
    }
    
    val binDir = File(buildDir, "bin")
    binDir.mkdirs()
    
    targetMappings.forEach { (abi, target) ->
        val buildDirAbi = File(filewatcherDir, "build_$abi")
        buildDirAbi.mkdirs()
        
        val compiler = compilerMappings[abi]
        val outputFile = File(binDir, "filewatcher-${moduleId}-${target}")
        
        logger.lifecycle("Compiling filewatcher for $abi ($target)...")

        val cmakeCmd = listOf(
            "cmake",
            "..",
            "-DCMAKE_TOOLCHAIN_FILE=${ndkPath}/build/cmake/android.toolchain.cmake",
            "-DANDROID_ABI=$abi",
            "-DANDROID_PLATFORM=android-21"
        )

        val cmakeProcess = Runtime.getRuntime().exec(cmakeCmd.toTypedArray(), null, buildDirAbi)
        cmakeProcess.waitFor()
        if (cmakeProcess.exitValue() != 0) {
            logger.lifecycle("Error running cmake for $abi")
        }

        val makeCmd = listOf("make", "-j${Runtime.getRuntime().availableProcessors()}")
        val makeProcess = Runtime.getRuntime().exec(makeCmd.toTypedArray(), null, buildDirAbi)
        makeProcess.waitFor()
        if (makeProcess.exitValue() != 0) {
            logger.lifecycle("Error running make for $abi")
        }
        
        val builtBinary = File(buildDirAbi, "src/filewatcher")
        if (builtBinary.exists()) {
            builtBinary.copyTo(outputFile, overwrite = true)
        }
        
        buildDirAbi.deleteRecursively()
    }
}

listOf("debug", "release").forEach { variantName ->
    val variantLowered = variantName.lowercase()
    val variantCapped = variantName.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }

    val moduleDir = layout.buildDirectory.dir("outputs/module/$variantLowered")
    val zipFileName = "$moduleName-$verName-$verCode-$commitHash-$variantName.zip".replace(' ', '-')

    val compileNativeTask = tasks.register("compileNative$variantCapped") {
        group = "module"
        doLast {
            compileLogmonitor(variantName, layout.buildDirectory.get().asFile)
            compileFilewatcher(variantName, layout.buildDirectory.get().asFile)
        }
    }

    val prepareModuleFilesTask = tasks.register<Sync>("prepareModuleFiles$variantCapped") {
        group = "module"
        dependsOn(
        //    ":dex:assemble$variantCapped",
        //    ":zygisk:assemble$variantCapped",
            compileNativeTask
        )
        into(moduleDir)
        from("$projectDir/src") {
            include(
                "module.prop"
            )
            expand(
                "moduleId" to "$moduleId",
                "moduleName" to "$moduleName",
                "versionName" to "$verName-$verType ($verCode-$commitHash-$variantLowered)",
                "versionCode" to "$verCode"
            )
        }
        from("$projectDir/src") {
            include("customize.sh")
        }
        from("$projectDir/src") {
            exclude(
                "module.prop",
                "customize.sh"
            )
        }
        from(layout.buildDirectory.dir("bin")) {
            into("bin")
        }
        //from(project(":dex").layout.buildDirectory.file("intermediates/dex/$variantLowered/mergeDexRelease")) {
        //    include(
        //        "classes.dex"
        //    )
        //    rename { "hmbird.dex" }
        //    into("files/data")
        //}
        //from(project(":dex").layout.buildDirectory.file("intermediates/stripped_native_libs/$variantLowered/strip${variantCapped}DebugSymbols/out/lib")) {
        //    into("dexkit")
        //}
        //from(project(":zygisk").layout.buildDirectory.file("intermediates/stripped_native_libs/$variantLowered/strip${variantCapped}DebugSymbols/out/lib")) {
        //    into("lib")
        //}
        
        // Strip native binaries
        doLast {
            if (ndkPath != null) {
                val prebuiltPath = getPrebuiltPath()
                val binDir = File(moduleDir.get().asFile, "bin")
                if (binDir.exists()) {
                    binDir.listFiles()?.forEach { file ->
                        if (file.isFile) {
                            val stripCmd = listOf(
                                "$prebuiltPath/llvm-strip",
                                "--strip-all",
                                file.absolutePath
                            )
                            logger.lifecycle("Stripping ${file.name}...")
                            val process = Runtime.getRuntime().exec(stripCmd.toTypedArray())
                            process.waitFor()
                            if (process.exitValue() != 0) {
                                logger.lifecycle("Error stripping ${file.name}")
                            }
                        }
                    }
                }
            }
        }
    }

    val signModuleTask = tasks.register("signModule$variantCapped") {
        group = "module"
        dependsOn(prepareModuleFilesTask)
        
        val moduleOutputDir = moduleDir.get().asFile
        val privateKeyFile = File(project.projectDir, "private_key")
        val publicKeyFile = File(project.projectDir, "public_key")

        doLast {
            val currentDate = java.time.LocalDate.now().format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd"))
            val statusJsFile = File(moduleOutputDir, "webroot/pages/status.js")
            if (statusJsFile.exists()) {
                var content = statusJsFile.readText()
                content = content.replace("20240503", currentDate)
                statusJsFile.writeText(content)
            }
            
            fun sha256Files() {
                moduleOutputDir.walkTopDown().forEach { file ->
                    if (file.isDirectory) return@forEach
                    if (file.name.endsWith(".sha256")) return@forEach

                    val md = MessageDigest.getInstance("SHA-256")
                    file.forEachBlock(4096) { bytes, size ->
                        md.update(bytes, 0, size)
                    }

                    File(file.path + ".sha256").writeText(md.digest().joinToString("") { "%02x".format(it) })
                }
            }
            
            if (privateKeyFile.exists()) {
                val privateKey = privateKeyFile.readBytes()
                val publicKey = publicKeyFile.readBytes()
                val namedSpec = NamedParameterSpec("ed25519")
                val privKeySpec = EdECPrivateKeySpec(namedSpec, privateKey)
                val kf = KeyFactory.getInstance("ed25519")
                val privKey = kf.generatePrivate(privKeySpec);
                val sig = Signature.getInstance("ed25519")
                fun File.sha(realFile: File? = null) {
                    sig.update(this.name.toByteArray())
                    sig.update(0)
                    val real = realFile ?: this
                    
                    val buffer = ByteBuffer.allocate(8)
                        .order(ByteOrder.LITTLE_ENDIAN)
                        .putLong(real.length())
                        .array()
                    sig.update(buffer)
                    real.forEachBlock { bytes, size ->
                        sig.update(bytes, 0, size)
                    }
                }

                /* INFO:
                   Mazoku is the file that holds signed hash of all files of TS Enhancer Extreme module, to ensure the zip (runtime and non-runtime) files hasn't been tampered with.
                */
                fun mazokuSign() {
                    sig.initSign(privKey)

                    val filesToProcess = TreeSet<File> { f1, f2 ->
                        f1.path.replace("\\", "/")
                            .compareTo(f2.path.replace("\\", "/"))
                    }

                    moduleOutputDir.walkTopDown().forEach { file ->
                        if (!file.isFile) return@forEach

                        val fileName = file.name
                        if (fileName == "mazoku") return@forEach

                        filesToProcess.add(file)
                    }

                    filesToProcess.forEach { file -> file.sha(file) }

                    val mazokuSignatureFile = File(moduleOutputDir, "mazoku")
                    mazokuSignatureFile.writeBytes(sig.sign())
                    mazokuSignatureFile.appendBytes(publicKey)
                    val md = MessageDigest.getInstance("SHA-256")
                    mazokuSignatureFile.forEachBlock(4096) { bytes, size ->
                        md.update(bytes, 0, size)
                    }
                    File(moduleOutputDir, "mazoku.sha256").writeText(md.digest().joinToString("") { "%02x".format(it) })
                }

                fun machikadoSign(name: String = "machikado") {
                    val set = TreeSet<Pair<File, File?>> { o1, o2 ->
                        o1.first.path.replace("\\", "/")
                            .compareTo(o2.first.path.replace("\\", "/"))
                    }

                    set.add(Pair(File(moduleOutputDir, "files/languages.sh"), null))
                    set.add(Pair(File(moduleOutputDir, "customize.sh"), null))
                    set.add(Pair(File(moduleOutputDir, "service.sh"), null))
                    set.add(Pair(File(moduleOutputDir, "action.sh"), null))
                    set.add(Pair(File(moduleOutputDir, "LICENSE"), null))

                    File(moduleOutputDir, "webroot").walkTopDown().forEach { file ->
                        if (file.isFile) {
                            set.add(Pair(file, null))
                        }
                    }
                    File(moduleOutputDir, "files/scripts").walkTopDown().forEach { file ->
                        if (file.isFile) {
                            set.add(Pair(file, null))
                        }
                    }
                    //File(moduleOutputDir, "dexkit").walkTopDown().forEach { file ->
                    //    if (file.isFile) {
                    //        set.add(Pair(file, null))
                    //    }
                    //}
                    File(moduleOutputDir, "bin").walkTopDown().forEach { file ->
                        if (file.isFile) {
                            set.add(Pair(file, null))
                        }
                    }
                    //File(moduleOutputDir, "lib").walkTopDown().forEach { file ->
                    //    if (file.isFile) {
                    //        set.add(Pair(file, null))
                    //    }
                    //}


                    sig.initSign(privKey)
                    set.forEach { it.first.sha(it.second) }
                    val signFile = File(moduleOutputDir, name)
                    signFile.writeBytes(sig.sign())
                    signFile.appendBytes(publicKey)
                }

                /* INFO:
                   Machikado is the name of files that holds signed hash of all runtime files of TS Enhancer Extreme module, to ensure the runtime files hasn't been tampered with.
                */
                println("=== Guards the peace of Machikado ===")

                machikadoSign()

                sha256Files()

                mazokuSign()
            } else {
                println("no private_key found, this build will not be signed")

                File(moduleOutputDir, "machikado").createNewFile()

                sha256Files()

                File(moduleOutputDir, "mazoku").createNewFile()
            }
        }
    }

    tasks.register<Zip>("zip$variantCapped") {
        group = "module"
        dependsOn(signModuleTask)
        archiveFileName.set(zipFileName)
        destinationDirectory.set(layout.buildDirectory.file("outputs/$variantLowered").get().asFile)
        from(moduleDir)
    }
}