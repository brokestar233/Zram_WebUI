/**
 * zram WebUI 设置页面模块
 * 管理模块配置设置
 */

const SettingsPage = {
  // 核心数据
  settings: {},
  settingsBackup: {},
  hasUnsavedChanges: false,
  tempFormState: {},

  // 元数据
  excludedSettings: [],
  settingsDescriptions: {},
  settingsOptions: {},

  // 状态标志
  isLoading: false,
  isCancelled: false,

  // Feature 标志
  featureFlags: {
    support_auto_size: false,
    support_zram_recompressd: false,
    support_zstd_level: false
  },

  // 动态算法列表
  availableAlgorithms: [],
  currentAlgorithm: '',
  lastManualSizeValue: 8,

  // 键盘处理定时器
  blurTimer: null,
  settingsChangeHandler: null,

  // 预加载数据
  async preloadData() {
    try {
      const [settingsData, settingsMetadata] = await Promise.all([
        this.loadSettingsData(),
        this.loadSettingsMetadata()
      ]);
      return { settingsData, settingsMetadata };
    } catch (error) {
      console.error('预加载设置数据失败:', error);
      return null;
    }
  },

  // 使用预加载的数据初始化
  async init(preloadedData) {
    try {
      this.isCancelled = false;
      this.registerActions();

      // 注册语言切换处理器
      I18n.registerLanguageChangeHandler(this.onLanguageChanged.bind(this));

      // 如果有临时表单状态且有未保存的更改，优先使用临时状态
      if (this.tempFormState && Object.keys(this.tempFormState).length > 0 && this.hasUnsavedChanges) {
        if (!this.settingsDescriptions) {
          await this.loadSettingsMetadata();
        }
        this.settings = { ...this.tempFormState };
        return true;
      }

      this.hasUnsavedChanges = false;
      // 使用预加载的数据或重新加载
      if (preloadedData) {
        this.settings = preloadedData.settingsData;
        this.settingsDescriptions = preloadedData.settingsMetadata.descriptions;
        this.settingsOptions = preloadedData.settingsMetadata.options;
        this.excludedSettings = preloadedData.settingsMetadata.excluded;
      } else {
        await this.loadSettingsData();
        await this.loadSettingsMetadata();
      }

      // 创建设置备份
      this.createSettingsBackup();

      return true;
    } catch (error) {
      console.error('初始化设置页面失败:', error);
      return false;
    }
  },

  // 添加语言切换处理方法
  onLanguageChanged() {
    const settingsContainer = document.getElementById('settings-container');
    if (settingsContainer) {
      settingsContainer.innerHTML = this.renderSettings();
      // 使用 requestAnimationFrame 延迟 afterRender 的执行，确保在浏览器完成 DOM 更新后执行
      requestAnimationFrame(() => {
        this.afterRenderSetup();
      });
    }
  },

  // 修改 registerActions 方法，添加禁用状态控制
  registerActions() {
    UI.registerPageActions('settings', [
      {
        id: 'save-settings',
        icon: 'save',
        title: I18n.translate('SAVE_SETTINGS', '保存设置'),
        onClick: 'saveSettings'
      },
      {
        id: 'restore-settings',
        icon: 'restore',
        title: I18n.translate('RESTORE_SETTINGS', '还原设置'),
        onClick: 'restoreSettings'
      }
    ]);
  },

  // 创建设置备份
  createSettingsBackup() {
    // 创建深拷贝，但排除内部使用的属性
    const cleanSettings = {};
    for (const key in this.settings) {
      if (!key.startsWith('_')) {
        cleanSettings[key] = this.settings[key];
      }
    }
    this.settingsBackup = JSON.parse(JSON.stringify(cleanSettings));
  },

  // 渲染页面
  render() {
    return `
      <div class="settings-content">
        <div id="settings-container">
          <div class="loading-placeholder">
            ${I18n.translate('LOADING_SETTINGS', '正在加载设置...')}
          </div>
        </div>
        <div id="settings-loading" class="loading-overlay">
          <div class="loading-spinner"></div>
        </div>
      </div>
    `;
  },

  isExcluded(key) {
    return this.excludedSettings.some(pattern => {
      // 如果模式包含通配符
      if (pattern.includes('*')) {
        // 将通配符转换为正则表达式
        const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
        return regex.test(key);
      }
      // 无通配符时直接比较
      return pattern === key;
    });
  },

  // 渲染设置项
  renderSettings() {
    if (!this.settings || Object.keys(this.settings).filter(key => !key.startsWith('_')).length === 0) {
      this.settings = this.getTestSettings();
      this.createSettingsBackup();
    }

    let html = '';

    // 修改排序和过滤逻辑
    const sortedSettings = Object.keys(this.settings)
      .filter(key => {
        // 跳过内部属性
        if (key.startsWith('_')) return false;
        // 检查是否匹配任何排除规则
        if (this.isExcluded(key)) return false;
        return !this.isFeatureHidden(key);
      })
      .sort();

    for (const key of sortedSettings) {
      const value = this.settings[key];
      const description = this.getSettingDescription(key);

      html += `
        <div class="setting-item" data-key="${key}">
          ${this.renderSettingControl(key, value, description)}
        </div>
      `;
    }

    return html;
  },

  // 获取测试设置数据 - 简化版
  getTestSettings() {
    return {
      // 布尔值设置
      ENABLE_FEATURE_A: true,
      ENABLE_FEATURE_B: false,
      // 数字设置
      SERVER_PORT: 8080,
      // 文本设置
      API_KEY: 'test_api_key_12345',
      // 选择项设置
      LOG_LEVEL: 'info',
      THEME: 'auto',
      // 数字滑条设置
      VOLUME: 75,
      BRIGHTNESS: 80,
      // 添加测试排除项
      APP_TEST_1: 'should_be_excluded',
      APP_TEST_2: 'should_be_excluded',
      SYSTEM_TEMP: 'should_be_excluded',
      ACTION_TEST: 'should_be_excluded'
    };
  },

  // 检查控件是否被 feature flag 禁用
  isFeatureDisabled(key) {
    // size 的 auto 选项需要 support_auto_size
    // 此方法返回是否完全禁用控件
    if (key === 'recompressd_algorithm1' || key === 'recompressd_algorithm2' || key === 'recompressd_algorithm3') {
      return !this.featureFlags.support_zram_recompressd;
    }
    if (key === 'zstd_compression_level') {
      return !this.featureFlags.support_zstd_level;
    }
    return false;
  },

  isFeatureHidden(key) {
    if (key === 'recompressd_algorithm1' || key === 'recompressd_algorithm2' || key === 'recompressd_algorithm3') {
      return !this.featureFlags.support_zram_recompressd;
    }
    if (key === 'zstd_compression_level') {
      return !this.featureFlags.support_zstd_level;
    }
    return false;
  },

  // 获取 feature 禁用提示
  getFeatureDisabledHint(key) {
    if (key === 'recompressd_algorithm1' || key === 'recompressd_algorithm2' || key === 'recompressd_algorithm3') {
      return I18n.translate('FEATURE_NOT_SUPPORTED_RECOMPRESSD', '设备不支持重压缩功能');
    }
    if (key === 'zstd_compression_level') {
      return I18n.translate('FEATURE_NOT_SUPPORTED_ZSTD_LEVEL', '设备不支持 ZSTD 压缩等级设置');
    }
    return '';
  },

  // 渲染设置控件
  renderSettingControl(key, value, description) {
    // 检查 feature flag 禁用
    const disabled = this.isFeatureDisabled(key);
    const disabledHint = disabled ? this.getFeatureDisabledHint(key) : '';

    // 特殊控件：算法下拉框（动态获取）
    if (key === 'algorithm') {
      return this.renderAlgorithmSelect(key, value, description, disabled);
    }

    // 特殊控件：重压缩算法下拉框（动态获取 + 约束）
    if (key === 'recompressd_algorithm1' || key === 'recompressd_algorithm2' || key === 'recompressd_algorithm3') {
      return this.renderRecompressdSelect(key, value, description, disabled, disabledHint);
    }

    // 特殊控件：ZSTD 压缩等级（纯滑块）
    if (key === 'zstd_compression_level') {
      return this.renderZstdSlider(key, value, description, disabled, disabledHint);
    }

    // 特殊控件：写回块大小（滑块 + 悬浮数字）
    if (key === 'writeback_block_size') {
      return this.renderSliderInputCombo(key, value, description, {
        min: 0,
        max: 64,
        step: 1,
        unit: '',
        disabled
      });
    }

    // 特殊控件：ZRAM 大小（滑块 + 悬浮数字）
    if (key === 'size') {
      return this.renderSizeControl(key, value, description, disabled);
    }

    // 检查是否有预定义选项
    if (this.settingsOptions[key]) {
      return this.renderSelectControl(key, value, description, disabled);
    }

    // 根据值类型渲染不同控件
    if (typeof value === 'boolean') {
      return this.renderBooleanControl(key, value, description, disabled);
    }
    if (typeof value === 'number') {
      return this.renderNumberControl(key, value, description, disabled);
    }
    return this.renderTextControl(key, value, description, disabled);
  },

  // 渲染算法下拉框（动态获取选项）
  renderAlgorithmSelect(key, value, description, disabled) {
    const algorithms = this.availableAlgorithms;
    if (algorithms.length === 0) {
      return this.renderTextControl(key, value, description, disabled);
    }

    let optionsHtml = '';
    for (const algo of algorithms) {
      const selectedClass = algo === value ? ' selected' : '';
      optionsHtml += `
        <div class="select-option${selectedClass}" data-value="${algo}" tabindex="0">
          ${algo}
        </div>
      `;
    }

    const disabledAttr = disabled ? ' disabled' : '';
    const disabledClass = disabled ? ' disabled' : '';

    return `
      <label class="control-wrapper${disabledClass}">
        <div class="control-label">${description}</div>
        <div class="custom-select" id="setting-${key}" data-value="${value}"${disabledAttr}>
          <div class="select-selected">
            <span class="select-text">${value}</span>
            <span class="select-arrow material-symbols-rounded">arrow_drop_down</span>
          </div>
          <div class="select-items">
            ${optionsHtml}
          </div>
        </div>
      </label>
    `;
  },

  // 渲染重压缩算法下拉框（动态 + 约束）
  renderRecompressdSelect(key, value, description, disabled, disabledHint) {
    const algorithms = this.availableAlgorithms;
    const emptyLabel = I18n.translate('NOT_SET', '未设置');

    // 判断约束：不能跳
    const keyNum = Number.parseInt(key.replace('recompressd_algorithm', ''), 10);
    let constrainedDisabled = disabled;
    if (keyNum > 1) {
      const prevKey = `recompressd_algorithm${keyNum - 1}`;
      const prevValue = this.settings[prevKey];
      if (!prevValue || prevValue === '') {
        constrainedDisabled = true;
      }
    }

    // 收集需要排除的算法：其他重压缩算法已选值 + 主算法
    const excludedAlgorithms = new Set();
    // 排除主算法
    if (this.currentAlgorithm) {
      excludedAlgorithms.add(this.currentAlgorithm);
    }
    // 排除其他重压缩算法已选值（不排除自身，因为自身当前值需要保留可选）
    for (let i = 1; i <= 3; i++) {
      const k = `recompressd_algorithm${i}`;
      if (k !== key) {
        const v = this.settings[k];
        if (v && v !== '') {
          excludedAlgorithms.add(v);
        }
      }
    }

    let optionsHtml = `<div class="select-option${value === '' ? ' selected' : ''}" data-value="" tabindex="0">${emptyLabel}</div>`;
    for (const algo of algorithms) {
      // 如果算法已被排除（其他重压缩算法选中或主算法），且不是自身当前值，直接跳过不渲染
      if (excludedAlgorithms.has(algo) && algo !== value) {
        continue;
      }
      const selectedClass = algo === value ? ' selected' : '';
      optionsHtml += `
        <div class="select-option${selectedClass}" data-value="${algo}" tabindex="0">
          ${algo}
        </div>
      `;
    }

    const isDisabled = constrainedDisabled;
    const disabledAttr = isDisabled ? ' disabled' : '';
    const disabledClass = isDisabled ? ' disabled' : '';
    const hintHtml = disabledHint ? `<div class="feature-disabled-hint">${disabledHint}</div>` : '';

    const currentValue = value || '';
    const displayLabel = currentValue || emptyLabel;

    return `
      <label class="control-wrapper${disabledClass}">
        <div class="control-label">${description}</div>
        <div class="custom-select" id="setting-${key}" data-value="${currentValue}"${disabledAttr}>
          <div class="select-selected">
            <span class="select-text">${displayLabel}</span>
            <span class="select-arrow material-symbols-rounded">arrow_drop_down</span>
          </div>
          <div class="select-items">
            ${optionsHtml}
          </div>
        </div>
      </label>
      ${hintHtml}
    `;
  },

  // 渲染 ZSTD 压缩等级纯滑块
  renderZstdSlider(key, value, description, disabled, disabledHint) {
    const currentValue = typeof value === 'number' ? value : 9;
    const disabledAttr = disabled ? ' disabled' : '';
    const disabledClass = disabled ? ' disabled' : '';
    const hintHtml = disabledHint ? `<div class="feature-disabled-hint">${disabledHint}</div>` : '';

    return `
      <label class="control-wrapper slider-only-wrapper${disabledClass}">
        <div class="control-label">${description}</div>
        <div class="slider-only-container slider-bubble-container">
          <input type="range" id="setting-${key}" value="${currentValue}"
            min="1" max="22" step="1"${disabledAttr}>
          <output class="slider-bubble" for="setting-${key}">${currentValue}</output>
        </div>
      </label>
      ${hintHtml}
    `;
  },

  // 渲染滑块 + 悬浮数字组合控件
  renderSliderInputCombo(key, value, description, options) {
    const { min, max, step, unit, disabled } = options;
    const currentValue = typeof value === 'number' ? value : 0;
    const disabledAttr = disabled ? ' disabled' : '';
    const disabledClass = disabled ? ' disabled' : '';

    return `
      <label class="control-wrapper slider-input-wrapper${disabledClass}">
        <div class="control-label">${description}</div>
        <div class="slider-input-container slider-bubble-container">
          <input type="range" id="setting-${key}" value="${currentValue}"
            min="${min}" max="${max}" step="${step}"${disabledAttr}>
          <output class="slider-bubble" for="setting-${key}">${currentValue}</output>
          ${unit ? `<span class="slider-unit">${unit}</span>` : ''}
        </div>
      </label>
    `;
  },

  // 渲染 ZRAM 大小控件（特殊格式处理）
  renderSizeControl(key, value, description, disabled) {
    const currentValue = String(value).trim();
    const disabledAttr = disabled ? ' disabled' : '';
    const disabledClass = disabled ? ' disabled' : '';

    // auto 选项是否可用取决于 feature flag
    const autoSupported = this.featureFlags.support_auto_size;
    const isStoredAutoMode = currentValue.toLowerCase() === 'auto';
    const isAutoMode = autoSupported && isStoredAutoMode;

    // 解析数值用于滑块显示
    const numericValue = this.parseSizeToSlider(currentValue);
    const manualValue = this.normalizeManualSizeValue(
      isStoredAutoMode ? this.lastManualSizeValue || 8 : numericValue || this.lastManualSizeValue || 8
    );

    if (!isAutoMode) {
      this.lastManualSizeValue = manualValue;
    }

    const autoSwitchDisabledAttr = disabled || !autoSupported ? ' disabled' : '';
    const autoRowHtml = autoSupported
      ? `
          <div class="size-auto-row">
            <div class="size-auto-copy">
              <div class="size-auto-title">${I18n.translate('AUTO_SIZE', '自动大小')}</div>
              <div class="size-auto-description">${I18n.translate('AUTO_SIZE_DESCRIPTION', '启用后使用 auto 并隐藏手动滑块')}</div>
            </div>
            <div class="switches size-auto-switch">
              <label>
                <span>${I18n.translate('AUTO_SIZE', '自动大小')}</span>
                <input type="checkbox" id="setting-${key}-auto"${isAutoMode ? ' checked' : ''}${autoSwitchDisabledAttr}>
              </label>
            </div>
          </div>
        `
      : '';

    return `
      <div class="control-wrapper size-control-wrapper${disabledClass}${isAutoMode ? ' auto-active' : ''}">
        <div class="control-label">${description}</div>
        <input type="hidden" id="setting-${key}" value="${this.escapeHtml(currentValue)}">
        <div class="size-control-surface">
          ${autoRowHtml}
          <div class="size-slider-section slider-bubble-container" id="setting-${key}-slider-section" data-manual-value="${manualValue}">
            <input type="range" id="setting-${key}-range" value="${manualValue}"
              min="1" max="32" step="1"${disabledAttr}>
            <output class="slider-bubble" for="setting-${key}-range">${manualValue}</output>
          </div>
        </div>
      </div>
    `;
  },

  // 将 size 字符串转为滑块数值（用于显示）
  parseSizeToSlider(value) {
    const str = String(value).toLowerCase().trim();
    if (str === 'auto') return 0;
    if (str.endsWith('g')) {
      const num = Number.parseFloat(str);
      return Number.isNaN(num) ? 0 : Math.min(num, 32);
    }
    if (str.endsWith('m')) {
      const num = Number.parseFloat(str);
      return Number.isNaN(num) ? 0 : Math.min(num / 1024, 32);
    }
    // 纯字节
    const num = Number.parseFloat(str);
    if (!Number.isNaN(num)) {
      const gb = num / (1024 * 1024 * 1024);
      return Math.min(Math.round(gb), 32);
    }
    return 0;
  },

  // 将滑块数值转为 size 字符串
  sliderToSizeString(sliderValue) {
    return `${this.normalizeManualSizeValue(sliderValue)}G`;
  },

  normalizeManualSizeValue(value) {
    const numericValue = Math.round(Number(value));
    if (Number.isNaN(numericValue)) return 8;
    return Math.min(Math.max(numericValue, 1), 32);
  },

  // 渲染布尔值控件
  renderBooleanControl(key, value, description, disabled = false) {
    const disabledAttr = disabled ? ' disabled' : '';
    return `
      <div class="switches">
        <label>
          <span>${description}</span>
          <input type="checkbox" id="setting-${key}" ${value ? 'checked' : ''}${disabledAttr}>
        </label>
      </div>
    `;
  },

  // 渲染数字控件
  renderNumberControl(key, value, description, disabled = false) {
    const disabledAttr = disabled ? ' disabled' : '';
    const disabledClass = disabled ? ' disabled' : '';
    return `
      <label class="control-wrapper${disabledClass}">
        <div class="control-label">${description}</div>
        <input type="number" id="setting-${key}" value="${value}" class="md3-input"${disabledAttr}>
      </label>
    `;
  },

  // 渲染文本控件
  renderTextControl(key, value, description, disabled = false) {
    // 确保值是字符串并进行HTML转义
    const safeValue = typeof value === 'string' ? this.escapeHtml(value) : String(value);
    const disabledAttr = disabled ? ' disabled' : '';
    const disabledClass = disabled ? ' disabled' : '';
    return `
      <label class="control-wrapper${disabledClass}">
        <div class="control-label">${description}</div>
        <input type="text" id="setting-${key}" value="${safeValue}" class="md3-input"${disabledAttr}>
      </label>
    `;
  },

  // HTML转义函数，防止XSS
  escapeHtml(text) {
    const entities = {
      '\x26': '\x26amp;',
      '\x3c': '\x26lt;',
      '\x3e': '\x26gt;',
      '\x22': '\x26quot;',
      '\x27': '\x26#039;'
    };
    return text.replace(/[&<>"']/g, ch => entities[ch]);
  },

  // 渲染选择控件
  renderSelectControl(key, value, description, disabled = false) {
    const options = this.settingsOptions[key]?.options || [];
    if (options.length === 0) {
      return this.renderTextControl(key, value, description, disabled);
    }

    // 生成选项列表HTML
    let optionsHtml = '';
    for (const option of options) {
      const optionValue = option.value;
      // 获取当前语言的标签，如果没有则使用值本身
      const label = option.label ? option.label[I18n.currentLang] || option.label.en || optionValue : optionValue;
      // 检查 auto 选项是否需要禁用
      const isAutoDisabled = key === 'size' && optionValue === 'auto' && !this.featureFlags.support_auto_size;
      const disabledAttr = isAutoDisabled ? ' data-disabled="true"' : '';
      const disabledClass = isAutoDisabled ? ' disabled' : '';
      // 添加选中状态的class
      const selectedClass = optionValue === value ? ' selected' : '';
      optionsHtml += `
        <div class="select-option${selectedClass}${disabledClass}" data-value="${optionValue}" tabindex="0"${disabledAttr}>
          ${label}
        </div>
      `;
    }

    // 获取当前选中项的标签
    const currentOption = options.find(opt => opt.value === value);
    const currentLabel = currentOption
      ? currentOption.label[I18n.currentLang] || currentOption.label.en || currentOption.value
      : value;

    const disabledAttr = disabled ? ' disabled' : '';
    const disabledClass = disabled ? ' disabled' : '';

    return `
      <label class="control-wrapper${disabledClass}">
        <div class="control-label">${description}</div>
        <div class="custom-select" id="setting-${key}" data-value="${value}"${disabledAttr}>
          <div class="select-selected">
            <span class="select-text">${currentLabel}</span>
            <span class="select-arrow material-symbols-rounded">arrow_drop_down</span>
          </div>
          <div class="select-items">
            ${optionsHtml}
          </div>
        </div>
      </label>
    `;
  },

  // 获取设置描述
  getSettingDescription(key) {
    if (this.settingsDescriptions[key]) {
      // 获取当前语言的描述，如果没有则使用英文描述
      return this.settingsDescriptions[key][I18n.currentLang] || this.settingsDescriptions[key].en || key;
    }
    return key;
  },

  // 加载设置数据
  async loadSettingsData() {
    try {
      this.showLoading();

      // 如果已经有缓存的设置数据,直接使用
      if (this.settings && Object.keys(this.settings).filter(key => !key.startsWith('_')).length > 0) {
        return;
      }

      const configPath = `${Core.MODULE_PATH}module_settings/config.sh`;

      // 检查是否已取消
      if (this.isCancelled) return;

      // 添加超时控制
      const configContent = await Promise.race([
        Core.execCommand(`cat "${configPath}"`),
        new Promise((_, reject) => setTimeout(() => reject(new Error('加载超时')), 5000))
      ]);

      // 再次检查是否已取消
      if (this.isCancelled) return;

      if (!configContent) {
        console.warn('配置文件为空或不存在');
        return;
      }

      this.settings = this.parseConfigFile(configContent);
    } catch (error) {
      console.error('加载设置数据失败:', error);
      Core.showToast(I18n.translate('SETTINGS_LOAD_ERROR', '加载设置失败'), 'error');
    } finally {
      this.hideLoading();
    }
  },

  // 解析配置文件
  parseConfigFile(content) {
    const settings = {};
    const lines = content.split('\n');

    // 字段列表：始终作为字符串处理，不转换为 Number
    const stringFields = new Set(['size']);

    // 存储原始配置信息，用于保存时恢复格式
    settings._configInfo = {
      lines: lines,
      formats: {}
    };

    for (const line of lines) {
      // 跳过空行
      if (line.trim() === '') continue;

      // 提取注释之前的实际内容
      const commentIndex = line.indexOf('#');
      const effectiveLine = commentIndex !== -1 ? line.substring(0, commentIndex) : line;
      const comment = commentIndex !== -1 ? line.substring(commentIndex) : '';
      const commentSpacing = commentIndex !== -1 ? line.substring(0, commentIndex).match(/\s*$/)[0] : '';

      // 如果去除注释后是空行则跳过
      if (effectiveLine.trim() === '') continue;

      // 匹配变量赋值，保留原始值格式
      const match = effectiveLine.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (match) {
        const key = match[1];
        const originalValue = match[2].trim();
        let value = originalValue;

        // 记录格式信息
        settings._configInfo.formats[key] = {
          comment,
          commentSpacing,
          hasDoubleQuotes: value.startsWith('"') && value.endsWith('"'),
          hasSingleQuotes: value.startsWith("'") && value.endsWith("'")
        };

        // 如果值带有引号，去除引号用于内部处理
        if (settings._configInfo.formats[key].hasDoubleQuotes || settings._configInfo.formats[key].hasSingleQuotes) {
          value = value.substring(1, value.length - 1);
        }

        // 如果是需要保持为字符串的字段，跳过类型转换
        if (stringFields.has(key)) {
          settings[key] = value;
          continue;
        }

        // 转换布尔值
        const lowerValue = value.toLowerCase();
        if (lowerValue === 'true' || lowerValue === 'false') {
          settings[key] = lowerValue === 'true';
        }
        // 转换数字
        else if (!Number.isNaN(Number(value)) && value.trim() !== '' && !Number.isNaN(Number.parseFloat(value))) {
          settings[key] = Number(value);
        }
        // 保留字符串
        else {
          settings[key] = value;
        }
      }
    }

    return settings;
  },

  // 加载设置元数据
  async loadSettingsMetadata() {
    try {
      const metadataPath = `${Core.MODULE_PATH}module_settings/settings.json`;

      // 检查是否已取消
      if (this.isCancelled) return;

      const metadataContent = await Core.execCommand(`cat "${metadataPath}"`);

      // 再次检查是否已取消
      if (this.isCancelled) return;

      if (!metadataContent) {
        console.warn('设置元数据文件为空或不存在');
        this.setupTestMetadata();
        return;
      }

      const metadata = JSON.parse(metadataContent);

      // 设置排除项
      this.excludedSettings = metadata.excluded || [];

      // 设置描述
      this.settingsDescriptions = metadata.descriptions || {};

      // 设置选项
      this.settingsOptions = metadata.options || {};

      // 加载动态算法列表
      await this.loadAlgorithmOptions();

      // 加载 feature 标志
      await this.loadFeatureFlags();
    } catch (error) {
      console.error('加载设置元数据失败:', error);
      this.setupTestMetadata();
    }
  },

  // 加载动态算法选项
  async loadAlgorithmOptions() {
    try {
      if (this.isCancelled) return;

      const algorithmOutput = await Core.execCommand('cat /sys/block/zram0/comp_algorithm');

      if (this.isCancelled) return;

      if (!algorithmOutput) {
        console.warn('无法获取算法列表');
        return;
      }

      // 解析算法列表：格式类似 "lzo lzo-rle lz4 lz4hc [lz4k_oplus] zstd"
      const algorithms = [];
      let current = '';
      const output = algorithmOutput.trim();

      for (let i = 0; i < output.length; i++) {
        const ch = output[i];
        if (ch === '[') {
          // 当前选中的算法开始
          current = '';
        } else if (ch === ']') {
          // 当前选中的算法结束
          this.currentAlgorithm = current;
          algorithms.push(current);
          current = '';
        } else if (ch === ' ' || ch === '\t') {
          if (current.length > 0) {
            algorithms.push(current);
            current = '';
          }
        } else {
          current += ch;
        }
      }
      // 处理最后一个没有空格结尾的算法名
      if (current.length > 0) {
        algorithms.push(current);
      }

      this.availableAlgorithms = algorithms;

      // 动态添加 algorithm 选项到 settingsOptions
      this.settingsOptions.algorithm = {
        options: algorithms.map(algo => ({
          value: algo,
          label: { en: algo, zh: algo, ru: algo }
        }))
      };

      console.log(`已加载 ${algorithms.length} 个算法选项, 当前选中: ${this.currentAlgorithm}`);
    } catch (error) {
      console.warn('加载算法列表失败:', error);
    }
  },

  // 加载 feature 标志
  async loadFeatureFlags() {
    const featurePath = `${Core.MODULE_PATH}files/data/feature/`;

    for (const flag of ['support_auto_size', 'support_zram_recompressd', 'support_zstd_level']) {
      try {
        if (this.isCancelled) return;

        const content = await Core.execCommand(`cat "${featurePath}${flag}"`);

        if (this.isCancelled) return;

        const value = content ? content.trim().toLowerCase() : 'false';
        this.featureFlags[flag] = value === 'true';
      } catch {
        // 文件不存在时默认为 false（保守策略）
        this.featureFlags[flag] = false;
      }
    }

    console.log('Feature 标志:', this.featureFlags);
  },

  // 设置测试元数据
  setupTestMetadata() {
    // 设置描述
    this.settingsDescriptions = {
      ENABLE_FEATURE_A: { zh: '启用功能A', en: 'Enable Feature A' },
      ENABLE_FEATURE_B: { zh: '启用功能B', en: 'Enable Feature B' },
      SERVER_PORT: { zh: '服务器端口', en: 'Server Port' },
      API_KEY: { zh: 'API密钥', en: 'API Key' },
      LOG_LEVEL: { zh: '日志级别', en: 'Log Level' },
      THEME: { zh: '主题', en: 'Theme' },
      VOLUME: { zh: '音量', en: 'Volume' },
      BRIGHTNESS: { zh: '亮度', en: 'Brightness' }
    };

    // 设置选项配置
    this.settingsOptions = {
      LOG_LEVEL: {
        options: [
          { value: 'debug', label: { zh: '调试', en: 'Debug' } },
          { value: 'info', label: { zh: '信息', en: 'Info' } },
          { value: 'warn', label: { zh: '警告', en: 'Warning' } },
          { value: 'error', label: { zh: '错误', en: 'Error' } }
        ]
      },
      THEME: {
        options: [
          { value: 'auto', label: { zh: '自动', en: 'Auto' } },
          { value: 'light', label: { zh: '浅色', en: 'Light' } },
          { value: 'dark', label: { zh: '深色', en: 'Dark' } }
        ]
      }
    };

    // 添加测试排除规则
    this.excludedSettings = ['APP_*', 'SYSTEM_TEMP', 'ACTION_*'];
  },

  // 保存设置
  async saveSettings() {
    try {
      this.showLoading();

      // 收集表单数据
      const updatedSettings = {};
      for (const key in this.settings) {
        // 跳过内部属性和排除项
        if (key.startsWith('_') || this.excludedSettings.includes(key)) continue;

        // 查找自定义选择控件
        const customSelect = document.querySelector(`.custom-select[id="setting-${key}"]`);
        const element = document.getElementById(`setting-${key}`);

        if (customSelect) {
          if (customSelect.hasAttribute('disabled')) {
            // 禁用的控件保持原值
            updatedSettings[key] = this.settings[key];
          } else {
            updatedSettings[key] = customSelect.getAttribute('data-value');
          }
        } else if (!element) {
        } else if (element.hasAttribute('disabled')) {
          // 禁用的控件保持原值
          updatedSettings[key] = this.settings[key];
        } else if (element.type === 'checkbox') {
          updatedSettings[key] = element.checked;
        } else if (element.type === 'range') {
          // 处理滑块控件
          if (key === 'zstd_compression_level') {
            updatedSettings[key] = Number(element.value);
          } else if (key === 'writeback_block_size') {
            updatedSettings[key] = Number(element.value);
          } else {
            updatedSettings[key] = Number(element.value);
          }
        } else if (element.type === 'number') {
          updatedSettings[key] = Number(element.value);
        } else {
          // size 字段始终作为字符串
          if (key === 'size') {
            updatedSettings[key] = element.value;
          } else {
            updatedSettings[key] = element.value;
          }
        }
      }

      // 获取配置文件路径
      const configPath = `${Core.MODULE_PATH}module_settings/config.sh`;

      // 检查是否有配置信息
      if (!this.settings._configInfo) {
        // 如果没有配置信息，先读取原始配置
        const originalConfig = await Core.execCommand(`cat "${configPath}"`);
        if (originalConfig) {
          // 解析原始配置以获取格式信息
          const tempSettings = this.parseConfigFile(originalConfig);
          this.settings._configInfo = tempSettings._configInfo;
        } else {
          // 如果无法读取原始配置，创建一个空的配置信息
          this.settings._configInfo = {
            lines: [],
            formats: {}
          };
        }
      }

      // 生成新的配置文件内容
      let configContent = '';

      // 首先处理排除项，保持它们原样
      if (this.settings._configInfo.lines) {
        for (const line of this.settings._configInfo.lines) {
          const match = line.match(/^([A-Za-z0-9_]+)\s*=/);
          if (
            match &&
            this.excludedSettings.some(p => {
              if (p.includes('*')) {
                return new RegExp(`^${p.replace(/\*/g, '.*')}$`).test(match[1]);
              }
              return p === match[1];
            })
          ) {
            configContent += `${line}\n`;
          }
        }
      }

      // 然后处理更新的设置项
      for (const key in updatedSettings) {
        const format = this.settings._configInfo.formats[key] || {};
        let value = updatedSettings[key];

        // 根据原始格式和设置类型处理值
        if (typeof value === 'string') {
          // 如果是预定义选项的设置项（包括 algorithm 等动态选项），强制使用双引号
          if (
            this.settingsOptions[key] ||
            key === 'algorithm' ||
            key === 'recompressd_algorithm1' ||
            key === 'recompressd_algorithm2' ||
            key === 'recompressd_algorithm3' ||
            key === 'size'
          ) {
            value = `"${value}"`;
          }
          // 否则按原有格式处理
          else if (format.hasDoubleQuotes) {
            value = `"${value}"`;
          } else if (format.hasSingleQuotes) {
            value = `'${value}'`;
          } else if (value.includes(' ') || value === '') {
            value = `"${value}"`;
          }
        } else if (typeof value === 'boolean') {
          value = value ? 'true' : 'false';
        }

        // 添加注释
        const comment = format.comment ? `${format.commentSpacing || ' '}${format.comment}` : '';
        configContent += `${key}=${value}${comment}\n`;
      }

      // 检查是否已取消
      if (this.isCancelled) return;

      // 保存配置文件
      await Core.execCommand(`echo '${configContent.replace(/'/g, "'\\''")}' > "${configPath}"`);

      // 再次检查是否已取消
      if (this.isCancelled) return;

      // 更新本地设置
      const configInfo = this.settings._configInfo;

      // 更新设置对象，保留内部属性
      for (const key in this.settings) {
        if (!key.startsWith('_')) {
          delete this.settings[key];
        }
      }

      // 添加更新后的设置
      for (const key in updatedSettings) {
        this.settings[key] = updatedSettings[key];
      }

      // 保留配置信息
      this.settings._configInfo = configInfo;

      // 更新备份
      this.createSettingsBackup();

      // 重置未保存更改标志
      this.hasUnsavedChanges = false;

      // 清除临时表单状态
      this.tempFormState = {};

      // 显示成功消息
      Core.showToast(I18n.translate('SETTINGS_SAVED', '设置已保存'));
    } catch (error) {
      console.error('保存设置失败:', error);
      if (!this.isCancelled) {
        Core.showToast(I18n.translate('SETTINGS_SAVE_ERROR', '保存设置失败'), 'error');
      }
    } finally {
      if (!this.isCancelled) {
        this.hideLoading();
      }
    }
  },

  // 还原设置
  restoreSettings() {
    if (!this.settingsBackup || Object.keys(this.settingsBackup).length === 0) {
      Core.showToast(I18n.translate('NO_SETTINGS_BACKUP', '没有可用的设置备份'), 'error');
      return;
    }

    // 保存配置信息
    const configInfo = this.settings._configInfo;

    // 恢复设置
    this.settings = JSON.parse(JSON.stringify(this.settingsBackup));

    // 恢复配置信息
    if (configInfo) {
      this.settings._configInfo = configInfo;
    }

    // 更新设置显示
    this.updateSettingsDisplay();

    // 重置未保存更改标志
    this.hasUnsavedChanges = false;

    // 清除临时表单状态
    this.tempFormState = {};

    // 显示成功消息
    Core.showToast(I18n.translate('SETTINGS_RESTORED', '设置已还原'));
  },

  // 检查是否有未保存的更改
  checkForUnsavedChanges() {
    if (!this.settings || !this.settingsBackup) return false;

    // 收集当前表单数据
    const currentSettings = {};
    for (const key in this.settings) {
      // 跳过内部属性和排除项
      if (key.startsWith('_') || this.excludedSettings.includes(key)) continue;

      // 查找自定义选择控件
      const customSelect = document.querySelector(`.custom-select[id="setting-${key}"]`);
      const element = document.getElementById(`setting-${key}`);

      if (customSelect) {
        currentSettings[key] = customSelect.getAttribute('data-value');
      } else if (!element) {
      } else if (element.type === 'checkbox') {
        currentSettings[key] = element.checked;
      } else if (element.type === 'range') {
        currentSettings[key] = Number(element.value);
      } else if (element.type === 'number') {
        currentSettings[key] = Number(element.value);
      } else {
        currentSettings[key] = element.value;
      }
    }

    // 比较当前设置和备份
    for (const key in currentSettings) {
      if (this.excludedSettings.includes(key)) continue;

      // 检查类型和值是否相同
      const currentValue = currentSettings[key];
      const backupValue = this.settingsBackup[key];

      if (typeof currentValue !== typeof backupValue) {
        return true;
      }

      if (typeof currentValue === 'object') {
        if (JSON.stringify(currentValue) !== JSON.stringify(backupValue)) {
          return true;
        }
      } else if (currentValue !== backupValue) {
        return true;
      }
    }

    return false;
  },

  // 刷新设置
  async refreshSettings() {
    try {
      // 检查是否有未保存的更改
      if (this.checkForUnsavedChanges()) {
        const confirmRefresh = confirm(I18n.translate('CONFIRM_REFRESH_UNSAVED', '有未保存的更改，确定要刷新吗？'));
        if (!confirmRefresh) return;
      }

      // 清空设置数据，强制重新加载
      this.settings = {};

      await this.loadSettingsData();
      await this.loadSettingsMetadata();

      // 更新设置显示
      this.updateSettingsDisplay();

      // 创建新的备份
      this.createSettingsBackup();

      // 重置未保存更改标志
      this.hasUnsavedChanges = false;

      Core.showToast(I18n.translate('SETTINGS_REFRESHED', '设置已刷新'));
    } catch (error) {
      console.error('刷新设置失败:', error);
      Core.showToast(I18n.translate('SETTINGS_REFRESH_ERROR', '刷新设置失败'), 'error');
    }
  },

  // 更新设置显示
  updateSettingsDisplay() {
    const settingsContainer = document.getElementById('settings-container');
    if (settingsContainer) {
      settingsContainer.innerHTML = this.renderSettings();

      // 使用 setTimeout 确保 DOM 更新完成后再绑定事件
      setTimeout(() => {
        this.bindSettingEvents();
        this.initCustomSelects(settingsContainer);
        this.initSliderInputs();
        this.initKeyboardPad();
      }, 0);
    }
  },

  // 显示加载中
  showLoading() {
    if (this.isLoading) return;

    this.isLoading = true;
    const loadingElement = document.getElementById('settings-loading');
    if (loadingElement) {
      loadingElement.style.display = 'flex';
      loadingElement.style.visibility = 'visible';
      loadingElement.style.opacity = '1';
    }
  },

  // 隐藏加载中
  hideLoading() {
    if (!this.isLoading) return;

    this.isLoading = false;
    const loadingElement = document.getElementById('settings-loading');
    if (loadingElement) {
      loadingElement.style.opacity = '0';
      loadingElement.style.visibility = 'hidden';

      setTimeout(() => {
        if (!this.isLoading) {
          loadingElement.style.display = 'none';
        }
      }, 300);
    }
  },

  // 保存临时表单状态
  saveTemporaryFormState() {
    if (!this.hasUnsavedChanges) return;

    // 收集当前表单数据
    const tempSettings = { ...this.settings };

    for (const key in this.settings) {
      // 跳过内部属性和排除项
      if (key.startsWith('_') || this.excludedSettings.includes(key)) continue;

      // 查找自定义选择控件
      const customSelect = document.querySelector(`.custom-select[id="setting-${key}"]`);
      const element = document.getElementById(`setting-${key}`);

      if (customSelect) {
        tempSettings[key] = customSelect.getAttribute('data-value');
      } else if (!element) {
      } else if (element.type === 'checkbox') {
        tempSettings[key] = element.checked;
      } else if (element.type === 'range') {
        tempSettings[key] = Number(element.value);
      } else if (element.type === 'number') {
        tempSettings[key] = Number(element.value);
      } else {
        tempSettings[key] = element.value;
      }
    }

    // 保存临时状态
    this.tempFormState = tempSettings;
  },

  // 渲染后的回调
  async afterRender() {
    try {
      // 显示加载状态
      this.showLoading();

      // 等待设置数据加载完成
      await this.init();

      // 更新设置显示
      this.updateSettingsDisplay();

      // 使用setTimeout确保DOM完全更新后再绑定事件
      setTimeout(() => {
        this.afterRenderSetup();
      }, 0);
    } catch (error) {
      console.error('设置页面初始化失败:', error);
      Core.showToast(I18n.translate('SETTINGS_INIT_ERROR', '设置页面初始化失败'), 'error');
    } finally {
      this.hideLoading();
    }
  },

  // afterRender 中的设置逻辑（也用于语言切换）
  afterRenderSetup() {
    // 绑定设置项事件
    this.bindSettingEvents();

    // 初始化自定义选择控件
    const container = document.getElementById('settings-container');
    if (container) {
      this.initCustomSelects(container);
    }

    // 初始化滑块输入联动
    this.initSliderInputs();

    // 初始化键盘缓冲
    this.initKeyboardPad();
  },

  // 绑定设置项事件
  bindSettingEvents() {
    // 使用事件委托替代单独绑定
    const container = document.getElementById('settings-container');
    if (container) {
      if (this.settingsChangeHandler) {
        container.removeEventListener('change', this.settingsChangeHandler);
      }

      // 监听输入变化
      this.settingsChangeHandler = e => {
        const target = e.target;
        // 专门处理自定义选择控件的情况
        if (target.closest('.custom-select')) {
          // 标记有未保存的更改
          this.hasUnsavedChanges = this.checkForUnsavedChanges();
          // 保存临时表单状态
          this.saveTemporaryFormState();
        }
      };

      container.addEventListener('change', this.settingsChangeHandler);
    }
  },

  // 初始化滑块与悬浮数字联动
  initSliderInputs() {
    // 写回块大小：滑块 + 悬浮数字
    this.initSliderInputPair('writeback_block_size');

    // ZRAM 大小：滑块 + 悬浮数字
    this.initSizeSliderSync();

    // ZSTD 压缩等级：纯滑块 + 悬浮数字
    this.initZstdSlider();
  },

  syncRangeVisual(rangeEl) {
    if (!rangeEl) return;

    const min = Number(rangeEl.min || 0);
    const max = Number(rangeEl.max || 100);
    const value = Number(rangeEl.value || min);
    const safeMax = max > min ? max : min + 1;
    const clampedValue = Math.min(Math.max(value, min), safeMax);
    const progress = ((clampedValue - min) / (safeMax - min)) * 100;

    rangeEl.style.setProperty('--range-progress', `${progress}%`);
    rangeEl.style.setProperty('--slider-end-dot-color', progress >= 99.9 ? 'transparent' : 'var(--slider-active)');

    const outputEl = rangeEl.parentElement?.querySelector('output.slider-bubble');
    if (outputEl) {
      this.syncSliderBubblePosition(rangeEl, outputEl);
    }
  },

  syncSliderBubblePosition(rangeEl, outputEl) {
    if (!rangeEl || !outputEl) return;

    const min = Number(rangeEl.min || 0);
    const max = Number(rangeEl.max || 100);
    const value = Number(rangeEl.value || min);
    const safeMax = max > min ? max : min + 1;
    const progress = (Math.min(Math.max(value, min), safeMax) - min) / (safeMax - min);
    const trackWidth = rangeEl.getBoundingClientRect().width;

    if (!trackWidth) return;

    const thumbWidth = 18;
    const left = progress * (trackWidth - thumbWidth) + thumbWidth / 2 + rangeEl.offsetLeft;
    outputEl.style.left = `${left}px`;
  },

  showSliderBubble(outputEl) {
    if (!outputEl) return;
    if (outputEl._hideTimer) {
      clearTimeout(outputEl._hideTimer);
      outputEl._hideTimer = null;
    }
    outputEl.classList.add('visible');
  },

  hideSliderBubble(outputEl) {
    if (!outputEl) return;
    if (outputEl._hideTimer) {
      clearTimeout(outputEl._hideTimer);
      outputEl._hideTimer = null;
    }
    outputEl.classList.remove('visible');
  },

  scheduleHideSliderBubble(outputEl, delay = 80) {
    if (!outputEl) return;
    if (outputEl._hideTimer) {
      clearTimeout(outputEl._hideTimer);
    }
    outputEl._hideTimer = setTimeout(() => {
      outputEl.classList.remove('visible');
      outputEl._hideTimer = null;
    }, delay);
  },

  bindSliderBubbleVisibility(rangeEl, outputEl) {
    if (!rangeEl || !outputEl) return;

    const startSliding = () => {
      rangeEl.dataset.sliding = 'true';
      this.showSliderBubble(outputEl);
    };

    const stopSliding = () => {
      delete rangeEl.dataset.sliding;
      this.scheduleHideSliderBubble(outputEl);
    };

    rangeEl.addEventListener('pointerdown', startSliding);
    rangeEl.addEventListener('pointerup', stopSliding);
    rangeEl.addEventListener('pointercancel', stopSliding);
    rangeEl.addEventListener('change', stopSliding);
    rangeEl.addEventListener('blur', () => this.hideSliderBubble(outputEl));
  },

  // 初始化滑块 + 悬浮数字联动
  initSliderInputPair(key) {
    const rangeEl = document.getElementById(`setting-${key}`);
    const outputEl = rangeEl?.parentElement?.querySelector('output.slider-bubble');

    if (!rangeEl || !outputEl) return;

    this.syncRangeVisual(rangeEl);
    outputEl.textContent = String(Math.round(Number(rangeEl.value)));
    this.bindSliderBubbleVisibility(rangeEl, outputEl);

    rangeEl.addEventListener('input', () => {
      outputEl.textContent = String(Math.round(Number(rangeEl.value)));
      this.showSliderBubble(outputEl);
      if (rangeEl.dataset.sliding !== 'true') {
        this.scheduleHideSliderBubble(outputEl, 500);
      }
      this.syncRangeVisual(rangeEl);
      this.hasUnsavedChanges = this.checkForUnsavedChanges();
      this.saveTemporaryFormState();
    });

    requestAnimationFrame(() => {
      this.syncRangeVisual(rangeEl);
    });
  },

  // 初始化 ZRAM 大小滑块同步
  initSizeSliderSync() {
    const rangeEl = document.getElementById('setting-size-range');
    const inputEl = document.getElementById('setting-size');
    const autoToggleEl = document.getElementById('setting-size-auto');
    const sliderSectionEl = document.getElementById('setting-size-slider-section');
    const outputEl = sliderSectionEl?.querySelector('output.slider-bubble');
    const wrapperEl = document.querySelector('.size-control-wrapper');
    const autoSupported = this.featureFlags.support_auto_size;

    if (!rangeEl || !inputEl || !sliderSectionEl || !outputEl) return;

    this.bindSliderBubbleVisibility(rangeEl, outputEl);

    const syncDirtyState = () => {
      this.hasUnsavedChanges = this.checkForUnsavedChanges();
      this.saveTemporaryFormState();
    };

    const setAutoState = enabled => {
      wrapperEl?.classList.toggle('auto-active', enabled);
      if (autoToggleEl) {
        autoToggleEl.checked = enabled;
      }
    };

    const updateManualValue = value => {
      const manualValue = this.normalizeManualSizeValue(value);
      this.lastManualSizeValue = manualValue;
      rangeEl.value = String(manualValue);
      outputEl.textContent = String(manualValue);
      this.syncRangeVisual(rangeEl);

      if (sliderSectionEl) {
        sliderSectionEl.dataset.manualValue = String(manualValue);
      }

      return manualValue;
    };

    const updateStoredValue = value => {
      inputEl.value = value;
    };

    const initialManualValue = updateManualValue(
      sliderSectionEl?.dataset.manualValue || rangeEl.value || this.lastManualSizeValue
    );

    const isAutoMode = autoSupported && String(inputEl.value).trim().toLowerCase() === 'auto';
    if (!autoSupported && String(inputEl.value).trim().toLowerCase() === 'auto') {
      updateStoredValue(this.sliderToSizeString(this.lastManualSizeValue));
    } else if (!isAutoMode) {
      updateStoredValue(this.sliderToSizeString(initialManualValue));
    } else {
      updateStoredValue('auto');
    }

    if (autoToggleEl) {
      autoToggleEl.checked = isAutoMode;
    }
    setAutoState(isAutoMode);

    rangeEl.addEventListener('input', () => {
      const manualValue = updateManualValue(rangeEl.value);
      this.showSliderBubble(outputEl);
      if (rangeEl.dataset.sliding !== 'true') {
        this.scheduleHideSliderBubble(outputEl, 500);
      }
      if (!autoToggleEl || !autoToggleEl.checked) {
        updateStoredValue(this.sliderToSizeString(manualValue));
      }
      syncDirtyState();
    });

    if (autoToggleEl) {
      autoToggleEl.addEventListener('change', () => {
        if (autoToggleEl.checked) {
          updateStoredValue('auto');
          setAutoState(true);
        } else {
          setAutoState(false);
          const manualValue = updateManualValue(sliderSectionEl?.dataset.manualValue || this.lastManualSizeValue);
          updateStoredValue(this.sliderToSizeString(manualValue));
        }

        syncDirtyState();
      });
    }

    requestAnimationFrame(() => {
      this.syncRangeVisual(rangeEl);
    });
  },

  // 初始化 ZSTD 纯滑块
  initZstdSlider() {
    const rangeEl = document.getElementById('setting-zstd_compression_level');
    if (!rangeEl) return;

    this.syncRangeVisual(rangeEl);

    const outputEl = rangeEl.parentElement?.querySelector('output.slider-bubble');
    if (outputEl) {
      outputEl.textContent = String(Math.round(Number(rangeEl.value)));
      this.bindSliderBubbleVisibility(rangeEl, outputEl);
      rangeEl.addEventListener('input', () => {
        this.showSliderBubble(outputEl);
        if (rangeEl.dataset.sliding !== 'true') {
          this.scheduleHideSliderBubble(outputEl, 500);
        }
        this.syncRangeVisual(rangeEl);
        outputEl.textContent = rangeEl.value;
        this.hasUnsavedChanges = this.checkForUnsavedChanges();
        this.saveTemporaryFormState();
      });

      requestAnimationFrame(() => {
        this.syncRangeVisual(rangeEl);
      });
    }
  },

  // 初始化输入框聚焦自动居中（键盘缓冲）
  initKeyboardPad() {
    const container = document.getElementById('settings-container');
    if (!container) return;

    // 获取所有文本/数字输入框
    const inputs = container.querySelectorAll('input[type="text"], input[type="number"]');

    for (const input of inputs) {
      input.addEventListener('focus', () => {
        if (this.blurTimer) {
          clearTimeout(this.blurTimer);
          this.blurTimer = null;
        }
        container.classList.add('keyboard-pad');
        setTimeout(() => {
          input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      });

      input.addEventListener('blur', () => {
        this.blurTimer = setTimeout(() => {
          container.classList.remove('keyboard-pad');
        }, 100);
      });
    }
  },

  toggleSelect(selectElement) {
    const isActive = selectElement.classList.contains('active');
    this.closeAllSelects();
    if (!isActive) {
      selectElement.classList.add('active');
    }
  },

  closeAllSelects() {
    const customSelects = document.querySelectorAll('.custom-select');
    for (const select of customSelects) {
      select.classList.remove('active');
    }
  },

  initCustomSelects(container) {
    const customSelects = container.querySelectorAll('.custom-select');

    for (const select of customSelects) {
      // 跳过禁用的下拉框
      if (select.hasAttribute('disabled')) continue;

      const selected = select.querySelector('.select-selected');
      const options = select.querySelectorAll('.select-option');

      // 移除旧的事件监听器
      const newSelected = selected.cloneNode(true);
      selected.parentNode.replaceChild(newSelected, selected);

      // 绑定点击事件
      newSelected.addEventListener('click', e => {
        e.stopPropagation();
        this.toggleSelect(select);
      });

      // 处理选项点击
      for (const option of options) {
        const newOption = option.cloneNode(true);
        option.parentNode.replaceChild(newOption, option);

        newOption.addEventListener('click', e => {
          e.stopPropagation();
          const value = newOption.getAttribute('data-value');
          const text = newOption.textContent.trim();

          // 动态获取当前的 select-text（修复文本未更新）
          const selectText = select.querySelector('.select-text');
          selectText.textContent = text;

          select.setAttribute('data-value', value);

          // 动态获取当前的选项列表（修复多个选中）
          const currentOptions = select.querySelectorAll('.select-option');
          for (const opt of currentOptions) {
            opt.classList.remove('selected');
          }
          newOption.classList.add('selected');

          this.closeAllSelects();

          // 如果是重压缩算法下拉框变化，需要刷新约束状态
          const key = select.id.replace('setting-', '');
          if (key.startsWith('recompressd_algorithm')) {
            this.refreshRecompressdConstraints();
          }

          const fakeEvent = new Event('change');
          select.dispatchEvent(fakeEvent);

          this.hasUnsavedChanges = this.checkForUnsavedChanges();
          this.saveTemporaryFormState();
        });

        newOption.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            newOption.click();
          } else if (e.key === 'Escape') {
            this.closeAllSelects();
          }
        });
      }
    }

    // 绑定全局点击事件
    document.removeEventListener('click', this.closeAllSelectsHandler);
    this.closeAllSelectsHandler = e => {
      if (!e.target.closest('.custom-select')) {
        this.closeAllSelects();
      }
    };
    document.addEventListener('click', this.closeAllSelectsHandler);
  },

  // 刷新重压缩算法约束状态
  refreshRecompressdConstraints() {
    // 重新渲染所有重压缩算法下拉框以更新禁用状态
    const settingsContainer = document.getElementById('settings-container');
    if (!settingsContainer) return;

    for (let i = 1; i <= 3; i++) {
      const key = `recompressd_algorithm${i}`;
      const settingItem = settingsContainer.querySelector(`.setting-item[data-key="${key}"]`);
      if (settingItem) {
        const value = this.settings[key] || '';
        const description = this.getSettingDescription(key);
        settingItem.innerHTML = this.renderRecompressdSelect(key, value, description, false, '');
      }
    }

    // 重新初始化下拉框事件
    this.initCustomSelects(settingsContainer);
  },

  // 页面激活时的回调
  onActivate() {
    // 重置取消标志
    this.isCancelled = false;
  },

  // 页面停用时的回调
  onDeactivate() {
    // 检查是否有未保存的更改
    if (this.hasUnsavedChanges || this.checkForUnsavedChanges()) {
      Core.showToast(I18n.translate('UNSAVED_SETTINGS', '设置有未保存的更改'), 'warning');
    }
    // 注销语言切换处理器
    I18n.unregisterLanguageChangeHandler(this.onLanguageChanged.bind(this));
    // 清理页面操作按钮
    UI.clearPageActions();
    // 设置取消标志，用于中断正在进行的异步操作
    this.isCancelled = true;
    // 清理资源
    this.cleanupResources();
  },

  // 清理资源
  cleanupResources() {
    // 移除可能存在的事件监听器
    const container = document.getElementById('settings-container');
    if (container) {
      // 使用克隆节点的方式移除所有事件监听器
      const newContainer = container.cloneNode(true);
      container.parentNode.replaceChild(newContainer, container);
    }

    // 移除页面操作按钮的事件监听器
    const restoreButton = document.getElementById('restore-settings');
    if (restoreButton) {
      restoreButton.replaceWith(restoreButton.cloneNode(true));
    }

    const refreshButton = document.getElementById('refresh-settings');
    if (refreshButton) {
      refreshButton.replaceWith(refreshButton.cloneNode(true));
    }

    const saveButton = document.getElementById('save-settings');
    if (saveButton) {
      saveButton.replaceWith(saveButton.cloneNode(true));
    }
  }
};

// 导出设置页面模块
window.SettingsPage = SettingsPage;
