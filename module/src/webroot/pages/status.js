/**
 * zram WebUI 状态页面模块
 * 重构为内存 / Swap / Zram 状态总览页
 */

const PAGE_SIZE = 4096;
const STATUS_AUTO_REFRESH_MS = 60000;

const StatusPage = {
  moduleStatus: 'UNKNOWN',
  refreshTimer: null,
  moduleInfo: {},
  version: null,
  logCount: 0,
  statusMetrics: null,
  lastUpdatedAt: null,
  boundLanguageChangeHandler: null,

  currentVersion: '20240503',
  GitHubRepo: 'brokestar233/Zram_WebUI',
  latestVersion: null,
  updateAvailable: false,
  updateChecking: false,
  updateError: null,

  testMode: {
    enabled: false,
    mockVersion: null
  },

  async checkUpdate() {
    if (this.updateChecking) return;
    this.updateChecking = true;

    try {
      const versionInfo = await this.getLatestVersion();

      if (versionInfo) {
        this.latestVersion = versionInfo;
        this.updateAvailable = parseInt(versionInfo.formattedDate, 10) > parseInt(this.currentVersion, 10);
        this.updateError = null;
      } else {
        this.updateAvailable = false;
        this.updateError = null;
      }

      window.dispatchEvent(
        new CustomEvent('updateCheckComplete', {
          detail: {
            available: this.updateAvailable,
            version: this.latestVersion
          }
        })
      );
    } catch (error) {
      console.warn('检查更新失败:', error);
      this.updateAvailable = false;
      this.updateError = error.message;
    } finally {
      this.updateChecking = false;

      const updateBannerContainer = document.querySelector('.update-banner-container');
      if (updateBannerContainer) {
        updateBannerContainer.innerHTML = this.renderUpdateBanner();
      }
    }
  },

  renderUpdateBanner() {
    if (this.updateChecking) {
      return `
        <div class="update-banner checking">
          <div class="update-info">
            <div class="update-icon">
              <span class="material-symbols-rounded rotating">sync</span>
            </div>
            <div class="update-text">
              <div class="update-title">${I18n.translate('CHECKING_UPDATE', '正在检查更新...')}</div>
            </div>
          </div>
        </div>
      `;
    }

    if (this.updateError) {
      return `
        <div class="update-banner error">
          <div class="update-info">
            <div class="update-icon">
              <span class="material-symbols-rounded">error</span>
            </div>
            <div class="update-text">
              <div class="update-title">${I18n.translate('UPDATE_CHECK_FAILED', '检查更新失败')}</div>
              <div class="update-subtitle">${this.escapeHtml(this.updateError)}</div>
            </div>
          </div>
        </div>
      `;
    }

    if (this.updateAvailable && this.latestVersion) {
      return `
        <div class="update-banner available">
          <div class="update-info">
            <div class="update-icon">
              <span class="material-symbols-rounded">system_update</span>
            </div>
            <div class="update-text">
              <div class="update-title">${I18n.translate('UPDATE_AVAILABLE', '有新版本可用')}</div>
              <div class="update-version">
                <span class="version-tag">${this.escapeHtml(this.latestVersion.tagName)}</span>
                <span class="version-date">${this.formatDate(this.latestVersion.formattedDate)}</span>
              </div>
            </div>
          </div>
          <button class="update-button md3-button" onclick="app.OpenUrl('https://github.com/${this.GitHubRepo}/releases/latest', '_blank')">
            <span class="material-symbols-rounded">open_in_new</span>
            <span>${I18n.translate('VIEW_UPDATE', '查看更新')}</span>
          </button>
        </div>
      `;
    }

    return '';
  },

  formatDate(dateString) {
    if (!dateString || dateString.length !== 8) return dateString;
    const year = dateString.substring(2, 4);
    const month = dateString.substring(4, 6);
    const day = dateString.substring(6, 8);
    return `${year}/${month}/${day}`;
  },

  formatTime(dateValue) {
    if (!dateValue) return '--';

    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '--';

    return date.toLocaleTimeString();
  },

  async getLatestVersion() {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        const response = await fetch(`https://api.github.com/repos/${this.GitHubRepo}/releases/latest`);

        if (!response.ok) {
          throw new Error(`GitHub API请求失败: ${response.status}`);
        }

        const data = await response.json();
        const tagName = data.tag_name;
        const publishDate = new Date(data.published_at);
        const formattedDate =
          publishDate.getFullYear() +
          String(publishDate.getMonth() + 1).padStart(2, '0') +
          String(publishDate.getDate()).padStart(2, '0');

        return { tagName, formattedDate };
      } catch (error) {
        console.error(`获取最新版本失败 (尝试 ${retryCount + 1}/${maxRetries}):`, error);
        retryCount++;

        if (retryCount === maxRetries) {
          console.error('达到最大重试次数，版本检查失败');
          return null;
        }

        await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** retryCount, 5000)));
      }
    }

    return null;
  },

  getEmptyMetrics() {
    return {
      memory: {
        total: 0,
        used: 0,
        usedPercent: 0
      },
      swap: {
        total: 0,
        used: 0,
        usedPercent: 0,
        cached: 0
      },
      footer: {
        combinedUsedPercent: 0,
        combinedUsed: 0,
        combinedTotal: 0,
        usedPercentByMemory: 0,
        swapCached: 0
      },
      vmParameters: [
        { label: 'swappiness', value: '--' },
        { label: 'watermark_scale_factor', value: '--' }
      ],
      swapDevices: [],
      zram: {
        rawDataSize: 0,
        compressedSize: 0,
        physicalMemoryUsed: 0,
        compressionRatio: '--',
        backingDevice: '-',
        totalRead: 0,
        totalWrite: 0,
        currentResidentDisk: 0
      },
      swapIo: {
        pswpin: 0,
        pswpout: 0
      }
    };
  },

  async preloadData() {
    try {
      const tasks = [
        this.loadModuleInfo(),
        this.loadStatusMetrics(),
        this.getLogCount(),
        this.getLatestVersion(),
        this.loadModuleStatus()
      ];

      const [moduleInfo, statusMetrics, logCount, latestVersion, moduleStatus] = await Promise.allSettled(tasks);

      return {
        moduleInfo: moduleInfo.value || {},
        statusMetrics: statusMetrics.value || this.getEmptyMetrics(),
        logCount: logCount.value || 0,
        latestVersion: latestVersion.value || null,
        moduleStatus: moduleStatus.value || 'UNKNOWN',
        lastUpdatedAt: new Date().toISOString()
      };
    } catch (error) {
      console.warn('预加载数据失败:', error);
      return null;
    }
  },

  async init() {
    try {
      this.registerActions();

      if (!this.boundLanguageChangeHandler) {
        this.boundLanguageChangeHandler = this.onLanguageChanged.bind(this);
      }
      I18n.registerLanguageChangeHandler(this.boundLanguageChangeHandler);

      const preloadedData = PreloadManager.getData('status');
      if (preloadedData) {
        this.moduleInfo = preloadedData.moduleInfo || {};
        this.statusMetrics = preloadedData.statusMetrics || this.getEmptyMetrics();
        this.logCount = preloadedData.logCount || 0;
        this.latestVersion = preloadedData.latestVersion || null;
        this.moduleStatus = preloadedData.moduleStatus || 'UNKNOWN';
        this.version = this.moduleInfo.version || 'Unknown';
        this.lastUpdatedAt = preloadedData.lastUpdatedAt || new Date().toISOString();
      } else {
        await this.loadModuleInfo();
        await this.loadStatusMetrics();
        await this.getLogCount();
        await this.loadModuleStatus();
      }

      this.startAutoRefresh();
      this.checkUpdate();
      return true;
    } catch (error) {
      console.error('初始化状态页面失败:', error);
      return false;
    }
  },

  async loadModuleInfo() {
    try {
      const cachedInfo = sessionStorage.getItem('moduleInfo');
      if (cachedInfo) {
        this.moduleInfo = JSON.parse(cachedInfo);
        this.version = this.moduleInfo.version || 'Unknown';
        return this.moduleInfo;
      }

      const configOutput = await Core.execCommand(`cat "${Core.MODULE_PATH}module.prop"`);

      if (configOutput) {
        const lines = configOutput.split('\n');
        const config = {};

        lines.forEach(line => {
          const parts = line.split('=');
          if (parts.length >= 2) {
            const key = parts[0].trim();
            const value = parts.slice(1).join('=').trim();
            config[key] = value;
          }
        });

        this.moduleInfo = config;
        this.version = config.version || 'Unknown';
        sessionStorage.setItem('moduleInfo', JSON.stringify(config));
      } else {
        console.warn('无法读取模块配置文件');
        this.moduleInfo = {};
        this.version = 'Unknown';
      }
    } catch (error) {
      console.error('加载模块信息失败:', error);
      this.moduleInfo = {};
      this.version = 'Unknown';
    }

    return this.moduleInfo;
  },

  async getLogCount() {
    try {
      const result = await Core.execCommand(
        `find "${Core.MODULE_PATH}logs/" -type f -name "*.log" | wc -l 2>/dev/null || echo "0"`
      );
      this.logCount = parseInt(result.trim(), 10) || 0;
    } catch (error) {
      console.error('获取日志数量失败:', error);
      this.logCount = 0;
    }

    return this.logCount;
  },

  registerActions() {
    UI.registerPageActions('status', [
      {
        id: 'run-action',
        icon: 'play_arrow',
        title: I18n.translate('RUN_ACTION', '运行Action'),
        onClick: 'runAction'
      }
    ]);
  },

  render() {
    const metrics = this.statusMetrics || this.getEmptyMetrics();

    return `
      <div class="status-page">
        <div class="update-banner-container">${this.renderUpdateBanner()}</div>
        ${this.renderOverviewCard(metrics)}
        ${this.renderVmParameters(metrics)}
        ${this.renderEnabledSwap(metrics)}
        ${this.renderZramMetrics(metrics)}
        ${this.renderSwapIo(metrics)}
      </div>
    `;
  },

  renderOverviewCard(metrics) {
    const memoryPercent = this.clampPercent(metrics.memory.usedPercent);
    const swapPercent = this.clampPercent(metrics.swap.usedPercent);
    const combinedPercent = this.clampPercent(metrics.footer.combinedUsedPercent);
    const usedByMemory = this.formatPercent(metrics.footer.usedPercentByMemory);
    const memoryLevel = this.getUsageLevel(metrics.memory.usedPercent);
    const swapLevel = this.getUsageLevel(metrics.swap.usedPercent);
    const combinedLevel = this.getUsageLevel(metrics.footer.combinedUsedPercent);

    return `
      <section class="status-overview-card">
        <div class="status-overview-body">
          <div class="overview-visual">
            <div class="memory-ring ${combinedLevel}" style="--progress:${combinedPercent};">
              <div class="memory-ring-center">
                <span class="memory-ring-label">${I18n.translate('MEMORY', 'Memory')}</span>
              </div>
            </div>
          </div>

          <div class="overview-details">
            ${this.renderOverviewProgressRow(
              I18n.translate('PHYSICAL_MEMORY', '物理内存'),
              memoryPercent,
              `${this.formatPercent(metrics.memory.usedPercent)} (${this.formatBytes(metrics.memory.used)} / ${this.formatBytes(metrics.memory.total)})`,
              'memory',
              memoryLevel
            )}
            ${this.renderOverviewProgressRow(
              I18n.translate('SWAP_PARTITION', '交换分区'),
              swapPercent,
              `${this.formatPercent(metrics.swap.usedPercent)} (${this.formatBytes(metrics.swap.used)} / ${this.formatBytes(metrics.swap.total)})`,
              'swap',
              swapLevel
            )}

            <div class="overview-footer">
              <div class="overview-footer-item">
                <span class="overview-footer-label">${I18n.translate('USED', 'Used')}</span>
                <strong class="overview-footer-value">${usedByMemory}</strong>
              </div>
              <div class="overview-footer-item">
                <span class="overview-footer-label">${I18n.translate('SWAP_CACHED', 'SwapCached')}</span>
                <strong class="overview-footer-value">${this.formatBytes(metrics.footer.swapCached)}</strong>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
  },

  renderOverviewProgressRow(label, percent, value, type, level) {
    return `
      <div class="overview-progress-row">
        <div class="overview-row-header">
          <span class="overview-row-label">${label}</span>
          <strong class="overview-row-value">${value}</strong>
        </div>
        <div class="overview-progress ${type} ${level}" style="--progress:${percent};">
          <span class="overview-progress-fill"></span>
        </div>
      </div>
    `;
  },

  renderVmParameters(metrics) {
    const rows = metrics.vmParameters
      .map(item => {
        return `
          <div class="detail-row">
            <span class="detail-label">${this.escapeHtml(item.label)}</span>
            <span class="detail-value">${this.escapeHtml(item.value)}</span>
          </div>
        `;
      })
      .join('');

    return `
      <section class="status-section-block">
        <h2 class="section-title">${I18n.translate('VM_PARAMETERS', 'VM 参数')}</h2>
        <div class="metric-card">
          <div class="detail-list">${rows}</div>
        </div>
      </section>
    `;
  },

  renderEnabledSwap(metrics) {
    const hasRows = metrics.swapDevices.length > 0;
    const rows = hasRows
      ? metrics.swapDevices
          .map(device => {
            return `
              <div class="swap-device-item">
                <div class="swap-device-path">${this.escapeHtml(device.path)}</div>
                <div class="swap-device-meta">
                  <div class="swap-device-meta-item">
                    <span class="swap-device-meta-label">${I18n.translate('TYPE', '类型')}</span>
                    <strong class="swap-device-meta-value">${this.escapeHtml(device.type)}</strong>
                  </div>
                  <div class="swap-device-meta-item">
                    <span class="swap-device-meta-label">${I18n.translate('SIZE', '大小')}</span>
                    <strong class="swap-device-meta-value">${this.formatBytes(device.size)}</strong>
                  </div>
                  <div class="swap-device-meta-item">
                    <span class="swap-device-meta-label">${I18n.translate('USED', 'Used')}</span>
                    <strong class="swap-device-meta-value">${this.formatBytes(device.used)}</strong>
                  </div>
                  <div class="swap-device-meta-item">
                    <span class="swap-device-meta-label">${I18n.translate('PRIORITY', '顺序')}</span>
                    <strong class="swap-device-meta-value">${device.priority}</strong>
                  </div>
                </div>
              </div>
            `;
          })
          .join('')
      : `
          <div class="swap-device-empty">${I18n.translate('NO_SWAP_DEVICE', '未检测到已启用的 Swap')}</div>
        `;

    return `
      <section class="status-section-block">
        <h2 class="section-title">${I18n.translate('ENABLED_SWAP', '启用的 Swap')}</h2>
        <div class="metric-card swap-card">
          <div class="swap-device-list">${rows}</div>
        </div>
      </section>
    `;
  },

  renderZramMetrics(metrics) {
    const rows = [
      {
        key: 'rawDataSize',
        label: I18n.translate('RAW_DATA_SIZE', '原始数据大小'),
        value: this.formatBytes(metrics.zram.rawDataSize)
      },
      {
        key: 'compressedSize',
        label: I18n.translate('COMPRESSED_SIZE', '压缩后的大小'),
        value: this.formatBytes(metrics.zram.compressedSize)
      },
      {
        key: 'physicalMemoryUsed',
        label: I18n.translate('PHYSICAL_MEMORY_USED', '物理内存占用'),
        value: this.formatBytes(metrics.zram.physicalMemoryUsed)
      },
      {
        key: 'compressionRatio',
        label: I18n.translate('COMPRESSION_RATIO', '压缩比'),
        value: metrics.zram.compressionRatio
      },
      {
        key: 'backingDevice',
        label: I18n.translate('BACKING_DEVICE', '回写块'),
        value: metrics.zram.backingDevice || '-'
      },
      {
        key: 'totalWrite',
        label: I18n.translate('TOTAL_WRITE', '总写入'),
        value: this.formatBytes(metrics.zram.totalWrite)
      },
      {
        key: 'totalRead',
        label: I18n.translate('TOTAL_READ', '总读取'),
        value: this.formatBytes(metrics.zram.totalRead)
      },
      {
        key: 'currentResidentDisk',
        label: I18n.translate('CURRENT_RESIDENT_DISK', '当前驻留磁盘量'),
        value: this.formatBytes(metrics.zram.currentResidentDisk)
      }
    ];

    const html = rows
      .map(row => {
        return `
          <div class="detail-row">
            <span class="detail-label">${row.label}</span>
            <span class="detail-value">${this.escapeHtml(row.value)}</span>
          </div>
        `;
      })
      .join('');

    return `
      <section class="status-section-block">
        <h2 class="section-title">${I18n.translate('ZRAM_STATUS_EXTENDED_MEMORY', 'Zram 状态 / 扩展内存')}</h2>
        <div class="metric-card">
          <div class="detail-list">${html}</div>
        </div>
      </section>
    `;
  },

  renderSwapIo(metrics) {
    return `
      <section class="status-section-block">
        <h2 class="section-title">${I18n.translate('SWAP_IO', 'SWAP IO')}</h2>
        <div class="metric-card">
          <div class="detail-list">
            <div class="detail-row">
              <span class="detail-label">${I18n.translate('SWAP_IN', '从 SWAP 读入 (pswpin)')}</span>
              <span class="detail-value">${this.formatBytes(metrics.swapIo.pswpin)}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">${I18n.translate('SWAP_OUT', '写入 SWAP (pswpout)')}</span>
              <span class="detail-value">${this.formatBytes(metrics.swapIo.pswpout)}</span>
            </div>
          </div>
        </div>
      </section>
    `;
  },

  async refreshStatus(showToast = false) {
    try {
      const oldStatus = this.moduleStatus;
      const oldMetrics = JSON.stringify(this.statusMetrics || {});

      await Promise.all([this.loadModuleStatus(), this.loadStatusMetrics()]);

      const newMetrics = JSON.stringify(this.statusMetrics || {});
      if (oldStatus !== this.moduleStatus || oldMetrics !== newMetrics) {
        const statusPage = document.querySelector('.status-page');
        if (statusPage) {
          statusPage.outerHTML = this.render();
          this.afterRender();
        }
      }

      if (showToast) {
        Core.showToast(I18n.translate('STATUS_REFRESHED', '状态已刷新'));
      }
    } catch (error) {
      console.error('刷新状态失败:', error);
      if (showToast) {
        Core.showToast(I18n.translate('STATUS_REFRESH_ERROR', '刷新状态失败'), 'error');
      }
    }
  },

  afterRender() {
    const actionBtn = document.getElementById('run-action');

    if (actionBtn && !actionBtn.dataset.bound) {
      actionBtn.addEventListener('click', () => {
        this.runAction();
      });
      actionBtn.dataset.bound = 'true';
    }
  },

  async runAction() {
    try {
      const outputContainer = document.createElement('div');
      outputContainer.className = 'card action-output-container';
      outputContainer.innerHTML = `
        <div class="action-output-header">
          <h3>${I18n.translate('ACTION_OUTPUT', 'Action输出')}</h3>
          <button class="icon-button close-output" title="${I18n.translate('CLOSE', '关闭')}">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
        <div class="action-output-content"></div>
      `;

      document.body.appendChild(outputContainer);
      const outputContent = outputContainer.querySelector('.action-output-content');
      const closeButton = outputContainer.querySelector('.close-output');

      closeButton.addEventListener('click', () => {
        outputContainer.remove();
      });

      Core.showToast(I18n.translate('RUNNING_ACTION', '正在运行Action...'));
      outputContent.textContent = I18n.translate('ACTION_STARTING', '正在启动Action...\n');

      await Core.execCommand(`sh ${Core.MODULE_PATH}action.sh`, {
        onStdout: data => {
          outputContent.textContent += `${data}\n`;
          outputContent.scrollTop = outputContent.scrollHeight;
        },
        onStderr: data => {
          const errorText = document.createElement('span');
          errorText.className = 'error';
          errorText.textContent = `[ERROR] ${data}\n`;
          outputContent.appendChild(errorText);
          outputContent.scrollTop = outputContent.scrollHeight;
        }
      });

      outputContent.textContent += `\n${I18n.translate('ACTION_COMPLETED', 'Action运行完成')}`;
      Core.showToast(I18n.translate('ACTION_COMPLETED', 'Action运行完成'));
    } catch (error) {
      console.error('运行Action失败:', error);
      Core.showToast(I18n.translate('ACTION_ERROR', '运行Action失败'), 'error');
    }
  },

  async loadModuleStatus() {
    try {
      const statusPath = `${Core.MODULE_PATH}status.txt`;
      const fileExistsResult = await Core.execCommand(`[ -f "${statusPath}" ] && echo "true" || echo "false"`);

      if (fileExistsResult.trim() !== 'true') {
        this.moduleStatus = 'UNKNOWN';
        return this.moduleStatus;
      }

      const status = await Core.execCommand(`cat "${statusPath}"`);
      if (!status) {
        this.moduleStatus = 'UNKNOWN';
        return this.moduleStatus;
      }

      const isRunning = await this.isServiceRunning();
      if (status.trim() === 'RUNNING' && !isRunning) {
        this.moduleStatus = 'STOPPED';
        return this.moduleStatus;
      }

      this.moduleStatus = status.trim() || 'UNKNOWN';
    } catch (error) {
      console.error('获取模块状态失败:', error);
      this.moduleStatus = 'ERROR';
    }

    return this.moduleStatus;
  },

  async isServiceRunning() {
    try {
      const result = await Core.execCommand(`ps -ef | grep "${Core.MODULE_PATH}service.sh" | grep -v grep | wc -l`);
      return parseInt(result.trim(), 10) > 0;
    } catch (error) {
      console.error('检查服务运行状态失败:', error);
      return false;
    }
  },

  async safeExec(command) {
    try {
      const result = await Core.execCommand(command);
      return typeof result === 'string' ? result : '';
    } catch (_error) {
      return '';
    }
  },

  async loadStatusMetrics() {
    try {
      const [
        meminfoRaw,
        vmstatRaw,
        swapsRaw,
        mmStatRaw,
        bdStatRaw,
        backingDevRaw,
        swappinessRaw,
        watermarkRaw,
        zramDisksizeRaw
      ] = await Promise.all([
        this.safeExec('cat /proc/meminfo 2>/dev/null'),
        this.safeExec('cat /proc/vmstat 2>/dev/null'),
        this.safeExec('cat /proc/swaps 2>/dev/null'),
        this.safeExec('cat /sys/block/zram0/mm_stat 2>/dev/null'),
        this.safeExec('cat /sys/block/zram0/bd_stat 2>/dev/null'),
        this.safeExec('cat /sys/block/zram0/backing_dev 2>/dev/null'),
        this.safeExec('cat /proc/sys/vm/swappiness 2>/dev/null'),
        this.safeExec('cat /proc/sys/vm/watermark_scale_factor 2>/dev/null'),
        this.safeExec('cat /sys/block/zram0/disksize 2>/dev/null')
      ]);

      const meminfo = this.parseColonMap(meminfoRaw);
      const vmstat = this.parseWhitespaceMap(vmstatRaw);
      const swapDevices = this.parseSwapDevices(swapsRaw);
      const mmStat = this.parseNumericList(mmStatRaw);
      const bdStat = this.parseNumericList(bdStatRaw);

      const memoryTotal = this.kibToBytes(meminfo.MemTotal);
      const memoryAvailable = this.kibToBytes(
        meminfo.MemAvailable ||
          Number(meminfo.MemFree || 0) + Number(meminfo.Cached || 0) + Number(meminfo.Buffers || 0)
      );
      const memoryUsed = Math.max(memoryTotal - memoryAvailable, 0);
      const memoryUsedPercent = memoryTotal > 0 ? (memoryUsed / memoryTotal) * 100 : 0;

      const swapTotal = this.kibToBytes(meminfo.SwapTotal);
      const swapFree = this.kibToBytes(meminfo.SwapFree);
      const swapUsed = Math.max(swapTotal - swapFree, 0);
      const swapUsedPercent = swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0;
      const swapCached = this.kibToBytes(meminfo.SwapCached);

      const zramStats = {
        rawDataSize: Number(mmStat[0] || 0),
        compressedSize: Number(mmStat[1] || 0),
        physicalMemoryUsed: Number(mmStat[2] || 0),
        compressionRatio: this.formatRatio(Number(mmStat[0] || 0), Number(mmStat[1] || 0)),
        backingDevice: this.normalizeText(backingDevRaw, '-'),
        totalRead: Number(bdStat[1] || 0) * PAGE_SIZE,
        totalWrite: Number(bdStat[2] || 0) * PAGE_SIZE,
        currentResidentDisk: Number(bdStat[0] || 0) * PAGE_SIZE
      };
      const zramSwapDevices = swapDevices.filter(device => /zram0$/i.test(device.path));
      const zramTotal =
        Number(String(zramDisksizeRaw || '').trim()) ||
        zramSwapDevices.reduce((sum, device) => sum + device.size, 0) ||
        swapTotal;
      const zramUsed = zramSwapDevices.reduce((sum, device) => sum + device.used, 0) || swapUsed;
      const combinedTotal = memoryTotal + zramTotal;
      const combinedUsed = memoryUsed + zramUsed;
      const combinedUsedPercent = combinedTotal > 0 ? (combinedUsed / combinedTotal) * 100 : 0;
      const usedPercentByMemory = memoryTotal > 0 ? (combinedUsed / memoryTotal) * 100 : 0;

      this.statusMetrics = {
        memory: {
          total: memoryTotal,
          used: memoryUsed,
          usedPercent: memoryUsedPercent
        },
        swap: {
          total: swapTotal,
          used: swapUsed,
          usedPercent: swapUsedPercent,
          cached: swapCached
        },
        footer: {
          combinedUsedPercent,
          combinedUsed,
          combinedTotal,
          usedPercentByMemory,
          swapCached
        },
        vmParameters: [
          {
            label: 'swappiness',
            value: this.normalizeText(swappinessRaw, '--')
          },
          {
            label: 'watermark_scale_factor',
            value: this.normalizeText(watermarkRaw, '--')
          }
        ],
        swapDevices,
        zram: zramStats,
        swapIo: {
          pswpin: Number(vmstat.pswpin || 0) * PAGE_SIZE,
          pswpout: Number(vmstat.pswpout || 0) * PAGE_SIZE
        }
      };

      this.lastUpdatedAt = new Date().toISOString();
    } catch (error) {
      console.error('加载状态数据失败:', error);
      this.statusMetrics = this.getEmptyMetrics();
      this.lastUpdatedAt = new Date().toISOString();
    }

    return this.statusMetrics;
  },

  parseColonMap(text) {
    const result = {};

    text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .forEach(line => {
        const match = line.match(/^([^:]+):\s+([0-9]+)/);
        if (match) {
          result[match[1]] = Number(match[2]);
        }
      });

    return result;
  },

  parseWhitespaceMap(text) {
    const result = {};

    text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .forEach(line => {
        const parts = line.split(/\s+/);
        if (parts.length >= 2 && /^-?\d+$/.test(parts[1])) {
          result[parts[0]] = Number(parts[1]);
        }
      });

    return result;
  },

  parseNumericList(text) {
    return text
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(item => Number(item));
  },

  parseSwapDevices(text) {
    const lines = text
      .trim()
      .split('\n')
      .slice(1)
      .map(line => line.trim())
      .filter(Boolean);

    return lines.map(line => {
      const parts = line.split(/\s+/);

      return {
        path: parts[0] || '-',
        type: parts[1] || '-',
        size: this.kibToBytes(parts[2]),
        used: this.kibToBytes(parts[3]),
        priority: parts[4] || '-'
      };
    });
  },

  normalizeText(value, fallback = '--') {
    const normalized = String(value || '')
      .trim()
      .replace(/^\/dev\/block\/\(null\)$/i, '')
      .replace(/^none$/i, '');

    return normalized || fallback;
  },

  kibToBytes(value) {
    return (Number(value) || 0) * 1024;
  },

  clampPercent(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
  },

  getUsageLevel(value) {
    if (!Number.isFinite(value)) return 'normal';
    if (value >= 90) return 'danger';
    if (value >= 80) return 'warning';
    return 'normal';
  },

  formatPercent(value) {
    if (!Number.isFinite(value)) return '0%';
    const rounded = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(0) : value.toFixed(1);
    return `${rounded}%`;
  },

  formatRatio(raw, compressed) {
    if (!raw || !compressed) return '--';
    return `${(raw / compressed).toFixed(1)}:1`;
  },

  formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value <= 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    const precision = size >= 100 || unitIndex === 0 ? 0 : 1;
    return `${size.toFixed(precision)} ${units[unitIndex]}`;
  },

  escapeHtml(text) {
    const value = String(text ?? '');
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };

    return value.replace(/[&<>"']/g, char => entities[char]);
  },

  getStatusI18nKey() {
    switch (this.moduleStatus) {
      case 'RUNNING':
        return 'RUNNING';
      case 'STOPPED':
        return 'STOPPED';
      case 'ERROR':
        return 'ERROR';
      case 'PAUSED':
        return 'PAUSED';
      case 'NORMAL_EXIT':
        return 'NORMAL_EXIT';
      default:
        return 'UNKNOWN';
    }
  },

  getStatusClass() {
    switch (this.moduleStatus) {
      case 'RUNNING':
        return 'status-running';
      case 'STOPPED':
        return 'status-stopped';
      case 'ERROR':
        return 'status-error';
      case 'PAUSED':
        return 'status-paused';
      case 'NORMAL_EXIT':
        return 'status-normal-exit';
      default:
        return 'status-unknown';
    }
  },

  getStatusText() {
    switch (this.moduleStatus) {
      case 'RUNNING':
        return I18n.translate('RUNNING', '运行中');
      case 'STOPPED':
        return I18n.translate('STOPPED', '已停止');
      case 'ERROR':
        return I18n.translate('ERROR', '错误');
      case 'PAUSED':
        return I18n.translate('PAUSED', '已暂停');
      case 'NORMAL_EXIT':
        return I18n.translate('NORMAL_EXIT', '正常退出');
      default:
        return I18n.translate('UNKNOWN', '未知');
    }
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshTimer = setInterval(() => {
      this.refreshStatus();
    }, STATUS_AUTO_REFRESH_MS);
  },

  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  },

  onLanguageChanged() {
    const statusPage = document.querySelector('.status-page');
    if (statusPage) {
      statusPage.outerHTML = this.render();
      this.afterRender();
    }
  },

  onDeactivate() {
    if (this.boundLanguageChangeHandler) {
      I18n.unregisterLanguageChangeHandler(this.boundLanguageChangeHandler);
    }
    this.stopAutoRefresh();
    UI.clearPageActions();
  },

  onActivate() {
    console.log('状态页面已激活');
    if (!this.statusMetrics) {
      this.refreshStatus();
    }
    this.startAutoRefresh();
  }
};

window.StatusPage = StatusPage;
