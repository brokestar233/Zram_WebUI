/**
 * 安全区域处理脚本
 * 用于处理移动设备上的安全区域，避免内容被状态栏或导航栏遮挡
 * 仅对 WebUIX (UA 包含 SukiSU-Ultra 或 WebUI X) 执行处理，跳过 WebUI
 */

// 初始化 Core 可用性
let isCoreAvailable = false;
let originalBaseHeaderHeight = '58px'; // 默认原始头部高度
isWebUIX = Core.isWebUIX;

function initializeCore() {
    isCoreAvailable = typeof Core !== 'undefined' && typeof Core.execCommand === 'function';
    if (!isCoreAvailable) {
        console.error('Core module or execCommand is not available.');
        Core?.showToast?.('Core module is unavailable', 'error');
    }
    return isCoreAvailable;
}

// 日志函数，输出到终端
function logToConsole(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

initializeCore();
logToConsole('Safe-area.js loaded');

// 将useragent输出到终端
if (isCoreAvailable) {
    logToConsole('Core found, logging useragent');
    const userAgent = navigator.userAgent;
    console.log(`UserAgent: ${userAgent}`);
    Core.execCommand(`echo "${userAgent}"`)
        .then(() => {
            logToConsole('Useragent logged successfully');
        })
        .catch((error) => {
            logToConsole('无法记录useragent: ' + JSON.stringify(error, null, 2));
        });
} else {
    logToConsole('Core not found or Core.execCommand not available');
}

// 检查是否为移动设备
const isMobile = window.matchMedia('(max-width: 768px)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
logToConsole('Is mobile device: ' + isMobile);

// 等待DOM加载完成
Core.onDOMReady(() => {
    logToConsole('DOM content loaded');
    // 缓存原始头部高度（在任何修改前获取）
    const header = document.querySelector('.app-header');
    if (header) {
        originalBaseHeaderHeight = getComputedStyle(header).height;
        logToConsole('Cached original base header height: ' + originalBaseHeaderHeight);
        // 记录 header 的 CSS 样式以便调试
        const headerStyles = getComputedStyle(header);
        logToConsole(`Header styles - position: ${headerStyles.position}, margin-top: ${headerStyles.marginTop}, padding-top: ${headerStyles.paddingTop}, box-sizing: ${headerStyles.boxSizing}`);
    }
    handleSafeArea();
});

function handleSafeArea() {
    // 应用到头部和主内容区域
    const header = document.querySelector('.app-header');
    const mainContent = document.getElementById('main-content');
    
    logToConsole('Header element: ' + (header ? 'found' : 'not found'));
    logToConsole('Main content element: ' + (mainContent ? 'found' : 'not found'));
    
    if (mainContent) {
        // 记录 mainContent 的 CSS 样式以便调试
        const mainContentStyles = getComputedStyle(mainContent);
        logToConsole(`Main content styles - margin-top: ${mainContentStyles.marginTop}, padding-top: ${mainContentStyles.paddingTop}, box-sizing: ${mainContentStyles.boxSizing}`);
    }
    
    // 检查是否为 WebUIX
    if (!isWebUIX()) {
        logToConsole('Skipping safe area handling for non-WebUIX client');
        return;
    }
    
    // 如果有Core对象并且可以执行命令，尝试获取状态栏高度
    if (isCoreAvailable) {
        logToConsole('Attempting to get status bar height with dumpsys window');
        
        // 执行命令前先记录
        logToConsole('Executing command: dumpsys window | grep -E "InsetsFrameProvider.*mandatorySystemGestures.*mMinimalInsetsSizeInDisplayCutoutSafe"');
        
        updateStatusBarHeight();
    } else {
        logToConsole('Using fallback method directly - Core not available');
        // 如果没有Core对象，使用备用方法
        fallbackMethod();
    }
}

function updateStatusBarHeight() {
    // 仅对 WebUIX 执行
    if (!isWebUIX()) {
        logToConsole('Skipping status bar height update for non-WebUIX client');
        return;
    }
    
    if (isCoreAvailable) {
        Core.execCommand('dumpsys window | grep -E "InsetsFrameProvider.*mandatorySystemGestures.*mMinimalInsetsSizeInDisplayCutoutSafe"')
            .then(result => {
                logToConsole('Command result: ' + JSON.stringify(result));
                if (!result || !result.trim()) {
                    logToConsole('Command result is empty');
                    fallbackMethod();
                    return;
                }
                // 尝试主要正则表达式
                let match = result.match(/mMinimalInsetsSizeInDisplayCutoutSafe=Insets{left=\d+, top=(\d+), right=\d+, bottom=\d+}/);
                if (match && match[1]) {
                    let statusBarHeight = parseInt(match[1]);
                    if (!isNaN(statusBarHeight) && statusBarHeight > 0) {
                        // 检查高度是否合理（防止异常值）
                        if (statusBarHeight > 200) {
                            logToConsole('Warning: Status bar height ' + statusBarHeight + ' seems too large, using 0');
                            statusBarHeight = 0;
                        }
                        logToConsole('Parsed status bar height: ' + statusBarHeight);
                        applyStatusBarHeight(statusBarHeight);
                        return;
                    }
                }
                // 尝试备用正则表达式
                match = result.match(/top=(\d+)/);
                if (match && match[1]) {
                    let statusBarHeight = parseInt(match[1]);
                    if (!isNaN(statusBarHeight) && statusBarHeight > 0) {
                        // 检查高度是否合理
                        if (statusBarHeight > 200) {
                            logToConsole('Warning: Status bar height ' + statusBarHeight + ' seems too large, using 0');
                            statusBarHeight = 0;
                        }
                        logToConsole('Alternative parsed status bar height: ' + statusBarHeight);
                        applyStatusBarHeight(statusBarHeight);
                        return;
                    }
                }
                logToConsole('Failed to parse status bar height from result: ' + JSON.stringify(result));
                fallbackMethod();
            })
            .catch(error => {
                logToConsole('Command execution failed: ' + JSON.stringify(error, null, 2));
                fallbackMethod();
            });
    } else {
        fallbackMethod();
    }
}

function applyStatusBarHeight(height) {
    logToConsole('Applying status bar height: ' + height);
    const heightPx = height + 'px';
    const offsetPx = (height / 4) + 'px';
    const header = document.querySelector('.app-header');
    const mainContent = document.getElementById('main-content');

    if (header) {
        header.style.paddingTop = heightPx;
    }
    
    if (mainContent) {
        mainContent.style.marginTop = `calc(${originalBaseHeaderHeight} + ${offsetPx})`;
    }
}

function fallbackMethod() {
    // 仅对 WebUIX 执行
    if (!isWebUIX()) {
        logToConsole('Skipping fallback method for non-WebUIX client');
        return;
    }
    
    logToConsole('Using fallback method for safe area');
    // 创建CSS变量来存储安全区域信息
    const setSafeArea = () => {
        // 获取安全区域的值
        const top = getSafeAreaValue('top');
        logToConsole('Fallback safe area top value: ' + top);
        
        const header = document.querySelector('.app-header');
        const mainContent = document.getElementById('main-content');
        
        // 应用到头部
        if (header) {
            header.style.paddingTop = top;
        }
        
        // 应用到主内容区域
        if (mainContent) {
            mainContent.style.marginTop = originalBaseHeaderHeight; // 仅使用原始 header 高度
        }
    };
    
    // 获取安全区域值的函数
    function getSafeAreaValue(position) {
        if (!window.CSS || !CSS.supports('height', 'env(safe-area-inset-top)')) {
            logToConsole('CSS env variables not supported by this browser');
            return '0px';
        }
        // 创建一个临时元素来测量安全区域
        const tempDiv = document.createElement('div');
        tempDiv.style.position = 'fixed';
        tempDiv.style[getPositionProperty(position)] = '0';
        tempDiv.style.left = '0';
        tempDiv.style.width = '0';
        tempDiv.style.height = 'env(safe-area-inset-' + position + ')';
        tempDiv.style.visibility = 'hidden';
        document.body.appendChild(tempDiv);
        
        // 获取计算后的高度
        const value = getComputedStyle(tempDiv).height || '0px';
        document.body.removeChild(tempDiv);
        
        return value;
    };
    
    // 根据位置获取CSS属性
    function getPositionProperty(position) {
        switch(position) {
            case 'top': return 'top';
            case 'bottom': return 'bottom';
            case 'left': return 'left';
            case 'right': return 'right';
            default: return 'top';
        }
    }
    
    // 初始设置
    setSafeArea();
}

// 监听屏幕方向变化
window.addEventListener('orientationchange', function() {
    logToConsole('Orientation changed');
    setTimeout(updateStatusBarHeight, 100);
});

// 监听窗口大小变化
window.addEventListener('resize', function() {
    logToConsole('Window resized');
    setTimeout(updateStatusBarHeight, 100);
});
