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
    sleep 15  # 等待系统稳定
    su -c swapoff /dev/block/zram0
    sleep 2 # 确保zram已关闭
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
        # 文件创建与 Pinning 流程
        if [ ! -f "$FILE" ]; then
            log_info "创建大小为 ${writeback_block_size}G 的文件: $FILE"
            
            # 确保父目录存在
            mkdir -p "$(dirname "$FILE")"
            
            # TRIM 释放空间，防止分配到脏块
            $MODPATH/bin/fstrim-zram -v "$(dirname "$FILE")" 2>/dev/null
            
            # 先创建空文件
            touch "$FILE"

            # 在文件为空时设置 Pinning
            $MODPATH/bin/f2fs_pin-zram 1 "$FILE"
            if [ $? -ne 0 ]; then
                log_error "F2FS Pin 设置失败，可能不支持或文件系统错误"
                rm -f "$FILE" # 失败了要清理，避免留下未 Pin 的文件
                return 1
            fi
            
            # 预分配
            # 因为已经设置了 Pin 标志，fallocate 会自动在 Pinned Section 寻找连续空间
            $MODPATH/bin/fallocate-zram -l "${writeback_block_size}G" "$FILE"
            if [ $? -ne 0 ]; then
                log_error "fallocate 失败，空间不足？"
                rm -f "$FILE" # 分配失败则清理文件
                return 1
            fi

            # 设置 SELinux 上下文
            chcon u:object_r:writeback_file:s0 "$FILE"
        fi

        # 智能检查 Loop 设备绑定状态
        # 使用 losetup -j 查找该文件是否已经绑定了 Loop 设备
        EXISTING_LOOP=$($MODPATH/bin/losetup-zram -j "$FILE" | head -n1 | cut -d: -f1)

        if [ -n "$EXISTING_LOOP" ]; then
            log_info "检测到文件已绑定到: $EXISTING_LOOP"

            # 检查是否开启了 Direct IO
            DIO_STATUS=$($MODPATH/bin/losetup-zram -a | grep "$EXISTING_LOOP" | grep "direct-io")
            if [ -z "$DIO_STATUS" ]; then
                 log_warn "现有 Loop 未开启 Direct IO，尝试重新绑定..."
                 $MODPATH/bin/losetup-zram -d "$EXISTING_LOOP"
                 EXISTING_LOOP=""
            else
                 LOOP_DEVICE="$EXISTING_LOOP"
            fi
        fi

        # 如果没有绑定，则执行绑定
        if [ -z "$EXISTING_LOOP" ]; then
            log_info "正在绑定文件到 loop 设备..."
            LOOP_DEVICE=$($MODPATH/bin/losetup-zram --direct-io=on --show -f "$FILE")

            if [ -z "$LOOP_DEVICE" ]; then
                log_error "Loop 设备绑定失败！"
                return 1
            fi
        fi

        # 设置 ZRAM backing device
        CURRENT_BACKING=$(cat /sys/block/zram0/backing_dev)

        if [ "$CURRENT_BACKING" == "none" ]; then
            log_info "将 $LOOP_DEVICE 设为 zram0 后端..."
            echo "$LOOP_DEVICE" > /sys/block/zram0/backing_dev
            if [ $? -eq 0 ]; then
                log_info "Writeback 设置成功！"
            else
                log_error "写入 backing_dev 失败，ZRAM 可能已被占用。"
            fi
        elif [ "$CURRENT_BACKING" == "$LOOP_DEVICE" ]; then
            log_info "ZRAM 已经正确配置了该后端设备。"
        else
            log_warn "ZRAM 已有其他后端设备: $CURRENT_BACKING，跳过设置。"
        fi

    else
        log_warn "writeback_block_size 为 0，跳过处理。"
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
            if ! echo "$size" > /sys/block/zram0/disksize; then
                log_error "设置disksize为auto失败,尝试设置为17179869184"
                if ! echo 17179869184 > /sys/block/zram0/disksize; then
                    log_error "设置disksize失败"
                    return 1
                fi
            fi
        else
            log_warn "不支持自动大小，设置默认 17179869184"
            if ! echo 17179869184 > /sys/block/zram0/disksize; then
                log_error "设置disksize失败"
                return 1
            fi
        fi
    else
        log_info "设置 zram0 磁盘大小为 $size"
        if ! echo "$size" > /sys/block/zram0/disksize; then
            log_error "设置disksize失败"
            return 1
        fi
    fi

    # 创建并启用swap
    zramon
}

while [ ! -d /data/user/0/android ]; do
    sleep 1
done

zram_setup

