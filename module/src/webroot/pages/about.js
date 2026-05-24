/**
 * zram WebUI 关于页面模块
 * 显示模块信息和版本
 */

const AboutPage = {
  // 模块信息
  moduleInfo: {},
  version: '8.0.1',
  languageChangeHandler: null,
  themeChangeHandler: null,

  // 预加载数据
  async preloadData() {
    try {
      // 检查是否有缓存的模块信息
      const cachedInfo = sessionStorage.getItem('moduleInfo');
      if (cachedInfo) {
        return JSON.parse(cachedInfo);
      }

      // 尝试从配置文件获取模块信息
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

        // 缓存模块信息
        sessionStorage.setItem('moduleInfo', JSON.stringify(config));
        return config;
      }
      return {};
    } catch (error) {
      console.warn('预加载模块信息失败:', error);
      return {};
    }
  },

  // 修改初始化方法
  async init() {
    try {
      this.registerActions();
      // 使用预加载的数据
      const preloadedData = PreloadManager.getData('about') || (await this.preloadData());
      this.moduleInfo = preloadedData;

      if (!this.languageChangeHandler) {
        this.languageChangeHandler = this.onLanguageChanged.bind(this);
      }
      if (!this.themeChangeHandler) {
        this.themeChangeHandler = this.onThemeChanged.bind(this);
      }

      // 注册语言切换处理器
      I18n.registerLanguageChangeHandler(this.languageChangeHandler);
      document.addEventListener('themeChanged', this.themeChangeHandler);

      return true;
    } catch (error) {
      console.error('初始化关于页面失败:', error);
      return false;
    }
  },

  // 添加语言切换处理方法
  onLanguageChanged() {
    const aboutContent = document.querySelector('.about-container');
    if (aboutContent) {
      aboutContent.outerHTML = this.render().trim();
      this.afterRender();
    }
  },

  onThemeChanged() {
    this.updateThemePreferenceButton();
  },

  // 添加清理方法
  onDeactivate() {
    // 注销语言切换处理器
    if (this.languageChangeHandler) {
      I18n.unregisterLanguageChangeHandler(this.languageChangeHandler);
    }
    if (this.themeChangeHandler) {
      document.removeEventListener('themeChanged', this.themeChangeHandler);
    }
    // 清理页面操作按钮
    UI.clearPageActions();
  },
  registerActions() {
    UI.clearPageActions('about');
  },

  render() {
    return `
        <div class="about-container">
            <div class="about-header">
                <div class="app-logo">
                    <span class="material-symbols-rounded">dashboard_customize</span>
                </div>
                <div class="about-header-content">
                    <h2>Zram WebUI</h2>
                    <div class="version-badge">
                        ${I18n.translate('VERSION', '版本')} ${this.version}
                    </div>
                    <div class="about-badges">
                        <span class="about-pill">
                            <span class="material-symbols-rounded">extension</span>
                            ${this.moduleInfo.module_name || 'Zram'}
                        </span>
                        <span class="about-pill">
                            <span class="material-symbols-rounded">person</span>
                            ${this.moduleInfo.author || I18n.translate('UNKNOWN', '未知')}
                        </span>
                    </div>
                    <p class="about-description">${I18n.translate('ABOUT_DESCRIPTION', 'Zram模块管理界面')}</p>
                </div>
            </div>
            
            <div class="about-card">
                <div class="about-section about-section-highlight">
                    <h3 class="section-title">
                        <span class="material-symbols-rounded">tune</span>
                        ${I18n.translate('INTERFACE_SETTINGS', '界面设置')}
                    </h3>
                    <div class="preferences-grid">
                        <button type="button" class="preference-button" id="about-theme-toggle">
                            <span class="material-symbols-rounded preference-icon">${this.getCurrentThemeIcon()}</span>
                            <span class="preference-content">
                                <span class="preference-label">${I18n.translate('THEME', '主题')}</span>
                                <span class="preference-value" id="about-theme-toggle-text">${this.getCurrentThemeLabel()}</span>
                            </span>
                        </button>
                        <button type="button" class="preference-button" id="about-language-button">
                            <span class="material-symbols-rounded preference-icon">translate</span>
                            <span class="preference-content">
                                <span class="preference-label">${I18n.translate('SELECT_LANGUAGE', '选择语言')}</span>
                                <span class="preference-value">${this.getCurrentLanguageLabel()}</span>
                            </span>
                        </button>
                        <button type="button" class="preference-button" id="about-color-picker">
                            <span class="material-symbols-rounded preference-icon">palette</span>
                            <span class="preference-content">
                                <span class="preference-label">${I18n.translate('COLOR_PICKER', '颜色选择器')}</span>
                                <span class="preference-value">${I18n.translate('CUSTOMIZE_ACCENT', '调整界面主色')}</span>
                            </span>
                        </button>
                    </div>
                </div>

                <div class="about-section">
                    <h3 class="section-title">
                        <span class="material-symbols-rounded">info</span>
                        ${I18n.translate('MODULE_INFO', '模块信息')}
                    </h3>
                    <div class="info-list">
                        ${this.renderModuleInfo()}
                    </div>
                </div>
                
                <div class="about-section">
                    <h3 class="section-title">
                        <span class="material-symbols-rounded">person</span>
                        ${I18n.translate('MODULE_DEVELOPER', '模块开发者')}
                    </h3>
                    <div class="developer-info">
                        <div class="developer-name">
                            ${this.moduleInfo.author || I18n.translate('UNKNOWN', '未知')}
                        </div>
                        ${
                          this.moduleInfo.github
                            ? `
                        <a href="#" class="social-link" id="module-github-link">
                            <span class="material-symbols-rounded">code</span>
                            <span>GitHub</span>
                        </a>
                        `
                            : ''
                        }
                    </div>
                </div>
                
                <div class="about-section">
                    <h3 class="section-title">
                        <span class="material-symbols-rounded">engineering</span>
                        ${I18n.translate('FRAMEWORK_DEVELOPER', '框架开发者')}
                    </h3>
                    <div class="developer-info">
                        <div class="developer-name">
                            AuroraNasa
                        </div>
                        <a href="#" class="social-link" id="github-link">
                            <span class="material-symbols-rounded">code</span>
                            <span>GitHub</span>
                        </a>
                    </div>
                </div>
            </div>
            
            <div class="about-footer">
                <p>${I18n.translate('COPYRIGHT_INFO', `© ${new Date().getFullYear()} Aurora星空. All rights reserved.`)}</p>
            </div>
        </div>
    `;
  },

  getCurrentThemeIcon() {
    return window.ThemeManager?.isDarkTheme?.() ? 'dark_mode' : 'light_mode';
  },

  getCurrentThemeLabel() {
    return window.ThemeManager?.isDarkTheme?.()
      ? I18n.translate('DARK_MODE', '夜间模式')
      : I18n.translate('LIGHT_MODE', '日间模式');
  },

  getCurrentLanguageLabel() {
    const labels = {
      zh: '简体中文',
      en: 'English',
      ru: 'Русский'
    };
    return labels[I18n.currentLang] || I18n.currentLang?.toUpperCase() || 'System';
  },

  openLanguageSelector() {
    const languageSelector = document.getElementById('language-selector');
    if (!languageSelector) {
      Core.showToast(I18n.translate('LANGUAGE_SELECTOR_ERROR', '语言选择器不可用'), 'error');
      return;
    }

    if (typeof I18n.updateLanguageSelector === 'function') {
      I18n.updateLanguageSelector();
    }
    UI.showOverlay(languageSelector);
  },

  toggleThemePreference() {
    if (window.ThemeManager?.toggleTheme) {
      window.ThemeManager.toggleTheme();
      this.updateThemePreferenceButton();
    }
  },

  updateThemePreferenceButton() {
    const themeButton = document.getElementById('about-theme-toggle');
    const themeText = document.getElementById('about-theme-toggle-text');
    if (!themeButton || !themeText) return;

    const icon = themeButton.querySelector('.preference-icon');
    if (icon) {
      icon.textContent = this.getCurrentThemeIcon();
    }
    themeText.textContent = this.getCurrentThemeLabel();
  },

  showColorPicker() {
    // 创建对话框容器
    const dialogContainer = document.createElement('div');
    dialogContainer.className = 'color-picker-overlay';

    // Material Design 3 标准色调值
    const presetHues = [
      { value: 0, name: 'color' },
      { value: 37, name: 'color' },
      { value: 66, name: 'color' },
      { value: 97, name: 'color' },
      { value: 124, name: 'color' },
      { value: 148, name: 'color' },
      { value: 176, name: 'color' },
      { value: 212, name: 'color' },
      { value: 255, name: 'color' },
      { value: 300, name: 'color' },
      { value: 325, name: 'color' }
    ];

    // 创建对话框内容
    const dialog = document.createElement('div');
    dialog.className = 'md-dialog color-picker-dialog';
    dialog.style.position = 'relative';
    dialog.style.top = '0';
    dialog.innerHTML = `
            <h2>${I18n.translate('COLOR_PICKER', '颜色选择器')}</h2>
            <div class="color-picker-content">
                <div class="preset-colors">
                    ${presetHues
                      .map(
                        hue => `
                        <div class="preset-color" data-hue="${hue.value}" title="${hue.name}">
                            <div class="color-preview" style="--preview-hue: ${hue.value}"></div>
                        </div>
                    `
                      )
                      .join('')}
                </div>
                <label>
                    <span>${I18n.translate('HUE_VALUE', '色调值')}</span>
                    <input type="range" id="hue-slider" min="0" max="360" value="${this.getCurrentHue()}">
                    <output id="hue-value">${this.getCurrentHue()}</output>
                </label>
            </div>
            <div class="dialog-buttons">
                <button class="dialog-button" id="cancel-color">${I18n.translate('CANCEL', '取消')}</button>
                <button class="dialog-button filled" id="apply-color">${I18n.translate('APPLY', '应用')}</button>
            </div>
        `;

    // 添加到文档
    dialogContainer.appendChild(dialog);
    document.body.appendChild(dialogContainer);

    // 添加滑块事件
    const slider = document.getElementById('hue-slider');
    const output = document.getElementById('hue-value');

    // 添加预设色调点击事件
    dialog.querySelectorAll('.preset-color').forEach(preset => {
      preset.addEventListener('click', () => {
        const hue = preset.dataset.hue;
        slider.value = hue;
        output.textContent = `${hue}°`;
        // 实时预览颜色
        document.documentElement.style.setProperty('--hue', hue);
      });
    });

    // 添加滑块实时预览
    slider.addEventListener('input', () => {
      const value = slider.value;
      output.textContent = `${value}°`;
      // 实时预览颜色
      document.documentElement.style.setProperty('--hue', value);
    });

    // 保存打开时的颜色值
    const originalHue = this.getCurrentHue();

    // 添加关闭动画
    const closeDialog = () => {
      dialogContainer.classList.add('closing');
      dialog.classList.add('closing');
      setTimeout(() => dialogContainer.remove(), 200);
    };

    // 添加按钮事件
    document.getElementById('cancel-color').addEventListener('click', () => {
      // 恢复原始颜色值
      this.setHueValue(originalHue);
      closeDialog();
    });

    document.getElementById('apply-color').addEventListener('click', () => {
      this.setHueValue(slider.value);
      closeDialog();
      Core.showToast(I18n.translate('COLOR_CHANGED', '颜色已更新'));
    });

    // 点击遮罩层关闭
    dialogContainer.addEventListener('click', e => {
      if (e.target === dialogContainer) {
        closeDialog();
      }
    });
  },

  getCurrentHue() {
    // 从CSS变量获取当前色调值
    const root = document.documentElement;
    const hue = getComputedStyle(root).getPropertyValue('--hue').trim();
    return hue || '300'; // 默认值300
  },

  setHueValue(hue) {
    // 更新CSS变量
    const root = document.documentElement;
    root.style.setProperty('--hue', hue);

    // 保存到localStorage
    localStorage.setItem('ammf_color_hue', hue);

    // 触发颜色变化事件
    document.dispatchEvent(
      new CustomEvent('colorChanged', {
        detail: { hue: hue }
      })
    );
  },
  // 修改模块信息渲染方法，只保留模块名称和版本信息
  renderModuleInfo() {
    const infoItems = [
      { key: 'module_name', label: 'MODULE_NAME', icon: 'tag' },
      { key: 'version', label: 'MODULE_VERSION', icon: 'new_releases' },
      { key: 'versionCode', label: 'VERSION_DATE', icon: 'update' }
    ];

    let html = '';

    infoItems.forEach(item => {
      if (this.moduleInfo[item.key]) {
        html += `
                    <div class="info-item">
                        <div class="info-icon">
                            <span class="material-symbols-rounded">${item.icon}</span>
                        </div>
                        <div class="info-content">
                            <div class="info-label" data-i18n="${item.label}">${I18n.translate(item.label, item.key)}</div>
                            <div class="info-value">${this.moduleInfo[item.key]}</div>
                        </div>
                    </div>
                `;
      }
    });

    return html || `<div class="empty-state" data-i18n="NO_INFO">${I18n.translate('NO_INFO', '无可用信息')}</div>`;
  },

  // 加载模块信息
  async loadModuleInfo() {
    try {
      // 检查是否有缓存的模块信息
      const cachedInfo = sessionStorage.getItem('moduleInfo');
      if (cachedInfo) {
        this.moduleInfo = JSON.parse(cachedInfo);
        console.log('从缓存加载模块信息:', this.moduleInfo);
        return;
      }

      // 尝试从配置文件获取模块信息
      const configOutput = await Core.execCommand(`cat "${Core.MODULE_PATH}module.prop"`);

      if (configOutput) {
        // 解析配置文件
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
        // 缓存模块信息
        sessionStorage.setItem('moduleInfo', JSON.stringify(config));
        console.log('模块信息加载成功:', this.moduleInfo);
      } else {
        console.warn('无法读取模块配置文件');
        this.moduleInfo = {};
      }
    } catch (error) {
      console.error('加载模块信息失败:', error);
      this.moduleInfo = {};
    }
  },

  // 渲染后的回调
  afterRender() {
    // 添加GitHub链接点击事件
    const githubLink = document.getElementById('github-link');
    if (githubLink) {
      githubLink.addEventListener('click', e => {
        e.preventDefault();
        this.openGitHubLink();
      });
    }

    // 添加模块GitHub链接点击事件
    const moduleGithubLink = document.getElementById('module-github-link');
    if (moduleGithubLink) {
      moduleGithubLink.addEventListener('click', e => {
        e.preventDefault();
        this.openModuleGitHubLink();
      });
    }

    const colorPickerButton = document.getElementById('about-color-picker');
    if (colorPickerButton) {
      colorPickerButton.addEventListener('click', () => {
        this.showColorPicker();
      });
    }

    const languageButton = document.getElementById('about-language-button');
    if (languageButton) {
      languageButton.addEventListener('click', () => {
        this.openLanguageSelector();
      });
    }

    const themeButton = document.getElementById('about-theme-toggle');
    if (themeButton) {
      themeButton.addEventListener('click', () => {
        this.toggleThemePreference();
      });
    }

    this.updateThemePreferenceButton();
  },

  // 打开GitHub链接
  async openGitHubLink() {
    try {
      // 获取GitHub链接
      let githubUrl = 'https://github.com/Aurora-Nasa-1/AM' + 'MF2';

      // 如果模块信息中有GitHub链接，则使用模块信息中的链接
      if (this.moduleInfo.github) {
        githubUrl = this.moduleInfo.github;
      }

      // 使用安卓浏览器打开链接
      app.OpenUrl(githubUrl);
      console.log('已打开GitHub链接:', githubUrl);
    } catch (error) {
      console.error('打开GitHub链接失败:', error);
      Core.showToast('打开GitHub链接失败', 'error');
    }
  },

  // 打开模块GitHub链接
  async openModuleGitHubLink() {
    try {
      if (!this.moduleInfo.github) {
        Core.showToast('模块未提供GitHub链接', 'warning');
        return;
      }

      // 使用安卓浏览器打开链接
      await Core.execCommand(`am start -a android.intent.action.VIEW -d "${this.moduleInfo.github}"`);
      console.log('已打开模块GitHub链接:', this.moduleInfo.github);
    } catch (error) {
      console.error('打开模块GitHub链接失败:', error);
      Core.showToast('打开模块GitHub链接失败', 'error');
    }
  }
};
// 导出关于页面模块
window.AboutPage = AboutPage;
