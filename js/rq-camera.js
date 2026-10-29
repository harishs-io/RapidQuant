/**
 * RapidQuant - Live Camera & Hardware Bridge Module (RQ.Camera)
 * Controls WebRTC video stream, torch, autofocus, tap-to-focus,
 * and direct native Android hardware camera integration.
 */
(function(window) {
  'use strict';

  window.RQ = window.RQ || {};

  let cameraStream = null;
  let cameraFacingMode = 'environment';
  let torchActive = false;

  const cameraVideoEl = document.getElementById('camera-stream-video');
  const cameraCanvasEl = document.getElementById('camera-capture-canvas');
  const camPlaceholderEl = document.getElementById('cam-live-placeholder');
  const cameraCloseBtn = document.getElementById('camera-close-btn');
  const cameraFlipBtn = document.getElementById('camera-flip-btn');
  const camShutterBtn = document.getElementById('cam-shutter-btn');
  const cameraTorchBtn = document.getElementById('camera-torch-btn');
  const cameraErrorModal = document.getElementById('camera-error-modal');
  const cameraErrorTitle = document.getElementById('camera-error-title');
  const cameraErrorMsg = document.getElementById('camera-error-msg');
  const cameraErrorChooseFilesBtn = document.getElementById('camera-error-choose-files-btn');
  const cameraErrorDismissBtn = document.getElementById('camera-error-dismiss-btn');

  const nativeCamInput = document.getElementById('native-camera-input');
  const galleryFileInput = document.getElementById('gallery-file-input');

  function stopCameraStream() {
    try {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => {
          try { track.stop(); } catch(e) {}
        });
        cameraStream = null;
      }
      if (cameraVideoEl) {
        cameraVideoEl.srcObject = null;
        cameraVideoEl.classList.add('hidden');
      }
      if (camPlaceholderEl) {
        camPlaceholderEl.classList.remove('hidden');
      }
    } catch (e) {
      console.warn('[RQ.Camera.stopCameraStream]', e);
    }
  }

  function showCameraError(title, message) {
    stopCameraStream();
    if (cameraErrorTitle) cameraErrorTitle.textContent = title || 'Camera Not Found';
    if (cameraErrorMsg) cameraErrorMsg.textContent = message || 'No camera hardware was detected on this device, or camera access was blocked.';
    if (cameraErrorModal) cameraErrorModal.classList.remove('hidden');
  }

  if (cameraErrorDismissBtn && cameraErrorModal) {
    cameraErrorDismissBtn.addEventListener('click', () => {
      cameraErrorModal.classList.add('hidden');
    });
  }

  if (cameraErrorChooseFilesBtn && cameraErrorModal) {
    cameraErrorChooseFilesBtn.addEventListener('click', () => {
      cameraErrorModal.classList.add('hidden');
      if (galleryFileInput) {
        galleryFileInput.value = '';
        galleryFileInput.click();
      }
    });
  }

  async function openLiveCamera(facing = 'environment') {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      if (isMobile && nativeCamInput) {
        nativeCamInput.value = '';
        nativeCamInput.click();
        return;
      }
      showCameraError('Camera Access Notice', 'Camera was not accessible in this context. You can directly select strip images from your device gallery or files below.');
      return;
    }

    try {
      if (typeof navigator.mediaDevices.enumerateDevices === 'function') {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(d => d.kind === 'videoinput');
        if (videoInputs.length === 0) {
          showCameraError('Camera Not Found', 'No physical camera or webcam was detected on your device hardware.');
          return;
        }
      }

      stopCameraStream();
      cameraFacingMode = facing;

      let stream = null;
      try {
        const constraints = {
          video: {
            facingMode: { ideal: cameraFacingMode },
            width: { ideal: 1920, max: 3840 },
            height: { ideal: 1080, max: 2160 }
          },
          audio: false
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch(cErr) {
        console.warn('[RQ.Camera] High-res constraints failed, falling back to standard stream:', cErr);
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: cameraFacingMode },
          audio: false
        });
      }

      cameraStream = stream;
      if (cameraVideoEl) {
        cameraVideoEl.srcObject = stream;
        cameraVideoEl.classList.remove('hidden');
        if (camPlaceholderEl) camPlaceholderEl.classList.add('hidden');
        await cameraVideoEl.play();

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
          try {
            const caps = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
            const adv = {};
            if (caps.focusMode && caps.focusMode.includes('continuous')) {
              adv.focusMode = 'continuous';
            }
            if (caps.exposureMode && caps.exposureMode.includes('continuous')) {
              adv.exposureMode = 'continuous';
            }
            if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes('continuous')) {
              adv.whiteBalanceMode = 'continuous';
            }
            if (Object.keys(adv).length > 0) {
              await videoTrack.applyConstraints({ advanced: [adv] });
            }
          } catch(conErr) {
            console.debug('[RQ.Camera] Continuous autofocus not supported:', conErr);
          }
        }
      }
    } catch(err) {
      console.warn('[RQ.Camera] Camera permission error:', err);
      let errMsg = 'Please enable camera permissions in your browser or phone settings to scan assay strips in real-time.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errMsg = 'Camera permission was denied. Tap the lock/permissions icon in your address bar or Android settings to grant camera access.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errMsg = 'No optical camera device found. Please attach a camera or upload images from your phone gallery.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errMsg = 'Hardware camera is currently in use by another application. Please close other camera apps and retry.';
      }
      showCameraError('Camera Access Blocked', errMsg);
    }
  }

  if (cameraCloseBtn) {
    cameraCloseBtn.addEventListener('click', () => {
      stopCameraStream();
      if (window.RQ && window.RQ.Core) {
        window.RQ.Core.showView('loader');
      } else if (typeof window.showView === 'function') {
        window.showView('loader');
      }
    });
  }

  if (cameraTorchBtn) {
    cameraTorchBtn.addEventListener('click', async () => {
      if (!cameraStream) return;
      const track = cameraStream.getVideoTracks()[0];
      if (!track || typeof track.applyConstraints !== 'function') return;
      try {
        const capabilities = track.getCapabilities ? track.getCapabilities() : {};
        if (!capabilities.torch) {
          if (window.RQ && window.RQ.Core) window.RQ.Core.showToast('Torch flashlight not supported on this lens', 'warning');
          return;
        }
        torchActive = !torchActive;
        await track.applyConstraints({
          advanced: [{ torch: torchActive }]
        });
        cameraTorchBtn.classList.toggle('bg-amber-400', torchActive);
        cameraTorchBtn.classList.toggle('text-slate-900', torchActive);
        if (window.RQ && window.RQ.Core) window.RQ.Core.showToast(torchActive ? '💡 Flashlight torch ON' : 'Flashlight torch OFF', 'teal');
      } catch(err) {
        if (window.RQ && window.RQ.Core) window.RQ.Core.showToast('Unable to toggle torch flashlight', 'warning');
      }
    });
  }

  if (cameraVideoEl) {
    cameraVideoEl.addEventListener('click', async (e) => {
      if (!cameraStream) return;
      const track = cameraStream.getVideoTracks()[0];
      if (!track || typeof track.applyConstraints !== 'function') return;
      try {
        const rect = cameraVideoEl.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.pointsOfInterest) {
          await track.applyConstraints({
            advanced: [{ pointsOfInterest: [{ x, y }] }]
          });
          if (window.RQ && window.RQ.Core) window.RQ.Core.showToast('🎯 Focus locked on selected point', 'teal');
        }
      } catch(err) {
        console.warn('[RQ.Camera] Tap-to-focus error:', err);
      }
    });
  }

  if (cameraFlipBtn) {
    cameraFlipBtn.addEventListener('click', () => {
      const nextFacing = (cameraFacingMode === 'environment') ? 'user' : 'environment';
      openLiveCamera(nextFacing);
    });
  }

  if (camShutterBtn) {
    camShutterBtn.addEventListener('click', () => {
      if (!cameraVideoEl || cameraVideoEl.paused || !cameraStream) {
        openLiveCamera(cameraFacingMode);
        return;
      }

      const vW = cameraVideoEl.videoWidth || 1280;
      const vH = cameraVideoEl.videoHeight || 720;
      if (cameraCanvasEl) {
        cameraCanvasEl.width = vW;
        cameraCanvasEl.height = vH;
        const ctx = cameraCanvasEl.getContext('2d');
        ctx.drawImage(cameraVideoEl, 0, 0, vW, vH);
        const snapDataUrl = cameraCanvasEl.toDataURL('image/jpeg', 0.95);

        stopCameraStream();

        if (window.RQ && window.RQ.Core) {
          window.RQ.Core.showView('loader');
        } else if (typeof window.showView === 'function') {
          window.showView('loader');
        }

        if (window.RQ && window.RQ.UI && typeof window.RQ.UI.openCamPreviewUploadModal === 'function') {
          window.RQ.UI.openCamPreviewUploadModal(null, snapDataUrl);
        } else if (typeof window.openCamPreviewUploadModal === 'function') {
          window.openCamPreviewUploadModal(null, snapDataUrl);
        }
      }
    });
  }

  function triggerNativeCameraCapture() {
    if (window.AndroidAssetBridge && typeof window.AndroidAssetBridge.launchNativeCamera === 'function') {
      window.AndroidAssetBridge.launchNativeCamera();
      return;
    }

    if (window.AndroidAssetBridge && typeof window.AndroidAssetBridge.launchNativeCamera !== 'function') {
      const apkModal = document.getElementById('native-apk-update-modal') || document.getElementById('camera-apk-update-modal');
      if (apkModal) {
        apkModal.classList.remove('hidden');
        return;
      }
    }

    if (nativeCamInput) {
      nativeCamInput.value = '';
      nativeCamInput.click();
    }
  }

  const cameraApkFallbackPickerBtn = document.getElementById('camera-apk-fallback-picker-btn');
  if (cameraApkFallbackPickerBtn) {
    cameraApkFallbackPickerBtn.addEventListener('click', () => {
      const apkModal = document.getElementById('camera-apk-update-modal');
      if (apkModal) apkModal.classList.add('hidden');
      if (nativeCamInput) {
        nativeCamInput.value = '';
        nativeCamInput.click();
      }
    });
  }

  window.onNativeCameraPhotoCaptured = function(dataUrl) {
    if (dataUrl) {
      if (window.RQ && window.RQ.UI && typeof window.RQ.UI.openCamPreviewUploadModal === 'function') {
        window.RQ.UI.openCamPreviewUploadModal(null, dataUrl);
      } else if (typeof window.openCamPreviewUploadModal === 'function') {
        window.openCamPreviewUploadModal(null, dataUrl);
      }
    }
  };

  const srcCamBtn = document.getElementById('source-camera-btn');
  if (srcCamBtn) {
    srcCamBtn.addEventListener('click', () => {
      triggerNativeCameraCapture();
    });
  }

  const btnQuickSnapStrip = document.getElementById('btn-quick-snap-strip');
  if (btnQuickSnapStrip) {
    btnQuickSnapStrip.addEventListener('click', () => {
      triggerNativeCameraCapture();
    });
  }

  const btnOpenLiveReticle = document.getElementById('btn-open-live-reticle');
  if (btnOpenLiveReticle) {
    btnOpenLiveReticle.addEventListener('click', () => {
      if (window.RQ && window.RQ.Core) {
        window.RQ.Core.showView('camera');
      } else if (typeof window.showView === 'function') {
        window.showView('camera');
      }
      openLiveCamera('environment');
    });
  }

  if (nativeCamInput) {
    nativeCamInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (re) => {
          if (window.RQ && window.RQ.UI && typeof window.RQ.UI.openCamPreviewUploadModal === 'function') {
            window.RQ.UI.openCamPreviewUploadModal(file, re.target.result);
          } else if (typeof window.openCamPreviewUploadModal === 'function') {
            window.openCamPreviewUploadModal(file, re.target.result);
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Export module interface
  window.RQ.Camera = {
    openLiveCamera,
    stopCameraStream,
    triggerNativeCameraCapture,
    showCameraError
  };

  // Backwards compatibility globals
  window.openLiveCamera = openLiveCamera;
  window.stopCameraStream = stopCameraStream;
  window.triggerNativeCameraCapture = triggerNativeCameraCapture;
  window.showCameraError = showCameraError;

})(typeof window !== 'undefined' ? window : globalThis);
