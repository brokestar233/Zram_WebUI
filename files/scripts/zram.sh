#!/system/bin/sh

# 回写文件
FILE="$MODPATH/files/data/writeback"

# 检查内核支持
support_auto_size=$(zcat /proc/config.gz 2>/dev/null | grep '^CONFIG_ZRAM_AUTO_SIZE=y' || echo "no")
support_multi_comp=$(zcat /proc/config.gz 2>/dev/null | grep '^CONFIG_ZRAM_MULTI_COMP=y' || echo "no")
support_zstd_level=0
if [ -f "/sys/module/zstd/parameters/compression_level" ]; then
  support_zstd_level=1
fi
if [ "$support_zstd_level" = 1 ]; then echo true; else echo false; fi > "$MODPATH/files/data/feature/support_zstd_level"

# 函数：发送通知（根据语言）
send_notification() {
    local title="$1"
    local message="$2"
    su -lp 1000 -c "cmd notification post -S bigtext -t 'ZRAM' 'Tag' '$message'"
    log_info "发送通知: $title - $message"
}

# 函数：检查文件大小并删除不匹配的文件
# 参数1: 文件路径
# 参数2: 预期大小（GB）
# 参数3: 允许误差（GB，默认0.01）
check_and_delete_file() {
    local file_path="$1"
    local expected_size_gb="$2"
    local tolerance_gb="${3:-0.01}"

    log_info "检查文件: $file_path, 预期大小: $expected_size_gb GB, 误差范围: $tolerance_gb GB"

    # 参数验证
    if [ -z "$file_path" ] || [ -z "$expected_size_gb" ]; then
        log_error "文件路径或预期大小参数缺失"
        return 1
    fi

    if ! echo "$expected_size_gb" | grep -qE '^[0-9]+(\.[0-9]+)?$'; then
        log_error "预期大小 '$expected_size_gb' 不是有效数字"
        return 1
    fi

    if ! echo "$tolerance_gb" | grep -qE '^[0-9]+(\.[0-9]+)?$'; then
        log_error "误差范围 '$tolerance_gb' 不是有效数字"
        return 1
    fi

    # 文件存在检查
    if [ ! -f "$file_path" ]; then
        log_warn "文件 '$file_path' 不存在，跳过删除"
        return 0  # 不存在时视为正常，不删除
    fi

     # 获取文件大小（字节）
    local file_size_bytes=$(stat -c%s "$file_path" 2>/dev/null)
    if [ $? -ne 0 ]; then
        log_error "无法获取文件 '$file_path' 的大小"
        return 1
    fi

    # 转换为GB（保留2位小数）
    local file_size_gb=$(echo "scale=2; ${file_size_bytes} / (1024*1024*1024)" | bc)
    if [ $? -ne 0 ]; then
        log_error "文件大小转换失败"
        return 1
    fi

      # 计算绝对差值
    local diff=$(echo "scale=2; if (${file_size_gb} > ${expected_size_gb}) { ${file_size_gb} - ${expected_size_gb} } else { ${expected_size_gb} - ${file_size_gb} }" | bc)
    if [ $? -ne 0 ]; then
        log_error " 差值计算失败"
        return 1
    fi

    # 比较差值是否超过误差
    if [ "$(echo "${diff} > ${tolerance_gb}" | bc)" -eq 1 ]; then
        log_info "文件大小 ${file_size_gb} GB 与预期 ${expected_size_gb} GB 差值超出范围，正在删除..."
        rm -f "$file_path"
        if [ $? -eq 0 ]; then
            log_info "文件已删除: $file_path"
            return 0
    else
        log_error "删除文件失败: $file_path"
        return 1
        fi
    else
        log_info "文件大小 ${file_size_gb} GB 与预期 ${expected_size_gb} GB 差值在范围内，保留文件"
        return 0
    fi
}

# 函数：设置压缩算法并验证（通用，用于主算法和次级算法）
set_and_verify_algorithm() {
    local algo_type="$1"  # "primary" 或 "recomp"
    local algo="$2"
    local priority="$3"   # 次级算法才有优先级
    local sys_path="$4"   # /sys路径，如 /sys/block/zram0/comp_algorithm

    if [ -z "$algo" ]; then
        log_warn "${algo_type} 算法未设置，跳过"
        return 0
    fi

    local cmd=""
    if [ "$algo_type" = "recomp" ]; then
        cmd="algo=$algo priority=$priority"
    else
        cmd="$algo"
    fi

    log_info "尝试设置 ${algo_type} 算法: $algo (优先级: ${priority:-N/A})"
    echo "$cmd" > "$sys_path"

    if [ "$algo" = "zstd" ] && [ "$support_zstd_level" = 1 ]; then
        echo "$zstd_compression_level" > /sys/module/zstd/parameters/compression_level || log_warn "设置zstd压缩等级失败"
    fi

    # 验证当前算法
    local current_algo
    if [ "$algo_type" = "recomp" ]; then
        current_algo=$(cat "$sys_path" | grep "#${priority}" | grep -o '\[.*\]' | tr -d '[]')
    else
        current_algo=$(cat "$sys_path" | grep -o '\[.*\]' | tr -d '[]')
    fi

    if [ "$current_algo" != "$algo" ]; then
        log_error "${algo_type} 算法 $algo 设置失败"
        log_info "回退到 lz4"
        if [ "$algo_type" = "primary" ]; then
            sed -i "s/$algo/lz4/g" "$MODPATH/files/data/zram.conf"
            echo "lz4" > "$sys_path"
        fi
        send_notification "${algo_type} 算法不支持" "选择的 ${algo_type} 算法 $algo (优先级 ${priority:-N/A}) 不支持，请切换其他算法。"
    fi
    return 0
}

zramoff() {
    log_info "关闭 swap 并重置 zram0"
    sleep 5  # 等待系统稳定
    su -c swapoff /dev/block/zram0
    echo 1 > /sys/block/zram0/reset
    echo 0 > /sys/block/zram0/disksize
}

zramon() {
    log_info "创建 swap 分区"
    su -c mkswap /dev/block/zram0
    log_info "启用 swap，优先级为 32758"
    su -c swapon -p32758 /dev/block/zram0
}

zram_setup() { 
    # 设置日志文件名
    set_log_file "zram"
    # 主逻辑开始
    log_info "开始设置zram"

    pressure=$(cat "$MODPATH/files/data/average_pressure.conf")
    loop_edit=0

    # 关闭并重置zram0
    zramoff

    # 设置主压缩算法
    set_and_verify_algorithm "primary" "$algorithm" "" "/sys/block/zram0/comp_algorithm"

    # 设置次级压缩算法（如果支持）
    if [ "$support_multi_comp" = "CONFIG_ZRAM_MULTI_COMP=y" ]; then
        echo true > "$MODPATH/files/data/feature/support_zram_recompressd"
        for i in 1 2 3; do
            eval "algo=\$recompressd_algorithm$i"
            set_and_verify_algorithm "recomp" "$algo" "$i" "/sys/block/zram0/recomp_algorithm"
        done
    else
        log_warn "内核不支持多压缩，跳过次级算法设置"
        echo false > "$MODPATH/files/data/feature/support_zram_recompressd"
    fi

    # 处理writeback文件
    log_info "检查并处理文件: $FILE"
    check_and_delete_file "$FILE" "$writeback_block_size"

    if [ "$writeback_block_size" -ne 0 ]; then
        if [ ! -f "$FILE" ]; then
            log_info "创建大小为 ${writeback_block_size}GB 的文件: $FILE"
            su -c dd if=/dev/zero of="$FILE" bs=1G count="$writeback_block_size"
            loop_edit=1
        fi
        if [ -f "$TMP_FOLDER/loop_file" ] && [ "$loop_edit" = 0 ]; then
            log_info "使用已绑定的 loop 设备"
            loop_file=$(cat "$TMP_FOLDER/loop_file")
            echo "$loop_file" > /sys/block/zram0/backing_dev
        else
            log_info "绑定文件 $FILE 到 loop 设备"
            LOOP_DEVICE=$(su -c losetup --show -f "$FILE")
            if [ -n "$LOOP_DEVICE" ]; then
                log_info "设置 zram0 的 backing_dev 为 $LOOP_DEVICE"
                echo "$LOOP_DEVICE" > /sys/block/zram0/backing_dev
                echo "$LOOP_DEVICE" > "$TMP_FOLDER/loop_file"
            else
                log_error "loop 设备绑定失败"
            fi
        fi
    else
        log_warn "writeback_block_size 为 0，跳过文件处理"
    fi

    # 设置disksize
    if [ "$support_auto_size" = "CONFIG_ZRAM_AUTO_SIZE=y" ]; then
        echo true > "$MODPATH/files/data/feature/support_auto_size"
    else
        echo false > "$MODPATH/files/data/feature/support_auto_size"
    fi

    if [ "$size" = "auto" ]; then
        echo "$pressure" > /sys/block/zram0/pressure || log_warn "设置pressure失败"
        if [ "$support_auto_size" = "CONFIG_ZRAM_AUTO_SIZE=y" ]; then
            log_info "设置 zram0 磁盘大小为 auto"
            echo "$size" > /sys/block/zram0/disksize || log_error "设置disksize失败"
        else
            log_warn "不支持自动大小，设置默认 16777216"
            echo 16777216 > /sys/block/zram0/disksize || log_error "设置disksize失败"
        fi
    else
        log_info "设置 zram0 磁盘大小为 $size"
        echo "$size" > /sys/block/zram0/disksize || log_error "设置disksize失败"
    fi

    # 创建并启用swap
    zramon
}

zram_setup

