#!/system/bin/sh
# shellcheck disable=SC2034
# shellcheck disable=SC2154
# shellcheck disable=SC3043
# shellcheck disable=SC2155
# shellcheck disable=SC2046
# shellcheck disable=SC3045
# shellcheck disable=SC1017
# 初始化日志目录
SKIPUNZIP=1
DEBUG=false
[[ "$(getprop persist.sys.locale)" == *"zh"* || "$(getprop ro.product.locale)" == *"zh"* ]] && LOCALE="CN" || LOCALE="EN"
operate() {
  if [ "$LOCALE" = "$1" ]; then
    shift
    local operation="$1"
    shift
    if [ "$operation" = "echo" ]; then
      if [ "$1" = "-n" ]; then
        shift
        echo -n "$@"
      else
        echo "$@"
      fi
    elif [ "$operation" = "functions" ]; then
      eval "${1%=*}=\"${1#*=}\""
    elif [ "$operation" = "abort_verify" ]; then
      abort_verify "$@"
    fi
  fi
}
print_cn() { operate "CN" "echo" "$@"; }
print_en() { operate "EN" "echo" "$@"; }
abort_cn() { operate "CN" "abort_verify" "$@"; }
abort_en() { operate "EN" "abort_verify" "$@"; }
functions_cn() { operate "CN" "functions" "$@"; }
functions_en() { operate "EN" "functions" "$@"; }
conflictdes_all() { sed -i "s|^description=.*|description=$1|" "/data/adb/modules/$MODULE/module.prop"; }

unzip -o "$ZIPFILE" 'verify.sh' -d "$TMPDIR" >/dev/null
if [ ! -f "$TMPDIR/verify.sh" ]; then
  ui_print "***********************************************"
  print_cn "! 无法提取 verify.sh!"
  print_cn "! 这个ZIP文件已损坏,请重新下载"
  print_en "! Unable to extract verify.sh!"
  print_en "! This zip may be corrupted, please try downloading again"
  abort "***********************************************"
fi
source "$TMPDIR/verify.sh"
extract "$ZIPFILE" 'verify.sh' "$TMPDIR_FOR_VERIFY"
extract "$ZIPFILE" 'customize.sh' "$TMPDIR_FOR_VERIFY"

print_cn "- 提取模块文件"
print_en "- Extracting module files"
set -x
FILES="
bin/*
files/*
webroot/*
module_settings/*
module.prop
service.sh
action.sh
LICENSE
machikado
mazoku
"
for FILE in $FILES; do
  extract "$ZIPFILE" "$FILE" "$MODPATH"
done
set +x


LOG_DIR="$MODPATH/logs"
BIN_DIR="$MODPATH/bin"
mkdir -p "$LOG_DIR"
case "$ARCH" in
arm64)
    rm -f "$MODPATH/bin/logmonitor-${MODID}-x86_64" 2>/dev/null
    rm -f "$MODPATH/bin/logmonitor-${MODID}-arm" 2>/dev/null
    rm -f "$MODPATH/bin/logmonitor-${MODID}-x86" 2>/dev/null
    mv "$MODPATH/bin/logmonitor-${MODID}-aarch64" "$MODPATH/bin/logmonitor-${MODID}"
    ;;
x64)
    rm -f "$MODPATH/bin/logmonitor-${MODID}-aarch64" 2>/dev/null
    rm -f "$MODPATH/bin/logmonitor-${MODID}-arm" 2>/dev/null
    rm -f "$MODPATH/bin/logmonitor-${MODID}-x86" 2>/dev/null
    mv "$MODPATH/bin/logmonitor-${MODID}-x86_64" "$MODPATH/bin/logmonitor-${MODID}"
    ;;
arm)
    rm -f "$MODPATH/bin/logmonitor-${MODID}-aarch64" 2>/dev/null
    rm -f "$MODPATH/bin/logmonitor-${MODID}-x86_64" 2>/dev/null
    rm -f "$MODPATH/bin/logmonitor-${MODID}-x86" 2>/dev/null
    mv "$MODPATH/bin/logmonitor-${MODID}-arm" "$MODPATH/bin/logmonitor-${MODID}"
    ;;
x86)
    rm -f "$MODPATH/bin/logmonitor-${MODID}-aarch64" 2>/dev/null
    rm -f "$MODPATH/bin/logmonitor-${MODID}-x86_64" 2>/dev/null
    rm -f "$MODPATH/bin/logmonitor-${MODID}-arm" 2>/dev/null
    mv "$MODPATH/bin/logmonitor-${MODID}-x86" "$MODPATH/bin/logmonitor-${MODID}"
    ;;
*)
    abort "Unknown architecture: $ARCH"
    ;;
esac

HAS32BIT=false && ([ $(getprop ro.product.cpu.abilist32) ] || [ $(getprop ro.system.product.cpu.abilist32) ]) && HAS32BIT=true

main() {

    if [ ! -f "$MODPATH/files/scripts/default_scripts/main.sh" ]; then
        abort "Notfound File!!!($MODPATH/files/scripts/default_scripts/main.sh)"
    else
        . "$MODPATH/files/scripts/default_scripts/main.sh"
    fi

    start_script
    set_log_file "install"
    version_check

'''
    # 创建zygisk目录
    mkdir -p "$MODPATH/zygisk"

    # 提取zygisk和dexkit库文件
    if [ "$ARCH" = "x86" ] || [ "$ARCH" = "x64" ]; then
        if [ "$HAS32BIT" = true ]; then
            Aurora_ui_print "- Extracting x86 libraries"
            extract "$ZIPFILE" "lib/x86/libzram.so" "$MODPATH/zygisk/" true
            mv "$MODPATH/zygisk/lib/x86/libzram.so" "$MODPATH/zygisk/x86.so"
            rm -rf "$MODPATH/zygisk/lib/x86"
            extract "$ZIPFILE" "dexkit/x86/libdexkit.so" "$MODPATH/files/data" true
        fi

        Aurora_ui_print "- Extracting x64 libraries"
        extract "$ZIPFILE" "lib/x86_64/libzram.so" "$MODPATH/zygisk" true
        mv "$MODPATH/zygisk/lib/x86_64/libzram.so" "$MODPATH/zygisk/x86_64.so"
        rm -rf "$MODPATH/zygisk/lib/x86_64"
        extract "$ZIPFILE" "dexkit/x86_64/libdexkit.so" "$MODPATH/files/data" true
    else
        if [ "$HAS32BIT" = true ]; then
            extract "$ZIPFILE" "lib/armeabi-v7a/libzram.so" "$MODPATH/zygisk" true
            mv "$MODPATH/zygisk/lib/armeabi-v7a/libzram.so" "$MODPATH/zygisk/armeabi-v7a.so"
            rm -rf "$MODPATH/zygisk/lib/armeabi-v7a"
            extract "$ZIPFILE" "dexkit/armeabi-v7a/libdexkit.so" "$MODPATH/files/data" true
        fi

        Aurora_ui_print "- Extracting arm64 libraries"
        extract "$ZIPFILE" "lib/arm64-v8a/libzram.so" "$MODPATH/zygisk" true
        mv "$MODPATH/zygisk/lib/arm64-v8a/libzram.so" "$MODPATH/zygisk/arm64-v8a.so"
        rm -rf "$MODPATH/zygisk/lib/arm64-v8a"
        rm -rf "$MODPATH/zygisk/lib"
        extract "$ZIPFILE" "dexkit/arm64-v8a/libdexkit.so" "$MODPATH/files/data" true
    fi
'''
    # 遍历bin目录中的所有文件
    for file in "$BIN_DIR"/*; do
        if [ -f "$file" ]; then # 检查是否为常规文件
            filename=$(basename "$file")
            
            # 添加调试日志
            log_info "处理文件: $filename"
            
            # 检查是否为arm64架构文件
            if [[ "$filename" == *"-aarch64" ]]; then
                # 这是arm64二进制文件
                if [ "$ARCH" = "arm64" ]; then
                    # 保留arm64二进制文件，重命名它
                    new_filename=${filename%-aarch64}
                    log_info "重命名 $filename 为 $new_filename"
                    mv "$file" "$BIN_DIR/$new_filename"
                else
                    # 如果当前架构不是arm64，则删除arm64二进制文件
                    log_info "删除 $filename (非 $ARCH 架构)"
                    rm -f "$file"
                fi
            # 检查是否为x86_64架构文件
            elif [[ "$filename" == *"-x86_64" ]]; then
                # 这是x86_64二进制文件
                if [ "$ARCH" = "x64" ]; then
                    # 保留x86_64二进制文件，重命名它
                    new_filename=${filename%-x86_64}
                    log_info "重命名 $filename 为 $new_filename"
                    mv "$file" "$BIN_DIR/$new_filename"
                else
                    # 如果当前架构不是x64，则删除x86_64二进制文件
                    log_info "删除 $filename (非 $ARCH 架构)"
                    rm -f "$file"
                fi
            # 检查是否为arm架构文件
            elif [[ "$filename" == *"-arm" ]]; then
                # 这是arm二进制文件
                if [ "$ARCH" = "arm" ]; then
                    # 保留arm二进制文件，重命名它
                    new_filename=${filename%-arm}
                    log_info "重命名 $filename 为 $new_filename"
                    mv "$file" "$BIN_DIR/$new_filename"
                else
                    # 如果当前架构不是arm，则删除arm二进制文件
                    log_info "删除 $filename (非 $ARCH 架构)"
                    rm -f "$file"
                fi
            # 检查是否为x86架构文件
            elif [[ "$filename" == *"-x86" ]]; then
                # 这是x86二进制文件
                if [ "$ARCH" = "x86" ]; then
                    # 保留x86二进制文件，重命名它
                    new_filename=${filename%-x86}
                    log_info "重命名 $filename 为 $new_filename"
                    mv "$file" "$BIN_DIR/$new_filename"
                else
                    # 如果当前架构不是x86，则删除x86二进制文件
                    log_info "删除 $filename (非 $ARCH 架构)"
                    rm -f "$file"
                fi
            else
                log_info "跳过 $filename (未找到架构后缀)"
            fi
        fi
    done
    if [ ! -f "$MODPATH/files/scripts/install_custom_script.sh" ]; then
        log_error "Notfound File!!!($MODPATH/files/scripts/install_custom_script.sh)"
        abort "Notfound File!!!($MODPATH/files/scripts/install_custom_script.sh)"
    else
        log_info "Loading install_custom_script.sh"
        . "$MODPATH/files/scripts/install_custom_script.sh"
    fi
    chmod -R 755 "$MODPATH/bin/"
}
#######################################################
version_check() {
    if [ -n "$KSU_VER_CODE" ] && [ "$KSU_VER_CODE" -lt "$ksu_min_version" ] || [ "$KSU_KERNEL_VER_CODE" -lt "$ksu_min_kernel_version" ]; then
        Aurora_abort "KernelSU: $ERROR_UNSUPPORTED_VERSION $KSU_VER_CODE ($ERROR_VERSION_NUMBER >= $ksu_min_version or kernelVersionCode >= $ksu_min_kernel_version)" 1
    elif [ -z "$APATCH" ] && [ -z "$KSU" ] && [ -n "$MAGISK_VER_CODE" ] && [ "$MAGISK_VER_CODE" -le "$magisk_min_version" ]; then
        Aurora_abort "Magisk: $ERROR_UNSUPPORTED_VERSION $MAGISK_VER_CODE ($ERROR_VERSION_NUMBER > $magisk_min_version)" 1
    elif [ -n "$APATCH_VER_CODE" ] && [ "$APATCH_VER_CODE" -lt "$apatch_min_version" ]; then
        Aurora_abort "APatch: $ERROR_UNSUPPORTED_VERSION $APATCH_VER_CODE ($ERROR_VERSION_NUMBER >= $apatch_min_version)" 1
    elif [ "$API" -lt "$ANDROID_API" ]; then
        Aurora_abort "Android API: $ERROR_UNSUPPORTED_VERSION $API ($ERROR_VERSION_NUMBER >= $ANDROID_API)" 2
    fi
}
# 保留replace_module_id函数以防某些文件未在构建时替换
replace_module_id() {
    if [ -f "$1" ] && [ -n "$MODID" ]; then
        Aurora_ui_print "Setting $2 ..."
        sed -i "s/AMMF/$MODID/g" "$1"
    fi
}
###############
##########################################################
if [ -n "$MODID" ]; then
    main
fi
Aurora_ui_print "$END"

stop_logger
