#!/system/bin/sh

set_log_file "service_custom"

monitor_config() {
    log_info "开始监控配置文件变化"
    enter_pause_mode "$MODPATH/module_settings/config.sh"
    return $?
}

if [ "$size" = "auto" ]; then
    chmod 777 -R "$MODPATH/files/scripts/zram_pressure_log.sh"
    log_info "开始监控zram占用"
    sh $MODPATH/files/scripts/zram_pressure_log.sh "$MODPATH/files/data" &
fi

# 加载zran脚本
if [ ! -f "$MODPATH/files/scripts/zram.sh" ]; then
    log_error "${SERVICE_FILE_NOT_FOUND:-文件未找到}: $MODPATH/files/scripts/zram.sh"
    Aurora_abort "${SERVICE_FILE_NOT_FOUND:-文件未找到}!!!($MODPATH/files/scripts/zram.sh)" 1
else
    log_info "${SERVICE_LOADING_SERVICE_SCRIPT:-正在加载zram.sh}"
    rm $TMP_FOLDER/loop_file
    . "$MODPATH/files/scripts/zram.sh"
fi

while true; do
    set_log_file "service_custom"
    monitor_config
    if [ "$?" = "0" ]; then
        log_info "配置文件改动,重新设置zram"
        reload_config
        zram_setup
    else
        Aurora_abort "检测进程异常退出"
    fi

done
