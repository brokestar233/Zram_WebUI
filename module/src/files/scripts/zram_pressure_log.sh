#!/system/bin/sh

MODDIR="$1"
ZRAM_DEV="/sys/block/zram0"
PRESSURE_NODE="$ZRAM_DEV/pressure"
DISKSIZE_NODE="$ZRAM_DEV/disksize"
MM_STAT_NODE="$ZRAM_DEV/mm_stat"
LOG_FILE="$MODDIR/memory_zram_pressure.log"
COUNT_FILE="$MODDIR/memory_zram_count"
AVG_FILE="$MODDIR/average_pressure.conf"
MAX_LINES=100
SAMPLE_INTERVAL=60
WARMUP_SECONDS=300
AVERAGE_EVERY=5

get_memory_pressure() {
    local total_mem available_mem used_mem pressure

    if [ ! -f /proc/meminfo ]; then
        return 1
    fi

    total_mem=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
    available_mem=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)

    case "$total_mem:$available_mem" in
        ''*|*'::'*|*:)
            return 1
            ;;
    esac

    if [ "$total_mem" -le 0 ] || [ "$available_mem" -lt 0 ]; then
        return 1
    fi

    used_mem=$((total_mem - available_mem))
    pressure=$((used_mem * 100 / total_mem))

    if [ "$pressure" -gt 100 ]; then
        pressure=100
    elif [ "$pressure" -lt 0 ]; then
        pressure=0
    fi

    echo "$pressure"
    return 0
}

get_zram_pressure() {
    local orig_data_size zram_total_size pressure

    if [ ! -f "$MM_STAT_NODE" ] || [ ! -f "$DISKSIZE_NODE" ]; then
        return 1
    fi

    orig_data_size=$(awk '{print $1}' "$MM_STAT_NODE" 2>/dev/null)
    zram_total_size=$(cat "$DISKSIZE_NODE" 2>/dev/null)

    case "$orig_data_size:$zram_total_size" in
        *[!0-9:]*|:*:*)
            return 1
            ;;
    esac

    if [ -z "$orig_data_size" ] || [ -z "$zram_total_size" ]; then
        return 1
    fi

    if [ "$zram_total_size" -le 0 ]; then
        return 1
    fi

    pressure=$((orig_data_size * 100 / zram_total_size))

    if [ "$pressure" -gt 100 ]; then
        pressure=100
    elif [ "$pressure" -lt 0 ]; then
        pressure=0
    fi

    echo "$pressure"
    return 0
}

get_last_disksize() {
    local disksize

    if [ ! -f "$DISKSIZE_NODE" ]; then
        return 1
    fi

    disksize=$(cat "$DISKSIZE_NODE" 2>/dev/null)
    case "$disksize" in
        ''|*[!0-9]*)
            return 1
            ;;
    esac

    echo "$disksize"
    return 0
}

ensure_state_files() {
    [ -d "$MODDIR" ] || mkdir -p "$MODDIR"

    [ -f "$LOG_FILE" ] || : > "$LOG_FILE"
    [ -f "$COUNT_FILE" ] || echo 0 > "$COUNT_FILE"

    chmod 644 "$LOG_FILE" "$COUNT_FILE" 2>/dev/null
}

append_log_line() {
    local line="$1"
    local current_lines

    if [ -f "$LOG_FILE" ]; then
        current_lines=$(wc -l < "$LOG_FILE" 2>/dev/null)
    else
        current_lines=0
    fi

    if [ -z "$current_lines" ]; then
        current_lines=0
    fi

    if [ "$current_lines" -ge "$MAX_LINES" ]; then
        tail -n $((MAX_LINES - 1)) "$LOG_FILE" > "$LOG_FILE.tmp" 2>/dev/null
        mv "$LOG_FILE.tmp" "$LOG_FILE"
    fi

    echo "$line" >> "$LOG_FILE"
}

update_count() {
    local count=0

    if [ -f "$COUNT_FILE" ]; then
        count=$(cat "$COUNT_FILE" 2>/dev/null)
    fi

    case "$count" in
        ''|*[!0-9]*)
            count=0
            ;;
    esac

    count=$((count + 1))
    echo "$count" > "$COUNT_FILE"
    echo "$count"
}

calculate_average() {
    local mem_sum=0
    local zram_sum=0
    local size_sum=0
    local count=0
    local mem zram size
    local mem_avg=0
    local zram_avg=0
    local size_avg=0

    [ -f "$LOG_FILE" ] || return 1

    while IFS=: read -r mem zram size || [ -n "$mem" ]; do
        case "$mem:$zram:$size" in
            *[!0-9:]*|'::'|''*)
                continue
                ;;
        esac

        [ -n "$mem" ] || continue
        [ -n "$zram" ] || continue
        [ -n "$size" ] || continue

        mem_sum=$((mem_sum + mem))
        zram_sum=$((zram_sum + zram))
        size_sum=$((size_sum + size))
        count=$((count + 1))
    done < "$LOG_FILE"

    if [ "$count" -le 0 ]; then
        return 1
    fi

    mem_avg=$((mem_sum / count))
    zram_avg=$((zram_sum / count))
    size_avg=$((size_sum / count))

    pressure="$mem_avg:$zram_avg:$size_avg"
    echo "$pressure" > "$AVG_FILE"
    chmod 644 "$AVG_FILE" 2>/dev/null

    echo 0 > "$COUNT_FILE"
}

sample_once() {
    local mem_pressure zram_pressure last_disksize pressure count

    mem_pressure=$(get_memory_pressure) || return 1
    zram_pressure=$(get_zram_pressure) || return 1
    last_disksize=$(get_last_disksize) || return 1

    pressure="$mem_pressure:$zram_pressure:$last_disksize"
    append_log_line "$pressure"

    count=$(update_count)
    if [ "$count" -ge "$AVERAGE_EVERY" ]; then
        calculate_average
    fi
}

main_loop() {
    ensure_state_files
    sleep "$WARMUP_SECONDS"

    while true; do
        sample_once
        sleep "$SAMPLE_INTERVAL"
    done
}

main_loop
