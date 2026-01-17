#!/system/bin/sh
action_id="zram"
action_name="Zram_WebUI"
action_author="BrokeStar"
action_description="A web UI for Zram"

Github_update_repo="brokestar233\/Zram_WebUI"
updateJson=""

magisk_min_version="25400"             # Minimum required version of Magisk
ksu_min_version="11300"                # Minimum compatible version of KernelSU
ksu_min_kernel_version="11300"         # Minimum compatible kernel version of KernelSU
apatch_min_version="10657"             # Minimum compatible version of APatch
ANDROID_API="26"                      # Minimum required Android API level