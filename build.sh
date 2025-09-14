#!/bin/bash

# Global variable definitions
restart_ovo=0
IS_WINDOWS=0


# Get CPU core count
get_cpu_cores() {
    local cores=4
    if command -v nproc >/dev/null 2>&1; then
        cores=$(nproc 2>/dev/null || echo 4)
    elif [ -f /proc/cpuinfo ]; then
        cores=$(grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 4)
    fi
    echo "$cores"
}

declare -r PARALLEL_JOBS=$(get_cpu_cores)
ORIGINAL_DIR=$(pwd)
TEMP_BUILD_DIR=""
TEMP_NDK_DIR=""

# Logging functions
log_info() { echo "[INFO] $1"; }
log_error() { echo "[ERROR] $1" >&2; }
log_warn() { echo "[WARN] $1"; }

# Cleanup function
cleanup() {
    [ -n "$TEMP_BUILD_DIR" ] && rm -rf "$TEMP_BUILD_DIR"
    [ -n "$TEMP_NDK_DIR" ] && rm -rf "$TEMP_NDK_DIR"
}

# Error handling
handle_error() {
    log_error "$1"
    cleanup
    sleep 6
    exit 1
}



# Optimized archive extraction function
extract_archive() {
    local archive=$1
    local dest=$2

    if command -v 7z &>/dev/null; then
        7z x -y -o"$dest" "$archive" >/dev/null
    else
        unzip -q -o "$archive" -d "$dest"
    fi
}

# Modified path conversion function
convert_path() {
    if [ $IS_WINDOWS -eq 1 ]; then
        cygpath -w "$1"
    else
        echo "$1"
    fi
}

# Modified packaging function
package_module() {
    local version=$1
    local output_file="${action_name}_${version}.zip"

    # 清理上次生成的文件
    if [ -f "$output_file" ]; then
        rm "$output_file"
    fi

    # 添加创建META-INF目录的逻辑
    log_info "Creating META-INF directory structure..."
    mkdir -p META-INF/com/google/android

    # 创建updater-script文件
    echo '#MAGISK' >META-INF/com/google/android/updater-script
    log_info "Packaging module..."
    zip -r -9 "$output_file" . -x "*.git*" -x "build.sh" -x "requirements.txt" || handle_error "Failed to create zip file"

    cp "$output_file" "$ORIGINAL_DIR/" || handle_error "Failed to copy zip file"
}

# Compilation function
compile_binaries() {
    local prebuilt_path="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$([ $IS_WINDOWS -eq 1 ] && echo 'windows' || echo 'linux')-x86_64/bin"
    local targets=(aarch64 x86_64)
    local targets1=(arm64-v8a x86_64)
    local sources=(logmonitor)

    # 设置编译标志
    export CFLAGS="-O3 -flto"
    export CXXFLAGS="-O3 -flto -std=c++20"

    mkdir -p bin

    # 确保 NDK 工具有执行权限
    if [ $IS_WINDOWS -eq 0 ]; then
        chmod +x "$prebuilt_path"/*
    fi

    # 使用并行编译
    local pids=()
    for source in "${sources[@]}"; do
        for target in "${targets[@]}"; do
            (
                log_info "Compiling $source for $target..."
                local output="bin/${source}-${action_id}-${target}"
                local cpp_file="src/$source.cpp"

                # 修复 Linux 下的路径和权限问题
                if [ ! -f "$cpp_file" ]; then
                    log_error "Source file not found: $cpp_file"
                    exit 1
                fi

                "$prebuilt_path/${target}-linux-android21-clang++" \
                    $CXXFLAGS -Wall -Wextra -static-libstdc++ \
                    -I src -I src/ \
                    -o "$output" "$cpp_file" || exit 1

                "$prebuilt_path/llvm-strip" "$output" || log_warn "Failed to strip $output"
            ) &
            pids+=($!)

            # 控制并行数量
            if [ ${#pids[@]} -ge $PARALLEL_JOBS ]; then
                wait "${pids[0]}"
                pids=("${pids[@]:1}")
            fi
        done
    done

    # 等待所有编译完成
    wait || handle_error "Compilation failed"

    cd src/filewatcher

    for target in "${targets1[@]}"; do
        if [ "$target" == "arm64-v8a" ]; then
            local output="../../../bin/filewatcher-${action_id}-aarch64"
        else
            local output="../../../bin/filewatcher-${action_id}-${target}"
        fi
        mkdir build && cd build
        cmake .. \
            -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake \
            -DANDROID_ABI=${target} \
            -DANDROID_PLATFORM=android-21
        make -j$(nproc)
        cp src/filewatcher $output
        cd .. && rm -rf build
    done

    cd ../..
}

# Main function
main() {
    trap cleanup EXIT

    TEMP_BUILD_DIR=$(mktemp -d)
    cp -r . "$TEMP_BUILD_DIR" || handle_error "Failed to copy files"
    cd "$TEMP_BUILD_DIR" || handle_error "Failed to change directory"

    # 获取版本信息
    local version
    version=$(git describe --tags $(git rev-list --tags --max-count=1))
    if [[ "$version" != "v"* ]]; then
        log_info "Please input version:"
        read -r version
    fi
    . ./module_settings/config.sh
    log_info "Building module: ${action_name} settings from module_settings/config.sh"
    # 在 package_module 函数中，修改 module.prop 生成部分
    {
        echo "id=${action_id}"
        echo "name=${action_name}"
        echo "version=${version}"
        echo "versionCode=$(date +'%Y%m%d')"
        echo "author=${action_author}"
        echo "description=${action_description}"
        echo "updateJson=${updateJson}"
    } >module.prop

    sed -i "s/20240503/${CURRENT_TIME}/g" webroot/pages/status.js
    find webroot -name "status.js" -exec sed -i "s/Aurora-Nasa-1\/AMMF/${Github_update_repo}/g" {} \;
    find files -name "*.sh" -exec sed -i "s/AMMF/${action_id}/g" {} \;
    find webroot -name "*.js" -exec sed -i "s/AMMF/${action_id}/g" {} \;
    find src -name "*.cpp" -exec sed -i "s/AMMF2/${action_id}/g" {} \;
    sed -i "s/AMMF/${action_id}/g" webroot/index.html
    find webroot/translations -name "*.json" -exec sed -i "s/AMMF/${action_name}/g" {} \;
    # 在 main 函数中，替换标识符部分添加
    compile_binaries
    rm -rf src
    rm -rf docs
    rm build_for_GITHUBACTION.sh
    package_module "$version"
    log_info "Build completed successfully!"
    if [ "$restart_ovo" -eq 1 ]; then
        if [ $IS_WINDOWS -eq 1 ]; then
            log_info "Windows requires a full system restart to apply Android NDK environment variables"
        else
            log_info "Please restart your terminal to apply Android NDK environment variables"
        fi
    fi

}

main "$@"