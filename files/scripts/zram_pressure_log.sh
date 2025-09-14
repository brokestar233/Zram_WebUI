#!system/bin/sh

MODDIR=$1

# 获取系统内存使用率（百分比）
get_memory_pressure() {
    local total_mem=0
    local free_mem=0
    local available_mem=0
    local used_mem=0
    local pressure=0

    # 读取 /proc/meminfo
    if [ -f "/proc/meminfo" ]; then
        total_mem=$(grep "^MemTotal:" /proc/meminfo | awk '{print $2}')
        available_mem=$(grep "^MemAvailable:" /proc/meminfo | awk '{print $2}')

        # 使用 MemAvailable 计算内存使用率
        if [ "$available_mem" -gt 0 ] && [ "$total_mem" -gt 0 ]; then
            used_mem=$((total_mem - available_mem))
            pressure=$((used_mem * 100 / total_mem))
            # 限制在 0-100
            if [ "$pressure" -gt 100 ]; then
                pressure=100
            fi
            echo "$pressure"
            return 0
        fi
    fi

    return 1
}

# 获取 Zram 使用率（百分比）
get_zram_pressure() {
    local zram_sysfs_path="/sys/block/zram0"  # 假设使用 zram0，可根据实际修改
    local orig_data_size=0
    local zram_total_size=0
    local pressure=0

    # 检查 mm_stat 文件是否存在
    if [ ! -f "$zram_sysfs_path/mm_stat" ]; then
        return 1
    fi

    # 读取 mm_stat，获取未压缩数据大小（第一个字段，orig_data_size，单位：bytes）
    orig_data_size=$(awk '{print $1}' "$zram_sysfs_path/mm_stat" 2>/dev/null)
    if [ -z "$orig_data_size" ] || ! [[ "$orig_data_size" =~ ^[0-9]+$ ]]; then
        return 1
    fi

    # 读取 ZRAM 设备总大小（disksize，单位：bytes）
    if [ -f "$zram_sysfs_path/disksize" ]; then
        zram_total_size=$(cat "$zram_sysfs_path/disksize" 2>/dev/null)
        if [ -z "$zram_total_size" ] || ! [[ "$zram_total_size" =~ ^[0-9]+$ ]]; then
            return 1
        fi
    else
        return 1
    fi

    # 计算 ZRAM 使用率
    if [ "$zram_total_size" -gt 0 ]; then
        pressure=$((orig_data_size * 100 / zram_total_size))
        # 限制在 0-100
        if [ "$pressure" -gt 100 ]; then
            pressure=100
        elif [ "$pressure" -lt 0 ]; then
            pressure=0
        fi
        echo "$pressure"
        return 0
    else
        return 1
    fi
}

# 更新计数文件
update_count() {
    local count_file="$MODDIR/memory_zram_count"
    local count=0

    # 如果计数文件存在，读取当前计数
    if [ -f "$count_file" ]; then
        count=$(cat "$count_file")
    fi

    # 增加计数
    count=$((count + 1))
    echo "$count" > "$count_file"

    echo "$count"
}

# 计算平均值并输出到新文件
calculate_average() {
    local output_file="$MODDIR/memory_zram_pressure.log"
    local avg_file="$MODDIR/average_pressure.conf"
    local mem_sum=0
    local zram_sum=0
    local count=0
    local mem_avg=0
    local zram_avg=0

    # 读取日志文件，计算总和
    while IFS=: read -r mem zram || [ -n "$mem" ]; do # The || [ -n "$mem" ] handles the last line if it doesn't end with a newline
        mem_sum=$((mem_sum + mem))
        zram_sum=$((zram_sum + zram))
        count=$((count + 1))
    done < "$output_file"

    # 计算平均值
    if [ "$count" -gt 0 ]; then
        mem_avg=$((mem_sum / count))
        zram_avg=$((zram_sum / count))
    fi

    # 输出平均值到新文件
    echo "$mem_avg:$zram_avg" > "$avg_file"
    chmod 644 "$avg_file"

    : > "$MODDIR/memory_zram_count" # Clear the count file
}

# 主函数
main() {
    local output_file="$MODDIR/memory_zram_pressure.log"
    local max_lines=100
    local mem_pressure
    local zram_pressure

    # 获取内存压力和Zram压力
    mem_pressure=$(get_memory_pressure)
    zram_pressure=$(get_zram_pressure)

    # 格式化输出
    local output_line="$mem_pressure:$zram_pressure"

    # 如果输出文件不存在，创建它
    if [ ! -f "$output_file" ]; then
        touch "$output_file"
        chmod 644 "$output_file"
    fi

    # 检查当前行数
    local current_lines
    current_lines=$(wc -l < "$output_file")

    # 如果行数超过最大限制，移除最旧的一行
    if [ "$current_lines" -ge "$max_lines" ]; then
        # Using sed for in-place line deletion, or tail for simplicity
        # sed -i '1d' "$output_file" # This is GNU sed specific.
        # For POSIX sh compatibility, recreate the file with tail
        tail -n $((max_lines - 1)) "$output_file" > "$output_file.tmp"
        mv "$output_file.tmp" "$output_file"
    fi

    # 追加新数据到文件
    echo "$output_line" >> "$output_file"

    # 更新计数并检查是否达到5次
    local count
    count=$(update_count)
    if [ "$count" -ge 5 ]; then
        calculate_average
    fi
}

# 不记录开机前5分钟数据
sleep 300

# 调用主函数
while true
do
    main
    sleep 60
done
