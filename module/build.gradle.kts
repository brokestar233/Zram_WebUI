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

val compilerMappings_cpp = mapOf(
    "arm64-v8a" to "aarch64-linux-android21-clang++",
    "armeabi-v7a" to "armv7a-linux-androideabi21-clang++",
    "x86" to "i686-linux-android21-clang++",
    "x86_64" to "x86_64-linux-android21-clang++"
)

val compilerMappings_c = mapOf(
    "arm64-v8a" to "aarch64-linux-android21-clang",
    "armeabi-v7a" to "armv7a-linux-androideabi21-clang",
    "x86" to "i686-linux-android21-clang",
    "x86_64" to "x86_64-linux-android21-clang"
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
            val compiler = compilerMappings_cpp[abi]
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

fun compileF2fspin(variantName: String, buildDir: File) {
    if (ndkPath == null) {
        logger.warn("ANDROID_NDK_HOME not set, skipping native binary compilation")
        return
    }
    
    val prebuiltPath = getPrebuiltPath()
    val binDir = File(buildDir, "bin")
    binDir.mkdirs()

    // 确保这里的变量名与实际逻辑一致
    val f2fspinSource = File(projectDir, "c/f2fs_pin.c")
    if (f2fspinSource.exists()) {
        targetMappings.forEach { (abi, target) ->
            // 使用 C 编译器映射
            val compiler = compilerMappings_c[abi]
            val outputFile = File(binDir, "f2fs_pin-${moduleId}-${target}")
            
            val cmd = listOf(
                "$prebuiltPath/$compiler",
                "-O3", 
                "-flto", 
                "-std=c11", // C项目通常使用 c11 或 c99，而不是 c++20
                "-Wall", 
                "-Wextra", 
                // "-static-libstdc++", // 纯 C 项目通常不需要链接 C++ 标准库
                "-I", "${projectDir}/c",
                "-o", outputFile.absolutePath,
                f2fspinSource.absolutePath
            )
            
            logger.lifecycle("Compiling f2fs_pin for $abi ($target)...")
            val process = Runtime.getRuntime().exec(cmd.toTypedArray())
            process.waitFor()
            if (process.exitValue() != 0) {
                // 打印错误流以便调试
                val errorMsg = process.errorStream.bufferedReader().readText()
                logger.error("Error compiling f2fs_pin for $abi: $errorMsg")
            }
        }
    } else {
        logger.warn("Source file not found: ${f2fspinSource.absolutePath}")
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
        
        val compiler = compilerMappings_cpp[abi]
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

fun compileUtilLinux(variantName: String, buildDir: File) {
    // 1. 检查 NDK 路径
    if (ndkPath == null) {
        logger.warn("ANDROID_NDK_HOME not set, skipping util-linux compilation")
        return
    }
    val ndkDir = File(ndkPath)

    // 2. 检查源码路径
    val utilLinuxSrcDir = File(projectDir, "util-linux")
    if (!utilLinuxSrcDir.exists()) {
        logger.error("util-linux source directory not found at $utilLinuxSrcDir")
        return
    }
    
    // 检查是否需要先运行 ./autogen.sh (如果是从 git clone 下来的通常需要)
    if (!File(utilLinuxSrcDir, "configure").exists()) {
        logger.lifecycle("configure script not found, running autogen.sh...")
        runCommand(listOf("./autogen.sh"), utilLinuxSrcDir, emptyMap())
    }

    val binDir = File(buildDir, "bin")
    binDir.mkdirs()

    val targetTools = mapOf(
        "fallocate" to "fallocate",
        "losetup" to "losetup",
        "fstrim" to "fstrim"
    )

    // 3. 确定宿主机工具链路径 (HOST OS)
    val osName = System.getProperty("os.name").lowercase()
    val hostTag = when {
        osName.contains("win") -> "windows-x86_64"
        osName.contains("mac") -> "darwin-x86_64"
        else -> "linux-x86_64"
    }
    
    // NDK r19+ 使用 toolchains/llvm/prebuilt/
    val toolchainBin = File(ndkDir, "toolchains/llvm/prebuilt/$hostTag/bin")
    if (!toolchainBin.exists()) {
        logger.error("NDK toolchain bin not found at $toolchainBin. Ensure you are using NDK r19+.")
        return
    }

    // 4. 定义目标 API Level (建议设为 24 或 21，根据 minSdk 设置)
    val apiLevel = 29

    targetMappings.forEach { (abi, target) ->
        logger.lifecycle("Compiling util-linux tools for $abi (API $apiLevel)...")

        val buildDirAbi = File(utilLinuxSrcDir, "build_$abi")
        buildDirAbi.mkdirs()

        // 5. 配置编译器前缀和标志
        // 映射 Gradle ABI 到 NDK Clang 的命名规则
        val (clangPrefix, hostTriple) = when (abi) {
            "arm64-v8a" -> "aarch64-linux-android" to "aarch64-linux-android"
            "armeabi-v7a" -> "armv7a-linux-androideabi" to "arm-linux-androideabi" // host triple 不带 v7a
            "x86_64" -> "x86_64-linux-android" to "x86_64-linux-android"
            "x86" -> "i686-linux-android" to "i686-linux-android"
            else -> throw IllegalArgumentException("Unsupported ABI: $abi")
        }

        // 关键：NDK 中 CC 的完整路径
        // 注意：armv7a 的编译器名是 armv7a-linux-androideabi$API-clang，但 binutils (ar/ranlib) 是 arm-linux-androideabi-ar
        val ccPath = File(toolchainBin, "$clangPrefix$apiLevel-clang").absolutePath
        val arPath = File(toolchainBin, "llvm-ar").absolutePath
        val ranlibPath = File(toolchainBin, "llvm-ranlib").absolutePath
        val stripPath = File(toolchainBin, "llvm-strip").absolutePath

        // 6. 构建环境变量
        val env = mutableMapOf<String, String>()
        env["CC"] = ccPath
        env["AR"] = arPath
        env["RANLIB"] = ranlibPath
        env["PATH"] = "${toolchainBin.absolutePath}:${System.getenv("PATH")}"
        
        // 7. 配置 Configure 命令
        val configureCmd = mutableListOf(
            "../configure",
            "--host=$hostTriple",
            "--prefix=/",              // 这是一个技巧，方便后续 install 或者直接提取
            "--disable-all-programs",
            "--disable-shared",
            "--enable-static",
            "--enable-libsmartcols",   // 依赖项
            "--enable-fallocate",
            "--enable-libmount",
            "--enable-libblkid",
            "--enable-losetup",
            "--enable-fstrim",
            "--disable-nls",           // 禁用多语言支持，减小体积
            "--without-python",
            "--without-tinfo",
            "--without-ncurses",
            "--without-selinux",
            "--without-smack",
            "--without-systemd",
            "--without-udev",
            "ac_cv_func_setns=yes",
            "ac_cv_func_statx=no",
            "ac_cv_func_unshare=yes",
            "ac_cv_func_uselocale=no",
            "ac_cv_type_struct_statx=no",
        )

        if (abi == "armeabi-v7a" || abi == "x86") {
            logger.lifecycle("Disabling year2038 support for 32-bit ABI: $abi")
            configureCmd.add("--disable-year2038")
        }
        
        // 将 CFLAGS/LDFLAGS 作为参数传递给 configure，确保它们被正确识别
        // -static 对于生成可移植的 Android 二进制文件至关重要
        configureCmd.add("CFLAGS=-O3 -fPIE -static")
        configureCmd.add("LDFLAGS=-static -s") // -s 自动 strip

        // 执行 Configure
        runCommand(configureCmd, buildDirAbi, env)

        // 8. 执行 Make
        // 只需要编译目标工具
        val makeCmd = listOf(
            "make", 
            "-j${Runtime.getRuntime().availableProcessors()}", 
            "fallocate", "losetup", "fstrim"
        )
        runCommand(makeCmd, buildDirAbi, env)

        // 9. 提取产物
        targetTools.forEach { (toolName, relativePath) ->
            // 注意：某些工具可能在 .libs 隐藏目录下（libtool 的行为），或者在根目录下
            // 通常静态编译后直接在 buildDirAbi 下或者是 子目录 下
            // util-linux 结构通常是 buildDirAbi/fallocate (如果是直接生成) 或者 buildDirAbi/sys-utils/fallocate
            // 这里我们做一个简单的查找策略
            
            var builtBinary = File(buildDirAbi, relativePath)
            
            // 如果不在根目录，尝试在 standard locations 查找 (util-linux 源码结构)
            if (!builtBinary.exists()) {
                val subDir = when(toolName) {
                    "fallocate", "fstrim", "losetup" -> "sys-utils"
                    else -> ""
                }
                builtBinary = File(buildDirAbi, "$subDir/$toolName")
            }

            // 再次检查 .libs (libtool 生成的 wrapper 对应的真实二进制通常在这里，但如果是 -static 则不一定)
            if (!builtBinary.exists()) {
                 logger.error("Could not locate built binary for $toolName in $buildDirAbi")
            } else {
                val outputFile = File(binDir, "$toolName-${moduleId}-${target}")
                builtBinary.copyTo(outputFile, overwrite = true)
                logger.lifecycle("Copied $outputFile")
                
                // 可选：再次 strip 确保体积最小
                runCommand(listOf(stripPath, "--strip-all", outputFile.absolutePath), binDir, env)
            }
        }

        // 清理 (可选)
        // buildDirAbi.deleteRecursively()
    }
}

// 辅助函数：支持传递环境变量
fun runCommand(cmd: List<String>, workingDir: File, env: Map<String, String>) {
    logger.info("Executing: ${cmd.joinToString(" ")} in $workingDir")
    val pb = ProcessBuilder(cmd)
        .directory(workingDir)
        .redirectErrorStream(true)
    
    // 合并环境变量
    pb.environment().putAll(env)
    
    val process = pb.start()
    
    // 读取输出流防止缓冲区阻塞
    process.inputStream.bufferedReader().use { reader ->
        reader.forEachLine { line ->
            // 可以根据需要调整日志级别，防止 spam
             println("[util-linux] $line") 
        }
    }

    val exitCode = process.waitFor()
    if (exitCode != 0) {
        throw RuntimeException("Command failed with exit code $exitCode: ${cmd.joinToString(" ")}")
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
            compileF2fspin(variantName, layout.buildDirectory.get().asFile)
            compileUtilLinux(variantName, layout.buildDirectory.get().asFile)
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
                    set.add(Pair(File(moduleOutputDir, "sepolicy.rule"), null))
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