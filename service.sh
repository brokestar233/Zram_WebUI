#!/system/bin/sh
MODDIR=${0%/*}
MODPATH="$MODDIR"
MODID=$(basename "$MODDIR")
STATUS_FILE="$MODPATH/status.txt"
BIN_DIR="$MODPATH/bin"
FILEWATCH_BIN="$BIN_DIR/filewatcher-${MODID}"
# 设置初始状态为"运行中"
echo "RUNNING" >"$STATUS_FILE"

# 初始化日志目录
LOG_DIR="$MODPATH/logs"
mkdir -p "$LOG_DIR" || {
    echo "${ERROR_INVALID_DIR}: $LOG_DIR" >&2
    exit 1
}

# 加载主脚本
if [ ! -f "$MODPATH/files/scripts/default_scripts/main.sh" ]; then
    echo "[ERROR] $FILE_NOT_FOUND: $MODPATH/files/scripts/default_scripts/main.sh" >"$LOG_DIR/error.log"
    exit 1
else
    . "$MODPATH/files/scripts/default_scripts/main.sh"
    # 设置service脚本的日志文件
    start_script
    set_log_file "service"
fi
if [ ! -f "$MODPATH/bin/filewatcher-${MODID}" ]; then
    log_warn "$FILE_NOT_FOUND: $MODPATH/bin/filewatcher-${MODID}"
fi
# 定义状态更新函数
update_status() {
    echo "$1" >"$STATUS_FILE"
    log_info "${SERVICE_STATUS_UPDATE:-状态已更新}: $1"
}

# 定义abort函数，与main.sh中的Aurora_abort保持一致
abort() {
    log_error "$1"
    update_status "ERROR"
    exit 1
}

# 进入暂停模式的函数
enter_pause_mode() {
    update_status "PAUSED"
    log_info "${SERVICE_PAUSED:-已进入暂停模式，监控文件}: $1"
    # 检查参数数量
    if [ -f "$FILEWATCH_BIN" ]; then
            log_debug "开始检测"
            "$FILEWATCH_BIN" -o "$1" "echo true"
            return $?
    else
        log_error "$FILEWATCH_BIN $SERVICE_FILE_NOT_FOUND"
        update_status "ERROR"
        return -1
    fi
}

# 记录启动信息
log_info "${SERVICE_STARTED:-服务已启动}"

# 加载服务脚本
if [ ! -f "$MODPATH/files/scripts/service_script.sh" ]; then
    log_error "${SERVICE_FILE_NOT_FOUND:-文件未找到}: $MODPATH/files/scripts/service_script.sh"
    Aurora_abort "${SERVICE_FILE_NOT_FOUND:-文件未找到}!!!($MODPATH/files/scripts/service_script.sh)" 1
else
    log_info "${SERVICE_LOADING_SERVICE_SCRIPT:-正在加载service_script.sh}"
    . "$MODPATH/files/scripts/service_script.sh"
fi

# 记录正常退出信息
log_info "${SERVICE_NORMAL_EXIT:-服务正常退出}"
# 脚本结束前更新状态为正常退出
update_status "NORMAL_EXIT"

stop_logger
