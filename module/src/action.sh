#!/system/bin/sh
MODDIR=${0%/*}
MODPATH="$MODDIR"
MODID=$(basename "$MODDIR")
# 初始化日志目录
LOG_DIR="$MODPATH/logs"
timestamp=$(date '+%Y_%m_%d_%H_%M_%S')

if [ ! -f "$MODPATH/files/scripts/default_scripts/main.sh" ]; then
    echo "File not found: $MODPATH/files/scripts/default_scripts/main.sh" >> "$LOG_DIR/error.log"
    exit 1
else
    . "$MODPATH/files/scripts/default_scripts/main.sh"
    # 记录action.sh被调用
    start_script
    set_log_file "action"
fi
# 在这里添加您的自定义脚本逻辑
# -----------------
# This script extends the functionality of the default and setup scripts, allowing direct use of their variables and functions.
# SCRIPT_EN.md

dmesg > "$LOG_DIR/dmesg.log"

(cd $LOG_DIR && $MODPATH/bin/7zz-zram a "$MODPATH/TEMP/Zram_WebUI_LOGS_${timestamp}.zip" ./* -mx9 -y)

mv $MODPATH/TEMP/Zram_WebUI_LOGS_${timestamp}.zip /storage/emulated/0/Zram_WebUI_LOGS_${timestamp}.zip

# 调用 Android 分享 API 发送 ZIP 文件
am start -a android.intent.action.SEND \
    -t "application/zip" \
    --eu android.intent.extra.STREAM "file:///storage/emulated/0/Zram_WebUI_LOGS_${timestamp}.zip" \
    --grant-read-uri-permission

# 定义清理进程函数
stop_logger