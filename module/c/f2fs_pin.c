#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <sys/types.h>
#include <unistd.h>
#include <linux/types.h>

/* 定义 F2FS 相关的 ioctl 编号 */
/* 如果系统头文件没有包含，可以手动定义 */
#ifndef F2FS_IOCTL_MAGIC
#define F2FS_IOCTL_MAGIC 0xf5
#endif

#ifndef F2FS_IOC_SET_PIN_FILE
#define F2FS_IOC_SET_PIN_FILE _IOW(F2FS_IOCTL_MAGIC, 13, __u32)
#endif

#ifndef F2FS_IOC_GET_PIN_FILE
#define F2FS_IOC_GET_PIN_FILE _IOR(F2FS_IOCTL_MAGIC, 14, __u32)
#endif

int main(int argc, char *argv[]) {
    if (argc != 3) {
        fprintf(stderr, "用法: %s <1|0> <文件路径>\n", argv[0]);
        fprintf(stderr, "  1: 启用固定 (Pin)\n");
        fprintf(stderr, "  0: 禁用固定 (Unpin)\n");
        return 1;
    }

    int pin_mode = atoi(argv[1]);
    const char *file_path = argv[2];

    // 1. 打开文件
    // 注意：修改 pin 状态通常需要写权限
    int fd = open(file_path, O_RDWR);
    if (fd < 0) {
        perror("打开文件失败");
        return 1;
    }

    // 2. 执行 ioctl 调用
    __u32 pin = (__u32)pin_mode;
    if (ioctl(fd, F2FS_IOC_SET_PIN_FILE, &pin) < 0) {
        perror("ioctl 设置失败 (可能文件系统不是 F2FS 或权限不足)");
        close(fd);
        return 1;
    }

    printf("成功将文件 %s 的 Pin 状态设置为: %d\n", file_path, pin);

    // 3. 验证状态
    __u32 current_pin = 0;
    if (ioctl(fd, F2FS_IOC_GET_PIN_FILE, &current_pin) == 0) {
        printf("验证：当前文件 Pin 状态为: %u\n", current_pin);
    }

    close(fd);
    return 0;
}