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

    if [ -z "$available_mem" ]; then
        available_mem=$(awk '
            /^MemFree:/ { mem_free=$2 }
            /^Buffers:/ { buffers=$2 }
            /^Cached:/ { cached=$2 }
            /^SReclaimable:/ { sreclaimable=$2 }
            /^Shmem:/ { shmem=$2 }
            END {
                print mem_free + buffers + cached + sreclaimable - shmem
            }
        ' /proc/meminfo)
    fi

    if [ -z "$total_mem" ] || [ -z "$available_mem" ]; then
        return 1
    fi

    case "$total_mem:$available_mem" in
        *[!0-9:]*|*::* )
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
        echo 0
        return 0
    fi

    orig_data_size=$(awk '{print $1}' "$MM_STAT_NODE" 2>/dev/null)
    zram_total_size=$(cat "$DISKSIZE_NODE" 2>/dev/null)

    case "$orig_data_size:$zram_total_size" in
        *[!0-9:]*|:*:*)
            echo 0
            return 0
            ;;
    esac

    if [ -z "$orig_data_size" ] || [ -z "$zram_total_size" ]; then
        echo 0
        return 0
    fi

    if [ "$zram_total_size" -le 0 ]; then
        echo 0
        return 0
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
        echo 0
        return 0
    fi

    disksize=$(cat "$DISKSIZE_NODE" 2>/dev/null)
    case "$disksize" in
        ''|*[!0-9]*)
            echo 0
            return 0
            ;;
    esac

    echo "$disksize"
    return 0
}

ensure_state_files() {
    local avg_value avg_first avg_second avg_third

    [ -d "$MODDIR" ] || mkdir -p "$MODDIR"

    [ -f "$LOG_FILE" ] || : > "$LOG_FILE"
    [ -f "$COUNT_FILE" ] || echo 0 > "$COUNT_FILE"
    [ -f "$AVG_FILE" ] || echo "50:50:0" > "$AVG_FILE"

    avg_value=$(cat "$AVG_FILE" 2>/dev/null)
    case "$avg_value" in
        [0-9]*:[0-9]*:[0-9]*)
            ;;
        [0-9]*:[0-9]*)
            avg_first=${avg_value%%:*}
            avg_second=${avg_value#*:}
            echo "$avg_first:$avg_second:0" > "$AVG_FILE"
            ;;
        *)
            echo "50:50:0" > "$AVG_FILE"
            ;;
    esac

    chmod 644 "$LOG_FILE" "$COUNT_FILE" "$AVG_FILE" 2>/dev/null
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
    local count=0
    local mem zram size extra
    local mem_avg=0
    local zram_avg=0
    local last_disksize=0

    [ -f "$LOG_FILE" ] || return 1

    while IFS=: read -r mem zram size extra || [ -n "$mem" ]; do
        case "$mem:$zram" in
            *[!0-9:]*|*::* )
                continue
                ;;
        esac

        [ -n "$mem" ] || continue
        [ -n "$zram" ] || continue

        if [ -n "$size" ]; then
            case "$size${extra:+:$extra}" in
                *[!0-9:]*|*::* )
                    continue
                    ;;
            esac
        fi

        mem_sum=$((mem_sum + mem))
        zram_sum=$((zram_sum + zram))
        count=$((count + 1))
    done < "$LOG_FILE"

    if [ "$count" -le 0 ]; then
        return 1
    fi

    mem_avg=$((mem_sum / count))
    zram_avg=$((zram_sum / count))

    last_disksize=$(get_last_disksize 2>/dev/null) || last_disksize=0

    pressure="$mem_avg:$zram_avg:$last_disksize"
    echo "$pressure" > "$AVG_FILE"
    chmod 644 "$AVG_FILE" 2>/dev/null

    echo 0 > "$COUNT_FILE"
}

sample_once() {
    local mem_pressure zram_pressure pressure count

    mem_pressure=$(get_memory_pressure 2>/dev/null) || mem_pressure=0
    zram_pressure=$(get_zram_pressure 2>/dev/null) || zram_pressure=0

    pressure="$mem_pressure:$zram_pressure"
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
