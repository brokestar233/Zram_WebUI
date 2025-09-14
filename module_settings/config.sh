#!/system/bin/sh
if [ -f build_config.sh  ]; then
. build_config.sh
elif [ -f module_settings/build_config.sh  ]; then
. module_settings/build_config.sh
elif [ -f $MODPATH/module_settings/build_config.sh  ]; then
. $MODPATH/module_settings/build_config.sh
fi

print_languages="zh"                   # Default language for printing
algorithm=lz4
recompressd_algorithm1=zstd
recompressd_algorithm2=
recompressd_algorithm3=
size=auto
writeback_block_size=8
zstd_compression_level=9
