/**
 * RapidQuant - Over-The-Air Updater & Native APK Update Manager (RQ.Updater)
 * Queries version manifests, downloads incremental analytical updates,
 * handles background silent checks, and provides progress modal.
 */
(function(window) {
  'use strict';

  window.RQ = window.RQ || {};

  const RAPIDQUANT_LOCAL_VERSION = '2.2.0';
    const GITHUB_OTA_HTML_URL = 'https://harishs-io.github.io/RapidQuant/index.html';

    function compareVersions(vA, vB) {
      const pA = String(vA).split('.').map(Number);
      const pB = String(vB).split('.').map(Number);
      for (let i = 0; i < Math.max(pA.length, pB.length); i++) {
        const numA = pA[i] || 0;
        const numB = pB[i] || 0;
        if (numA > numB) return 1;
        if (numA < numB) return -1;
      }
      return 0;
    }

    function getInstalledApkVersion() {
      if (window.AndroidAssetBridge) {
        if (typeof window.AndroidAssetBridge.getAppVersion === 'function') {
          try {
            return window.AndroidAssetBridge.getAppVersion();
          } catch (e) {
            return '2.2.0';
          }
        }
        // Native bridge exists but getAppVersion does not -> installed APK is v2.0.0
        return '2.0.0';
      }
      return null;
    }

    function showNativeApkUpdateModal(minVersion) {
      const apkModal = document.getElementById('native-apk-update-modal');
      const apkVerSpan = document.getElementById('native-apk-modal-version');
      if (apkVerSpan && minVersion) {
        apkVerSpan.textContent = `v${minVersion}`;
      }
      if (apkModal) {
        apkModal.classList.remove('hidden');
      }
    }

    async function installOtaUpdateWithProgress(targetVersion, changelog, forceCheck = false) {
      const modal = document.getElementById('ota-install-modal');
      const icon = document.getElementById('ota-modal-icon');
      const title = document.getElementById('ota-modal-title');
      const stepLabel = document.getElementById('ota-progress-step');
      const pctLabel = document.getElementById('ota-progress-pct');
      const bar = document.getElementById('ota-progress-bar');
      const restartAction = document.getElementById('ota-restart-action');
      const dismissAction = document.getElementById('ota-dismiss-action');
      const verSpan = document.getElementById('ota-modal-version');

      if (modal) modal.classList.remove('hidden');
      if (restartAction) restartAction.classList.add('hidden');
      if (dismissAction) dismissAction.classList.add('hidden');

      function setProgress(pct, msg) {
        if (pctLabel) pctLabel.textContent = `${pct}%`;
        if (bar) bar.style.width = `${pct}%`;
        if (stepLabel) stepLabel.textContent = msg;
      }

      try {
        setProgress(15, 'Connecting to update server...');
        await new Promise(r => setTimeout(r, 350));

        let versionToInstall = targetVersion;
        if (!versionToInstall || forceCheck) {
          setProgress(25, 'Querying latest release manifest...');
          const vRes = await fetch(`${GITHUB_OTA_ENDPOINT}?t=${Date.now()}`, { cache: 'no-store' });
          if (!vRes.ok) throw new Error(`Could not reach server (HTTP ${vRes.status})`);
          const manifest = await vRes.json();
          versionToInstall = manifest.version;
          if (verSpan) verSpan.textContent = `v${versionToInstall || RAPIDQUANT_LOCAL_VERSION}`;

          // Dual-Track: If native Android APK upgrade is required, open the APK modal
          const installedApk = getInstalledApkVersion();
          if (installedApk && manifest.minApkVersion && compareVersions(manifest.minApkVersion, installedApk) > 0) {
            if (modal) modal.classList.add('hidden');
            showNativeApkUpdateModal(manifest.minApkVersion);
            return;
          }

          if (!forceCheck && compareVersions(versionToInstall, RAPIDQUANT_LOCAL_VERSION) <= 0) {
            setProgress(100, `App is already up-to-date (v${RAPIDQUANT_LOCAL_VERSION})`);
            if (icon) icon.textContent = '✅';
            if (title) title.textContent = 'Up to Date!';
            if (dismissAction) dismissAction.classList.remove('hidden');
            return;
          }
        }

        if (verSpan) verSpan.textContent = `v${versionToInstall}`;
        setProgress(45, `Downloading RapidQuant v${versionToInstall}...`);
        const htmlRes = await fetch(`${GITHUB_OTA_HTML_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (!htmlRes.ok) throw new Error(`Server returned HTTP ${htmlRes.status}`);

        setProgress(70, 'Receiving analytical pipeline & scripts...');
        const newHtmlContent = await htmlRes.text();
        if (!newHtmlContent || newHtmlContent.length < 5000 || !newHtmlContent.includes('RapidQuant')) {
          throw new Error('Downloaded package failed integrity verification.');
        }

        setProgress(88, 'Writing update to local offline storage...');
        await new Promise(r => setTimeout(r, 350));

        if (window.AndroidAssetBridge && window.AndroidAssetBridge.saveOtaUpdate) {
          window.AndroidAssetBridge.saveOtaUpdate(versionToInstall, newHtmlContent);
        } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.IOSBridge) {
          window.webkit.messageHandlers.IOSBridge.postMessage({
            action: 'saveOtaUpdate',
            version: versionToInstall,
            html: newHtmlContent
          });
        } else if (window.FlutterBridge && window.FlutterBridge.postMessage) {
          window.FlutterBridge.postMessage(JSON.stringify({
            action: 'saveOtaUpdate',
            version: versionToInstall,
            html: newHtmlContent
          }));
        }

        if ('caches' in window) {
          try {
            const cacheKeys = await caches.keys();
            await Promise.all(cacheKeys.map(k => caches.delete(k)));
          } catch(e) {}
        }

        setProgress(100, `v${versionToInstall} applied! Restarting app...`);
        if (icon) icon.textContent = '✅';
        if (title) title.textContent = 'Update Complete!';
        if (restartAction) restartAction.classList.remove('hidden');

        await new Promise(r => setTimeout(r, 900));

        if (window.AndroidAssetBridge && window.AndroidAssetBridge.applyOtaUpdate) {
          window.AndroidAssetBridge.applyOtaUpdate();
        } else {
          window.location.href = window.location.pathname + '?v=' + Date.now();
        }
      } catch (err) {
        console.error('[RapidQuant OTA] Error applying update:', err);
        setProgress(0, 'Update notice: ' + err.message);
        if (icon) icon.textContent = '⚠️';
        if (title) title.textContent = 'Update Notice';
        if (dismissAction) dismissAction.classList.remove('hidden');
        showToast('Update notice: ' + err.message, 'amber');
      }
    }

    async function checkOtaUpdatesSilent() {
      if (!navigator.onLine) return;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        const res = await fetch(`${GITHUB_OTA_ENDPOINT}?t=${Date.now()}`, {
          cache: 'no-store',
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) return;
        const manifest = await res.json();

        // 1. Dual-Track Check: Native Android APK Update Required
        const installedApk = getInstalledApkVersion();
        if (installedApk && manifest.minApkVersion && compareVersions(manifest.minApkVersion, installedApk) > 0) {
          console.log(`[RapidQuant Updates] Native APK upgrade required: v${manifest.minApkVersion} (installed: v${installedApk})`);
          showNativeApkUpdateModal(manifest.minApkVersion);
          return;
        }

        // 2. Track 1: Routine OTA Web/Algorithm Update
        if (manifest.version && compareVersions(manifest.version, RAPIDQUANT_LOCAL_VERSION) > 0) {
          console.log(`[RapidQuant OTA] Newer version found: v${manifest.version} (current: v${RAPIDQUANT_LOCAL_VERSION})`);

          // Show non-intrusive update banner
          const otaBanner = document.getElementById('ota-update-banner');
          const otaTag = document.getElementById('ota-version-tag');
          const otaChangelog = document.getElementById('ota-changelog-text');
          const otaApplyBtn = document.getElementById('ota-apply-btn');
          const otaDismissBtn = document.getElementById('ota-dismiss-btn');

          if (otaBanner && otaTag) {
            otaTag.textContent = `v${manifest.version}`;
            if (otaChangelog && manifest.changelog) {
              otaChangelog.textContent = manifest.changelog;
            }
            otaBanner.classList.remove('hidden');

            if (otaApplyBtn) {
              otaApplyBtn.onclick = () => {
                installOtaUpdateWithProgress(manifest.version, manifest.changelog, false);
              };
            }

            if (otaDismissBtn) {
              otaDismissBtn.onclick = () => {
                otaBanner.classList.add('hidden');
              };
            }
          }
        }
      } catch (e) {
        console.debug('[RapidQuant OTA] Background check bypassed:', e.message);
      }
    }

    // Connect close button on OTA modal
    const otaModalCloseBtn = document.getElementById('ota-modal-close-btn');
    if (otaModalCloseBtn) {
      otaModalCloseBtn.addEventListener('click', () => {
        const modal = document.getElementById('ota-install-modal');
        if (modal) modal.classList.add('hidden');
      });
    }

    // Connect dismiss button on native APK update modal
    const nativeApkDismissBtn = document.getElementById('native-apk-dismiss-btn');
    if (nativeApkDismissBtn) {
      nativeApkDismissBtn.addEventListener('click', () => {
        const modal = document.getElementById('native-apk-update-modal');
        if (modal) modal.classList.add('hidden');
      });
    }

    // Connect home check-update chip
    const homeCheckUpdateChip = document.getElementById('home-check-update-chip');
    if (homeCheckUpdateChip) {
      homeCheckUpdateChip.addEventListener('click', () => {
        installOtaUpdateWithProgress(null, null, true);
      });
    }

    // Connect settings check-update button
    const settingsCheckUpdateBtn = document.getElementById('settings-check-update-btn');
    if (settingsCheckUpdateBtn) {
      settingsCheckUpdateBtn.addEventListener('click', () => {
        const setModal = document.getElementById('settings-modal');
        if (setModal) setModal.classList.add('hidden');
        installOtaUpdateWithProgress(null, null, true);
      });
    }

    // Launch OTA check 1.5s after initial UI render (Zero latency impact)
    setTimeout(checkOtaUpdatesSilent, 1500);

    // Download / Install App Modal Handlers


  // Export module interface
  window.RQ.Updater = {
    compareVersions,
    getInstalledApkVersion,
    showNativeApkUpdateModal,
    installOtaUpdateWithProgress,
    checkOtaUpdatesSilent
  };

  // Backwards compatibility globals
  window.compareVersions = compareVersions;
  window.getInstalledApkVersion = getInstalledApkVersion;
  window.showNativeApkUpdateModal = showNativeApkUpdateModal;
  window.installOtaUpdateWithProgress = installOtaUpdateWithProgress;
  window.checkOtaUpdatesSilent = checkOtaUpdatesSilent;

})(typeof window !== 'undefined' ? window : globalThis);
