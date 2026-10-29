/**
 * RapidQuant - Core & Navigation Controller Module (RQ.Core)
 * Manages global app state, router, navigation stack, themed modals, and error boundaries.
 */
(function(window) {
  'use strict';

  window.RQ = window.RQ || {};
  window.RQ.version = '2.2.0';

  // --- Global Error Boundary ---
  window.addEventListener('error', function(event) {
    console.error('[RapidQuant Error Boundary]', event.error || event.message);
  });
  window.addEventListener('unhandledrejection', function(event) {
    console.warn('[RapidQuant Unhandled Rejection]', event.reason);
  });

  // --- Centralized App State Management ---
  const State = {
    _mode: 'single', // 'single', 'unknown', 'lod'
    get currentMode() { return this._mode; },
    set currentMode(v) { this._mode = v; },

    currentExperiment: {
      name: '',
      conc: 10.0,
      unit: 'ng/mL',
      description: '',
      date: new Date().toISOString().slice(0, 16),
      captureMolecule: '',
      detectionMolecule: ''
    },
    loadedStrips: [],
    currentResultsBundle: null,
    pendingCapturedStrip: null,
    isCapturingUnknown: false
  };

  window.RQ.State = State;

  // Backwards compatibility property accessors on window
  try {
    Object.defineProperty(window, 'currentMode', {
      get() { return State.currentMode; },
      set(v) { State.currentMode = v; },
      configurable: true
    });
    Object.defineProperty(window, 'currentExperiment', {
      get() { return State.currentExperiment; },
      set(v) { State.currentExperiment = v; },
      configurable: true
    });
    Object.defineProperty(window, 'loadedStrips', {
      get() { return State.loadedStrips; },
      set(v) { State.loadedStrips = v; },
      configurable: true
    });
    Object.defineProperty(window, 'currentResultsBundle', {
      get() { return State.currentResultsBundle; },
      set(v) { State.currentResultsBundle = v; },
      configurable: true
    });
    Object.defineProperty(window, 'pendingCapturedStrip', {
      get() { return State.pendingCapturedStrip; },
      set(v) { State.pendingCapturedStrip = v; },
      configurable: true
    });
    Object.defineProperty(window, 'isCapturingUnknown', {
      get() { return State.isCapturingUnknown; },
      set(v) { State.isCapturingUnknown = v; },
      configurable: true
    });
  } catch (e) {
    console.warn('[RQ.Core] Could not define state properties on window', e);
  }

  // Toast Notification Utility
  function showToast(message, type = 'info') {
    try {
      const container = document.getElementById('toast-container');
      if (!container) return;
      const toast = document.createElement('div');
      let bg = 'bg-slate-800 text-white';
      if (type === 'success') bg = 'bg-teal-600 text-white';
      if (type === 'error') bg = 'bg-rose-600 text-white';
      if (type === 'warning') bg = 'bg-amber-600 text-white';

      toast.className = bg + ' px-4 py-2.5 rounded-xl shadow-lg text-xs font-medium flex items-center gap-2 transform transition-all duration-300 translate-y-2 opacity-0';
      toast.innerHTML = '<span>' + (type === 'success' ? '✓' : (type === 'error' ? '✕' : 'ℹ')) + '</span><span>' + message + '</span>';
      container.appendChild(toast);

      requestAnimationFrame(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
      });

      setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    } catch (err) {
      console.warn('[RQ.Core.showToast]', err);
    }
  }

  // Themed Dialog Controller
  const themedDialogModal = document.getElementById('app-themed-dialog-modal');
  const themedDialogIconContainer = document.getElementById('themed-dialog-icon-container');
  const themedDialogTitle = document.getElementById('themed-dialog-title');
  const themedDialogMessage = document.getElementById('themed-dialog-message');
  const themedDialogDetailBox = document.getElementById('themed-dialog-detail-box');
  const themedDialogButtonsContainer = document.getElementById('themed-dialog-buttons-container');
  const themedDialogCloseBtn = document.getElementById('themed-dialog-close-btn');

  let currentDialogResolve = null;

  function closeThemedDialog(value = false) {
    if (themedDialogModal) {
      themedDialogModal.classList.add('hidden');
      themedDialogModal.style.display = 'none';
    }
    if (typeof currentDialogResolve === 'function') {
      const resolve = currentDialogResolve;
      currentDialogResolve = null;
      resolve(value);
    }
  }

  if (themedDialogCloseBtn) {
    themedDialogCloseBtn.addEventListener('click', () => closeThemedDialog(false));
  }

  function showThemedAlert(opts) {
    return new Promise((resolve) => {
      currentDialogResolve = resolve;
      const config = typeof opts === 'string' ? { message: opts } : (opts || {});
      const title = config.title || 'Notice';
      const message = config.message || '';
      const type = config.type || 'info';
      const detailText = config.detailText || '';
      const buttonText = config.buttonText || 'OK, Done';

      if (themedDialogIconContainer) {
        if (type === 'success') {
          themedDialogIconContainer.className = 'w-12 h-12 rounded-2xl bg-teal-50 border border-teal-200 text-teal-600 flex items-center justify-center text-2xl shadow-2xs';
          themedDialogIconContainer.textContent = '✓';
        } else if (type === 'danger') {
          themedDialogIconContainer.className = 'w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center text-2xl shadow-2xs';
          themedDialogIconContainer.textContent = '🗑️';
        } else if (type === 'warning') {
          themedDialogIconContainer.className = 'w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center text-2xl shadow-2xs';
          themedDialogIconContainer.textContent = '⚠️';
        } else if (type === 'exit') {
          themedDialogIconContainer.className = 'w-12 h-12 rounded-2xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center text-2xl shadow-2xs';
          themedDialogIconContainer.textContent = '🚪';
        } else {
          themedDialogIconContainer.className = 'w-12 h-12 rounded-2xl bg-teal-50 border border-teal-200 text-teal-600 flex items-center justify-center text-2xl shadow-2xs';
          themedDialogIconContainer.textContent = 'ℹ️';
        }
      }

      if (themedDialogTitle) themedDialogTitle.textContent = title;
      if (themedDialogMessage) themedDialogMessage.textContent = message;

      if (themedDialogDetailBox) {
        if (detailText) {
          themedDialogDetailBox.classList.remove('hidden');
          themedDialogDetailBox.className = 'rounded-xl p-3 text-xs font-mono border bg-slate-50 border-slate-200 text-slate-700 whitespace-pre-line';
          themedDialogDetailBox.textContent = detailText;
        } else {
          themedDialogDetailBox.classList.add('hidden');
          themedDialogDetailBox.textContent = '';
        }
      }

      if (themedDialogButtonsContainer) {
        themedDialogButtonsContainer.innerHTML = '<button id="themed-dialog-primary-btn" type="button" class="w-full py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 active:scale-95 text-white font-bold text-xs shadow-xs transition">' + buttonText + '</button>';
        const pBtn = document.getElementById('themed-dialog-primary-btn');
        if (pBtn) pBtn.addEventListener('click', () => closeThemedDialog(true));
      }

      if (themedDialogModal) {
        themedDialogModal.classList.remove('hidden');
        themedDialogModal.style.display = 'flex';
      }
    });
  }

  function showThemedConfirm(opts) {
    return new Promise((resolve) => {
      currentDialogResolve = resolve;
      const config = typeof opts === 'string' ? { message: opts } : (opts || {});
      const title = config.title || 'Please Confirm';
      const message = config.message || '';
      const type = config.type || (config.isDestructive ? 'danger' : 'info');
      const detailText = config.detailText || '';
      const confirmText = config.confirmText || 'Confirm';
      const cancelText = config.cancelText || 'Cancel';
      const isDestructive = !!config.isDestructive;

      if (themedDialogIconContainer) {
        if (type === 'danger' || isDestructive) {
          themedDialogIconContainer.className = 'w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center text-2xl shadow-2xs';
          themedDialogIconContainer.textContent = '🗑️';
        } else if (type === 'exit') {
          themedDialogIconContainer.className = 'w-12 h-12 rounded-2xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center text-2xl shadow-2xs';
          themedDialogIconContainer.textContent = '🚪';
        } else {
          themedDialogIconContainer.className = 'w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center text-2xl shadow-2xs';
          themedDialogIconContainer.textContent = '⚠️';
        }
      }

      if (themedDialogTitle) themedDialogTitle.textContent = title;
      if (themedDialogMessage) themedDialogMessage.textContent = message;

      if (themedDialogDetailBox) {
        if (detailText) {
          themedDialogDetailBox.classList.remove('hidden');
          themedDialogDetailBox.className = isDestructive ?
            'rounded-xl p-3 text-xs font-mono border bg-rose-50 border-rose-200 text-rose-800 whitespace-pre-line' :
            'rounded-xl p-3 text-xs font-mono border bg-slate-50 border-slate-200 text-slate-700 whitespace-pre-line';
          themedDialogDetailBox.textContent = detailText;
        } else {
          themedDialogDetailBox.classList.add('hidden');
          themedDialogDetailBox.textContent = '';
        }
      }

      const confirmBtnClass = isDestructive ?
        'w-1/2 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-xs shadow-xs transition' :
        'w-1/2 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 active:scale-95 text-white font-bold text-xs shadow-xs transition';

      if (themedDialogButtonsContainer) {
        themedDialogButtonsContainer.innerHTML = '<button id="themed-dialog-cancel-btn" type="button" class="w-1/2 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 active:scale-95 text-slate-700 font-bold text-xs transition">' + cancelText + '</button><button id="themed-dialog-confirm-btn" type="button" class="' + confirmBtnClass + '">' + confirmText + '</button>';
        const cBtn = document.getElementById('themed-dialog-cancel-btn');
        if (cBtn) cBtn.addEventListener('click', () => closeThemedDialog(false));
        const confBtn = document.getElementById('themed-dialog-confirm-btn');
        if (confBtn) confBtn.addEventListener('click', () => closeThemedDialog(true));
      }

      if (themedDialogModal) {
        themedDialogModal.classList.remove('hidden');
        themedDialogModal.style.display = 'flex';
      }
    });
  }

  // --- Screen Navigation Router ---
  const views = {
    home: null,
    setup: null,
    loader: null,
    camera: null,
    results: null,
    archives: null
  };

  let appNavigationStack = ['home'];
  let currentActiveView = 'home';

  function showView(viewName, pushToStack = true) {
    currentActiveView = viewName;
    if (pushToStack) {
      if (appNavigationStack[appNavigationStack.length - 1] !== viewName) {
        appNavigationStack.push(viewName);
      }
    }

    const viewKeys = ['home', 'setup', 'loader', 'camera', 'results', 'archives'];
    viewKeys.forEach(key => {
      const el = document.getElementById('view-' + key);
      if (el) {
        if (key === viewName) {
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      }
    });

    const modePill = document.getElementById('nav-mode-pill');
    const backBtn = document.getElementById('nav-back-btn');
    const downloadAppBtn = document.getElementById('nav-download-app-btn');

    if (viewName === 'home') {
      if (backBtn) backBtn.classList.add('hidden');
      if (downloadAppBtn) downloadAppBtn.classList.remove('hidden');
      if (modePill) modePill.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse mr-1 inline-block"></span><span>Two-Stage AI Active</span>';
      if (window.RQ && window.RQ.UI && typeof window.RQ.UI.renderHomeStatsAndRecent === 'function') {
        window.RQ.UI.renderHomeStatsAndRecent();
      }
    } else {
      if (backBtn) backBtn.classList.remove('hidden');
      if (downloadAppBtn) downloadAppBtn.classList.add('hidden');
      if (viewName === 'setup') {
        if (modePill) modePill.textContent = (State.currentMode === 'lod' ? 'LoD Series Setup' : (State.currentMode === 'unknown' ? 'Unknown Setup' : 'Single Strip Setup'));
      } else if (viewName === 'loader') {
        if (modePill) modePill.textContent = 'Sample Ingestion';
      } else if (viewName === 'results') {
        if (modePill) modePill.textContent = 'Quantification Report';
      } else if (viewName === 'archives') {
        if (modePill) modePill.textContent = 'Saved Experiments';
      } else if (viewName === 'camera') {
        if (modePill) modePill.textContent = 'Live Scanner';
      }
    }
  }

  async function handleAppBackGesture() {
    const camPreviewModal = document.getElementById('cam-preview-upload-modal');
    if (camPreviewModal && !camPreviewModal.classList.contains('hidden')) {
      camPreviewModal.classList.add('hidden');
      State.pendingCapturedStrip = null;
      return true;
    }
    if (themedDialogModal && !themedDialogModal.classList.contains('hidden') && themedDialogModal.style.display !== 'none') {
      closeThemedDialog(false);
      return true;
    }
    const exportOptionsModal = document.getElementById('export-options-modal');
    if (exportOptionsModal && !exportOptionsModal.classList.contains('hidden') && exportOptionsModal.style.display !== 'none') {
      if (window.RQ && window.RQ.Storage && typeof window.RQ.Storage.closeExportDialog === 'function') {
        window.RQ.Storage.closeExportDialog();
      } else {
        exportOptionsModal.classList.add('hidden');
      }
      return true;
    }
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal && !settingsModal.classList.contains('hidden')) {
      settingsModal.classList.add('hidden');
      return true;
    }
    const figureZoomModal = document.getElementById('figure-zoom-modal');
    if (figureZoomModal && !figureZoomModal.classList.contains('hidden')) {
      figureZoomModal.classList.add('hidden');
      return true;
    }
    const cloudLinkModal = document.getElementById('cloud-link-modal');
    if (cloudLinkModal && !cloudLinkModal.classList.contains('hidden')) {
      cloudLinkModal.classList.add('hidden');
      return true;
    }

    if (currentActiveView !== 'home') {
      if (appNavigationStack.length > 1) {
        appNavigationStack.pop();
        const prevView = appNavigationStack[appNavigationStack.length - 1] || 'home';
        showView(prevView, false);
      } else {
        showView('home', false);
      }
      return true;
    }

    const shouldExit = await showThemedConfirm({
      title: 'Exit RapidQuant?',
      message: 'You have reached the first page of the app. Are you sure you want to exit?',
      type: 'exit',
      detailText: 'All your current experiment records and calibration models are safely stored in device local memory.',
      confirmText: 'Exit App',
      cancelText: 'Stay in App',
      isDestructive: false
    });

    if (shouldExit) {
      if (window.FlutterBridge && typeof window.FlutterBridge.postMessage === 'function') {
        window.FlutterBridge.postMessage(JSON.stringify({ action: 'exitApp' }));
      } else if (window.AndroidAssetBridge && typeof window.AndroidAssetBridge.exitApp === 'function') {
        window.AndroidAssetBridge.exitApp();
      } else {
        window.close();
      }
    }
    return true;
  }

  // Figure Zoom Modal
  function openFigureZoomModal(imageSrc) {
    const modal = document.getElementById('figure-zoom-modal');
    const img = document.getElementById('figure-zoom-img');
    if (modal && img && imageSrc) {
      img.src = imageSrc;
      modal.classList.remove('hidden');
    }
  }

  const figureZoomModal = document.getElementById('figure-zoom-modal');
  const closeFigureZoomBtn = document.getElementById('close-figure-zoom-btn');
  if (closeFigureZoomBtn && figureZoomModal) {
    closeFigureZoomBtn.addEventListener('click', () => {
      figureZoomModal.classList.add('hidden');
    });
    figureZoomModal.addEventListener('click', (e) => {
      if (e.target === figureZoomModal) figureZoomModal.classList.add('hidden');
    });
  }

  // App Settings Modal Controls
  const navSettingsBtn = document.getElementById('nav-settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const dismissSettingsBtn = document.getElementById('dismiss-settings-btn');

  if (navSettingsBtn && settingsModal) {
    navSettingsBtn.addEventListener('click', () => {
      settingsModal.classList.remove('hidden');
    });
  }
  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
      settingsModal.classList.add('hidden');
    });
  }
  if (dismissSettingsBtn && settingsModal) {
    dismissSettingsBtn.addEventListener('click', () => {
      settingsModal.classList.add('hidden');
    });
  }

  // Download / Install App Modal Handlers
  const downloadAppModal = document.getElementById('download-app-modal');
  const navDownloadAppBtn = document.getElementById('nav-download-app-btn');
  const closeDownloadModalBtn = document.getElementById('close-download-modal-btn');

  if (navDownloadAppBtn && downloadAppModal) {
    navDownloadAppBtn.addEventListener('click', () => {
      downloadAppModal.classList.remove('hidden');
    });
  }
  if (closeDownloadModalBtn && downloadAppModal) {
    closeDownloadModalBtn.addEventListener('click', () => {
      downloadAppModal.classList.add('hidden');
    });
    downloadAppModal.addEventListener('click', (e) => {
      if (e.target === downloadAppModal) downloadAppModal.classList.add('hidden');
    });
  }

  // Navigation Back Button & Gestures
  const navBackBtn = document.getElementById('nav-back-btn');
  if (navBackBtn) {
    navBackBtn.addEventListener('click', () => {
      handleAppBackGesture();
    });
  }

  window.addEventListener('popstate', () => {
    handleAppBackGesture();
  });

  let touchStartX = 0;
  let touchStartY = 0;
  document.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (e.changedTouches && e.changedTouches.length === 1) {
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      const deltaY = e.changedTouches[0].clientY - touchStartY;
      if (deltaX > 60 && Math.abs(deltaY) < Math.abs(deltaX) * 0.75) {
        if (touchStartX < window.innerWidth * 0.45) {
          handleAppBackGesture();
        }
      }
    }
  }, { passive: true });

  // Export module interface
  window.RQ.Core = {
    showView,
    handleAppBackGesture,
    showToast,
    showThemedAlert,
    showThemedConfirm,
    closeThemedDialog,
    openFigureZoomModal
  };

  // Backwards compatibility globals
  window.showView = showView;
  window.handleAppBackGesture = handleAppBackGesture;
  window.showToast = showToast;
  window.showThemedAlert = showThemedAlert;
  window.showThemedConfirm = showThemedConfirm;
  window.closeThemedDialog = closeThemedDialog;
  window.openFigureZoomModal = openFigureZoomModal;
  window.alert = function(msg) { return showThemedAlert(msg); };

})(typeof window !== 'undefined' ? window : globalThis);
