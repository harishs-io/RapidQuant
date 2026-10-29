/**
 * RapidQuant - UI Views Controller Module (RQ.UI)
 * Handles Experiment Setup form, Sample Ingestion Hub, Batch File Manager,
 * Camera Preview modal, Results View rendering, and Home screen stats.
 */
(function(window) {
  'use strict';

  window.RQ = window.RQ || {};

  const nativeCamInput = document.getElementById('native-camera-input');
  const galleryFileInput = document.getElementById('gallery-file-input');
  const folderFileInput = document.getElementById('folder-file-input');

  function showToast(msg, type = 'info') {
    if (window.RQ && window.RQ.Core && typeof window.RQ.Core.showToast === 'function') {
      window.RQ.Core.showToast(msg, type);
    } else if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
    }
  }

  function showThemedAlert(opts) {
    if (window.RQ && window.RQ.Core && typeof window.RQ.Core.showThemedAlert === 'function') {
      return window.RQ.Core.showThemedAlert(opts);
    } else if (typeof window.showThemedAlert === 'function') {
      return window.showThemedAlert(opts);
    }
    alert(typeof opts === 'string' ? opts : ((opts && opts.message) || 'Notice'));
    return Promise.resolve();
  }

  function showView(viewName) {
    if (window.RQ && window.RQ.Core && typeof window.RQ.Core.showView === 'function') {
      window.RQ.Core.showView(viewName);
    } else if (typeof window.showView === 'function') {
      window.showView(viewName);
    }
  }

  function downloadImage(dataUrl, filename) {
    if (window.RQ && window.RQ.Storage && typeof window.RQ.Storage.downloadImage === 'function') {
      window.RQ.Storage.downloadImage(dataUrl, filename);
    } else if (typeof window.downloadImage === 'function') {
      window.downloadImage(dataUrl, filename);
    }
  }

  function openFigureZoomModal(plot) {
    if (window.RQ && window.RQ.Core && typeof window.RQ.Core.openFigureZoomModal === 'function') {
      window.RQ.Core.openFigureZoomModal(plot);
    } else if (typeof window.openFigureZoomModal === 'function') {
      window.openFigureZoomModal(plot);
    }
  }

  function createChromatogramPlotDataUrl(strip, exp) {
    if (window.RQ && window.RQ.Engine && typeof window.RQ.Engine.createChromatogramPlotDataUrl === 'function') {
      return window.RQ.Engine.createChromatogramPlotDataUrl(strip, exp);
    } else if (typeof window.createChromatogramPlotDataUrl === 'function') {
      return window.createChromatogramPlotDataUrl(strip, exp);
    }
    return '';
  }
    // --- View 2: Experiment Setup Dialog Logic ---
    const expNameInput = document.getElementById('setup-exp-name');
    const expDescInput = document.getElementById('setup-exp-desc');
    const expDateInput = document.getElementById('setup-exp-date');
    const datePickerContainer = document.getElementById('date-picker-container');
    const expCaptureInput = document.getElementById('setup-exp-capture');
    const expDetectionInput = document.getElementById('setup-exp-detection');
    const setupContinueBtn = document.getElementById('setup-continue-btn');
    const setupValidationMsg = document.getElementById('setup-validation-msg');
    const concRowsContainer = document.getElementById('setup-conc-rows-container');
    const btnAddConcRow = document.getElementById('btn-add-conc-row');
    const btnAddConcLabel = document.getElementById('btn-add-conc-label');
    const lodPresetsChips = document.getElementById('lod-presets-chips');
    const setupUnitSelect = document.getElementById('setup-unit-select');
    const setupUnitCustom = document.getElementById('setup-unit-custom');
    const setupReplicatesContainer = document.getElementById('setup-replicates-container');
    const unknownPresetsChips = document.getElementById('unknown-presets-chips');
    const btnPresetUnknownStd = document.getElementById('btn-preset-unknown-std');
    const btnPresetUnknownWide = document.getElementById('btn-preset-unknown-wide');

    let currentSetupReplicates = 3;

    function getSelectedAssayUnit() {
      if (setupUnitSelect && setupUnitSelect.value === 'custom') {
        return (setupUnitCustom && setupUnitCustom.value.trim()) || 'AU/mL';
      }
      return (setupUnitSelect && setupUnitSelect.value) || 'ng/mL';
    }

    if (setupUnitSelect) {
      setupUnitSelect.addEventListener('change', () => {
        if (setupUnitSelect.value === 'custom') {
          setupUnitCustom.classList.remove('hidden');
          setupUnitCustom.focus();
        } else {
          setupUnitCustom.classList.add('hidden');
        }
        const u = getSelectedAssayUnit();
        setupConcentrations.forEach(c => { c.unit = u; });
        renderSetupConcRows();
      });
    }

    if (setupUnitCustom) {
      setupUnitCustom.addEventListener('input', () => {
        const u = getSelectedAssayUnit();
        setupConcentrations.forEach(c => { c.unit = u; });
        renderSetupConcRows();
      });
    }

    // Replicate precision buttons
    document.querySelectorAll('.btn-rep-select').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-rep-select').forEach(b => {
          b.classList.remove('active', 'border-emerald-500', 'bg-emerald-600', 'text-white', 'shadow-2xs');
          b.classList.add('border-slate-200', 'bg-white', 'text-slate-700');
        });
        btn.classList.add('active', 'border-emerald-500', 'bg-emerald-600', 'text-white', 'shadow-2xs');
        btn.classList.remove('border-slate-200', 'bg-white', 'text-slate-700');
        currentSetupReplicates = parseInt(btn.dataset.rep) || 3;
      });
    });

    // Dynamic Concentration Levels State
    let setupConcentrations = []; // Array of { id, value, unit }

    function openCalendarPopup() {
      try {
        if (typeof expDateInput.showPicker === 'function') {
          expDateInput.showPicker();
        } else {
          expDateInput.focus();
        }
      } catch (e) {
        expDateInput.focus();
      }
    }

    if (datePickerContainer) {
      datePickerContainer.addEventListener('click', () => {
        openCalendarPopup();
      });
    }
    if (expDateInput) {
      expDateInput.addEventListener('click', () => {
        openCalendarPopup();
      });
    }

    function renderSetupConcRows() {
      if (!concRowsContainer) return;
      concRowsContainer.innerHTML = '';
      const currentUnit = getSelectedAssayUnit();
      const isUnknownMode = currentMode === 'unknown';
      const totalRows = setupConcentrations.length;

      setupConcentrations.forEach((cItem, index) => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2 bg-slate-50 border border-slate-300 rounded-xl p-1.5 shadow-2xs transition focus-within:border-teal-500 focus-within:bg-white';
        
        row.innerHTML = `
          <div class="flex items-center pl-1 shrink-0">
            <span class="text-[10px] font-bold text-slate-400 font-mono w-6 text-center">#${index + 1}</span>
          </div>
          <input type="number" step="any" value="${cItem.value}" data-id="${cItem.id}"
            class="input-conc-row-val flex-1 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500 text-slate-900 font-mono font-bold"
            placeholder="0.0">
          <span class="text-xs font-mono font-bold text-slate-700 px-2 shrink-0">${cItem.unit || currentUnit}</span>
          <button type="button" class="btn-remove-conc-row w-7 h-7 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-500 flex items-center justify-center font-bold text-sm transition"
            data-id="${cItem.id}" ${setupConcentrations.length <= 1 ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''} title="Remove concentration">
            ✕
          </button>
        `;
        concRowsContainer.appendChild(row);
      });

      // Bind row inputs
      document.querySelectorAll('.input-conc-row-val').forEach(input => {
        input.addEventListener('input', (e) => {
          const id = e.target.dataset.id;
          const val = parseFloat(e.target.value);
          const target = setupConcentrations.find(c => c.id === id);
          if (target) {
            target.value = isNaN(val) ? '' : val;
          }
          validateSetupForm();
        });
      });

      document.querySelectorAll('.btn-remove-conc-row').forEach(btn => {
        btn.addEventListener('click', () => {
          if (setupConcentrations.length <= 1) return;
          const id = btn.dataset.id;
          setupConcentrations = setupConcentrations.filter(c => c.id !== id);
          renderSetupConcRows();
          validateSetupForm();
        });
      });

      validateSetupForm();
    }

    function addSetupConcRow(defaultVal, defaultUnit) {
      const newId = 'c_' + Math.random().toString(36).substring(2, 8);
      const unit = defaultUnit || getSelectedAssayUnit();
      setupConcentrations.push({
        id: newId,
        value: (defaultVal !== undefined ? defaultVal : 1.0),
        unit: unit
      });
      renderSetupConcRows();
    }

    if (btnAddConcRow) {
      btnAddConcRow.addEventListener('click', () => {
        let nextVal = 1.0;
        if (setupConcentrations.length > 0) {
          const lastVal = parseFloat(setupConcentrations[setupConcentrations.length - 1].value) || 0.0;
          nextVal = lastVal > 0 ? parseFloat((lastVal * 2.0).toFixed(3)) : 0.1;
        }
        addSetupConcRow(nextVal);
      });
    }

    // Quick LoD Presets
    const btnQuickStdLod = document.getElementById('btn-quick-std-lod');
    if (btnQuickStdLod) {
      btnQuickStdLod.addEventListener('click', () => {
        const u = getSelectedAssayUnit();
        setupConcentrations = [
          { id: 'c0', value: 0.0, unit: u },
          { id: 'c1', value: 0.1, unit: u },
          { id: 'c2', value: 0.5, unit: u },
          { id: 'c3', value: 1.0, unit: u }
        ];
        renderSetupConcRows();
      });
    }

    const btnQuickWideLod = document.getElementById('btn-quick-wide-lod');
    if (btnQuickWideLod) {
      btnQuickWideLod.addEventListener('click', () => {
        const u = getSelectedAssayUnit();
        setupConcentrations = [
          { id: 'c0', value: 0.0, unit: u },
          { id: 'c1', value: 1.0, unit: u },
          { id: 'c2', value: 5.0, unit: u },
          { id: 'c3', value: 10.0, unit: u }
        ];
        renderSetupConcRows();
      });
    }

    if (btnPresetUnknownStd) {
      btnPresetUnknownStd.addEventListener('click', () => {
        const u = getSelectedAssayUnit();
        setupConcentrations = [
          { id: 'c0', value: 0.0, unit: u },
          { id: 'c1', value: 0.05, unit: u },
          { id: 'c2', value: 0.1, unit: u },
          { id: 'c3', value: 0.5, unit: u },
          { id: 'c4', value: 1.0, unit: u },
          { id: 'c5', value: 5.0, unit: u },
          { id: 'c6', value: 25.0, unit: u },
          { id: 'c7', value: 100.0, unit: u }
        ];
        renderSetupConcRows();
      });
    }

    if (btnPresetUnknownWide) {
      btnPresetUnknownWide.addEventListener('click', () => {
        const u = getSelectedAssayUnit();
        setupConcentrations = [
          { id: 'c0', value: 0.0, unit: u },
          { id: 'c1', value: 0.1, unit: u },
          { id: 'c2', value: 0.5, unit: u },
          { id: 'c3', value: 1.0, unit: u },
          { id: 'c4', value: 1.5, unit: u },
          { id: 'c5', value: 3.0, unit: u },
          { id: 'c6', value: 6.0, unit: u },
          { id: 'c7', value: 10.0, unit: u },
          { id: 'c8', value: 60.0, unit: u },
          { id: 'c9', value: 100.0, unit: u },
          { id: 'c10', value: 500.0, unit: u },
          { id: 'c11', value: 1000.0, unit: u },
          { id: 'c12', value: 5000.0, unit: u }
        ];
        renderSetupConcRows();
      });
    }

    function initExperimentSetupView() {
      const modeTag = document.getElementById('setup-mode-tag');
      const concLabel = document.getElementById('setup-conc-label');
      const concHelp = document.getElementById('setup-conc-help');

      // Set date to YYYY-MM-DD (NO TIME!)
      const todayDateStr = new Date().toISOString().slice(0, 10);
      expDateInput.value = todayDateStr;

      const currentUnit = getSelectedAssayUnit();

      if (currentMode === 'unknown') {
        modeTag.textContent = 'Unknown Quant Setup';
        modeTag.className = 'text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200';
        expNameInput.value = `Unknown_Assay_${todayDateStr.replace(/-/g, '')}`;
        concLabel.innerHTML = 'Calibration Standards Series (Triplicates) <span class="text-rose-500">*</span>';
        concHelp.textContent = '6–12 calibration points (n=3 replicates recommended) including 2 saturation plateau points.';
        btnAddConcLabel.textContent = 'Add Standard Concentration Level';
        lodPresetsChips.classList.add('hidden');
        if (unknownPresetsChips) unknownPresetsChips.classList.remove('hidden');
        if (setupReplicatesContainer) setupReplicatesContainer.classList.remove('hidden');

        // Initial 8-point triplicate series with 2 upper saturation anchors
        setupConcentrations = [
          { id: 'c0', value: 0.0, unit: currentUnit },
          { id: 'c1', value: 0.05, unit: currentUnit },
          { id: 'c2', value: 0.1, unit: currentUnit },
          { id: 'c3', value: 0.5, unit: currentUnit },
          { id: 'c4', value: 1.0, unit: currentUnit },
          { id: 'c5', value: 5.0, unit: currentUnit },
          { id: 'c6', value: 25.0, unit: currentUnit },
          { id: 'c7', value: 100.0, unit: currentUnit }
        ];
      } else if (currentMode === 'lod') {
        modeTag.textContent = 'LoD Calibration Setup';
        modeTag.className = 'text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200';
        expNameInput.value = `LoD_Series_${todayDateStr.replace(/-/g, '')}`;
        concLabel.innerHTML = 'Calibration Concentration Series <span class="text-rose-500">*</span>';
        concHelp.textContent = 'Define your calibration points (e.g., 0.0, 0.1, 0.5, 1.0 ng/mL). Tap + to add more.';
        btnAddConcLabel.textContent = 'Add Another Concentration Level';
        lodPresetsChips.classList.remove('hidden');
        if (unknownPresetsChips) unknownPresetsChips.classList.add('hidden');
        if (setupReplicatesContainer) setupReplicatesContainer.classList.add('hidden');

        setupConcentrations = [
          { id: 'c0', value: 0.0, unit: currentUnit },
          { id: 'c1', value: 0.1, unit: currentUnit },
          { id: 'c2', value: 0.5, unit: currentUnit },
          { id: 'c3', value: 1.0, unit: currentUnit }
        ];
      } else {
        modeTag.textContent = 'Single Strip Setup';
        modeTag.className = 'text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200';
        expNameInput.value = `Assay_Run_${todayDateStr.replace(/-/g, '')}`;
        concLabel.innerHTML = 'Target Concentration(s) <span class="text-rose-500">*</span>';
        concHelp.textContent = 'Target concentration. If analyzing multiple conditions/experiments, tap + to add more.';
        btnAddConcLabel.textContent = 'Add Another Concentration / Condition';
        lodPresetsChips.classList.add('hidden');
        if (unknownPresetsChips) unknownPresetsChips.classList.add('hidden');
        if (setupReplicatesContainer) setupReplicatesContainer.classList.add('hidden');

        setupConcentrations = [
          { id: 'c0', value: 10.0, unit: currentUnit }
        ];
      }

      renderSetupConcRows();
      validateSetupForm();
    }

    function validateSetupForm() {
      const name = expNameInput.value.trim();
      const hasValidConc = setupConcentrations.length > 0 && setupConcentrations.some(c => typeof c.value === 'number' && !isNaN(c.value));
      const isValid = (name.length > 0) && hasValidConc;

      if (isValid) {
        setupContinueBtn.disabled = false;
        setupContinueBtn.className = 'w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3.5 rounded-2xl text-xs transition shadow-md flex items-center justify-center gap-1.5 cursor-pointer active:scale-95';
        setupValidationMsg.classList.add('hidden');
      } else {
        setupContinueBtn.disabled = true;
        setupContinueBtn.className = 'w-full bg-slate-200 text-slate-400 font-bold py-3.5 rounded-2xl text-xs transition shadow-xs cursor-not-allowed flex items-center justify-center gap-1.5';
        setupValidationMsg.classList.remove('hidden');
      }
      return isValid;
    }

    expNameInput.addEventListener('input', validateSetupForm);

    document.getElementById('setup-back-btn').addEventListener('click', () => {
      showView('home');
    });

    setupContinueBtn.addEventListener('click', () => {
      if (!validateSetupForm()) return;

      const validConcs = setupConcentrations
        .filter(c => typeof c.value === 'number' && !isNaN(c.value))
        .map(c => ({ value: c.value, unit: c.unit }));

      currentExperiment = {
        name: expNameInput.value.trim(),
        concs: validConcs,
        conc: validConcs[0].value,
        unit: validConcs[0].unit,
        description: expDescInput.value.trim(),
        date: expDateInput.value,
        captureMolecule: expCaptureInput.value.trim(),
        detectionMolecule: expDetectionInput.value.trim(),
        mode: currentMode
      };

      initSampleLoaderView();
      showView('loader');
    });

    // --- View 3: Sample Loader Ingestion Hub Logic ---
    function initSampleLoaderView() {
      document.getElementById('loader-exp-name-display').textContent = currentExperiment.name;
      const modeDisp = document.getElementById('loader-mode-display');
      if (currentMode === 'lod') {
        const concSummary = currentExperiment.concs.map(c => c.value).join(', ');
        modeDisp.textContent = `LoD Series: [${concSummary}] ${currentExperiment.unit}`;
        modeDisp.className = 'text-[9px] font-mono text-purple-600 font-semibold';
      } else {
        const concSummary = currentExperiment.concs.map(c => `${c.value} ${c.unit}`).join(' / ');
        modeDisp.textContent = `Single Strip Mode (${concSummary})`;
        modeDisp.className = 'text-[9px] font-mono text-teal-600 font-semibold';
      }

      loadedStrips = [];
      renderLoadedStripsList();
    }

    document.getElementById('loader-back-btn').addEventListener('click', () => {
      showView('setup');
    });

    // Toggle Presets Drawer
    const togglePresetsBtn = document.getElementById('toggle-presets-btn');
    const presetsPillsBar = document.getElementById('presets-pills-bar');
    const presetsArrow = document.getElementById('presets-arrow');
    togglePresetsBtn.addEventListener('click', () => {
      presetsPillsBar.classList.toggle('hidden');
      presetsArrow.style.transform = presetsPillsBar.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
    });

    // Preset Pill Click
    document.querySelectorAll('.btn-preset-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const sampleKey = btn.dataset.sample;
        const concVal = parseFloat(btn.dataset.conc);
        let src = 'samples/' + sampleKey;
        if (window.SAMPLE_IMAGES && window.SAMPLE_IMAGES[sampleKey]) {
          src = window.SAMPLE_IMAGES[sampleKey];
        }

        addLoadedStripItem({
          name: sampleKey,
          size: '142 KB',
          dataUrl: src,
          assignedConc: concVal,
          assignedUnit: currentExperiment.unit
        });
      });
    });


    // Cloud Drive Link Importer Modal
    const cloudLinkModal = document.getElementById('cloud-link-modal');
    const cloudLinkInput = document.getElementById('cloud-link-input');
    const closeCloudLinkModalBtn = document.getElementById('close-cloud-link-modal-btn');
    const cancelCloudLinkBtn = document.getElementById('cancel-cloud-link-btn');
    const importCloudLinkSubmitBtn = document.getElementById('import-cloud-link-submit-btn');

    function openCloudLinkModal(serviceName) {
      cloudLinkInput.value = '';
      cloudLinkModal.classList.remove('hidden');
    }

    function closeCloudLinkModal() {
      cloudLinkModal.classList.add('hidden');
    }

    document.getElementById('source-drive-btn').addEventListener('click', () => openCloudLinkModal('Google Drive'));
    document.getElementById('source-dropbox-btn').addEventListener('click', () => openCloudLinkModal('Dropbox'));
    document.getElementById('source-onedrive-btn').addEventListener('click', () => openCloudLinkModal('Microsoft OneDrive'));

    if (closeCloudLinkModalBtn) closeCloudLinkModalBtn.addEventListener('click', closeCloudLinkModal);
    if (cancelCloudLinkBtn) cancelCloudLinkBtn.addEventListener('click', closeCloudLinkModal);
    if (importCloudLinkSubmitBtn) {
      importCloudLinkSubmitBtn.addEventListener('click', () => {
        handleCloudLinksImport(cloudLinkInput.value);
      });
    }

    // Resolves image from link and converts to base64 DataURL
    async function handleCloudLinksImport(rawText) {
      if (!rawText || !rawText.trim()) {
        showThemedAlert({
          title: "Cloud Link Required",
          message: "Please paste at least one valid Google Drive, OneDrive, or public image URL.",
          type: "warning"
        });
        return;
      }
      const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
      if (lines.length === 0) return;

      importCloudLinkSubmitBtn.disabled = true;
      importCloudLinkSubmitBtn.innerHTML = '<span>⏳</span> Loading...';

      let successCount = 0;
      for (let i = 0; i < lines.length; i++) {
        const link = lines[i];
        let fileId = null;
        let resolvedUrl = link;
        let friendlyName = `Cloud_Strip_${loadedStrips.length + 1}.jpg`;

        // Parse Google Drive
        const gDriveMatch = link.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || link.match(/id=([a-zA-Z0-9_-]+)/);
        if (gDriveMatch && gDriveMatch[1]) {
          fileId = gDriveMatch[1];
          resolvedUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
          friendlyName = `GDrive_${fileId.substring(0, 6)}.jpg`;
        } else if (link.includes('1drv.ms') || link.includes('onedrive.live.com')) {
          resolvedUrl = link.includes('?') ? `${link}&download=1` : `${link}?download=1`;
          friendlyName = `OneDrive_Strip_${loadedStrips.length + 1}.jpg`;
        } else if (link.includes('dropbox.com')) {
          resolvedUrl = link.replace('dl=0', 'dl=1').replace('www.dropbox.com', 'dl.dropboxusercontent.com');
          friendlyName = `Dropbox_Strip_${loadedStrips.length + 1}.jpg`;
        }

        try {
          let dataUrl = null;
          try {
            const resp = await fetch(resolvedUrl, { mode: 'cors' });
            if (resp.ok) {
              const blob = await resp.blob();
              dataUrl = await new Promise((res) => {
                const reader = new FileReader();
                reader.onload = () => res(reader.result);
                reader.readAsDataURL(blob);
              });
            }
          } catch (e) {}

          // 3. Image tag fallback via canvas
          if (!dataUrl) {
            dataUrl = await new Promise((res) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || img.width;
                canvas.height = img.naturalHeight || img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                res(canvas.toDataURL('image/jpeg', 0.95));
              };
              img.onerror = () => res(null);
              img.src = resolvedUrl;
            });
          }

          if (dataUrl) {
            let concHint = 1.0;
            let unitHint = 'ng/mL';
            if (currentMode === 'lod') {
              const lodRows = document.querySelectorAll('.lod-conc-input');
              if (lodRows.length > loadedStrips.length) {
                concHint = parseFloat(lodRows[loadedStrips.length].value) || 1.0;
              }
            }
            addLoadedStripItem({
              name: friendlyName,
              size: `${Math.round(dataUrl.length * 0.75 / 1024)} KB`,
              dataUrl: dataUrl,
              assignedConc: concHint,
              assignedUnit: unitHint
            });
            successCount++;
          }
        } catch (err) {
          console.warn("Failed loading cloud link:", link, err);
        }
      }

      importCloudLinkSubmitBtn.disabled = false;
      importCloudLinkSubmitBtn.innerHTML = '<span>⬇️</span> Load Image(s)';

      if (successCount > 0) {
        closeCloudLinkModal();
        showToast(`✓ Loaded ${successCount} image(s) from cloud link!`, 'teal');
      } else {
        showThemedAlert({
          title: "Cloud Import Failed",
          message: "Could not load image from the provided link.",
          detailText: "Please check:\n1. For Google Drive, ensure link sharing is set to 'Anyone with the link'\n2. The link points directly to an image (.jpg, .jpeg, .png)",
          type: "warning"
        });
      }
    }

    // Handle File Selections
    if (galleryFileInput) {
      galleryFileInput.addEventListener('change', (e) => {
        handleBatchFiles(e.target.files);
      });
    }

    if (folderFileInput) {
      folderFileInput.addEventListener('change', (e) => {
        handleBatchFiles(e.target.files);
      });
    }

    // Trigger File Picker (Device Photos / Files)
    const sourceGalleryBtn = document.getElementById('source-gallery-btn');
    if (sourceGalleryBtn) {
      sourceGalleryBtn.addEventListener('click', () => {
        if (galleryFileInput) {
          galleryFileInput.value = '';
          galleryFileInput.click();
        }
      });
    }

    // Trigger Folder Picker (Local Folder)
    const sourceFolderBtn = document.getElementById('source-folder-btn');
    if (sourceFolderBtn) {
      sourceFolderBtn.addEventListener('click', () => {
        if (folderFileInput) {
          folderFileInput.value = '';
          folderFileInput.click();
        }
      });
    }

    // Universal Batch File Processor
    async function handleBatchFiles(files) {
      if (!files || files.length === 0) return;
      const fileArr = Array.from(files);
      let loadedCount = 0;

      for (const file of fileArr) {
        if (!file || !file.name) continue;
        const rawName = file.name.trim();

        // Skip hidden and OS metadata files
        if (rawName.startsWith('.') || rawName.includes('.DS_Store') || rawName.includes('Thumbs.db')) {
          continue;
        }

        // Validate image format (.jpg, .jpeg, .png, .tif, .tiff, .bmp, .webp)
        const cleanName = rawName.toLowerCase();
        const hasImageExt = /\.(jpe?g|png|tiff?|bmp|webp|gif)$/i.test(cleanName) ||
                            /\.\s*(jpe?g|png|tiff?|bmp|webp|gif)$/i.test(rawName);
        const hasImageMime = file.type && (file.type.startsWith('image/') || file.type.includes('tiff'));

        if (!hasImageExt && !hasImageMime) {
          continue;
        }

        await new Promise((resolve) => {
          const reader = new FileReader();

          reader.onerror = () => {
            console.warn("FileReader error on file:", rawName);
            resolve();
          };

          reader.onload = async (event) => {
            try {
              let dataUrl = event.target.result;

              // Parse concentration hint from filename:
              // Matches: 0.1ng.jpeg -> 0.1, 10 ng.jpeg -> 10, 1.png -> 1, B.png / Blank.jpeg -> 0.0
              let concHint = 1.0;
              let unitHint = 'ng/mL';
              if (currentExperiment && currentExperiment.concs && currentExperiment.concs.length > 0) {
                concHint = currentExperiment.concs[0].value;
                unitHint = currentExperiment.concs[0].unit;
              }

              const baseNoExt = cleanName.replace(/\.[^/.]+$/, '').trim();
              if (/^b(\b|\.|\s|_|-|$)/i.test(baseNoExt) || /blank/i.test(baseNoExt)) {
                concHint = 0.0;
              } else {
                const match = baseNoExt.match(/^([0-9.]+)/);
                if (match && !isNaN(parseFloat(match[1]))) {
                  concHint = parseFloat(match[1]);
                }
              }

              addLoadedStripItem({
                name: rawName,
                size: `${Math.round(file.size / 1024)} KB`,
                dataUrl: dataUrl,
                assignedConc: concHint,
                assignedUnit: unitHint
              });
              loadedCount++;
            } catch (err) {
              console.error("Error reading file:", rawName, err);
            }
            resolve();
          };

          reader.readAsDataURL(file);
        });
      }

      if (loadedCount === 0) {
        showToast('⚠️ No supported images (.jpeg, .png, .jpg, .tiff) were found.', 'amber');
      } else {
        showToast(`✓ Successfully loaded ${loadedCount} strip image(s)`, 'teal');
      }
    }

    // Drag and Drop Recursive Support on the Loader View
    const dropZone = document.getElementById('view-sample-loader');
    if (dropZone) {
      ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.add('ring-2', 'ring-teal-400');
        });
      });

      ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.remove('ring-2', 'ring-teal-400');
        });
      });

      dropZone.addEventListener('drop', async (e) => {
        const dt = e.dataTransfer;
        if (!dt) return;

        if (dt.items && dt.items.length > 0) {
          const files = [];
          for (const item of Array.from(dt.items)) {
            if (typeof item.webkitGetAsEntry === 'function') {
              const entry = item.webkitGetAsEntry();
              if (entry) {
                await readEntryRecursively(entry, files);
                continue;
              }
            }
            const f = item.getAsFile ? item.getAsFile() : null;
            if (f) files.push(f);
          }
          if (files.length > 0) {
            handleBatchFiles(files);
            return;
          }
        }

        if (dt.files && dt.files.length > 0) {
          handleBatchFiles(dt.files);
        }
      });
    }

    async function readEntryRecursively(entry, fileList) {
      if (entry.isFile) {
        await new Promise(resolve => {
          entry.file(f => {
            fileList.push(f);
            resolve();
          }, () => resolve());
        });
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const entries = await new Promise(resolve => {
          dirReader.readEntries(res => resolve(res || []), () => resolve([]));
        });
        for (const subEntry of entries) {
          await readEntryRecursively(subEntry, fileList);
        }
      }
    }

    // =========================================================================
    // NATIVE CAMERA CAPTURE PREVIEW & PROGRESSIVE UPLOAD DIALOG
    // =========================================================================
    let pendingCapturedStrip = null;
    let isCapturingUnknown = false;
    let isHookDilutionCapture = false;

    const camPreviewUploadModal = document.getElementById('cam-preview-upload-modal');
    const camPreviewImg = document.getElementById('cam-preview-img');
    const camPreviewStepBadge = document.getElementById('cam-preview-step-badge');
    const camPreviewConcInput = document.getElementById('cam-preview-conc-input');
    const camPreviewUnitDisplay = document.getElementById('cam-preview-unit-display');
    const camPreviewModeTag = document.getElementById('cam-preview-mode-tag');
    const camPreviewMetaPill = document.getElementById('cam-preview-meta-pill');
    const camPreviewNextHint = document.getElementById('cam-preview-next-hint');
    const camPreviewInitialBtns = document.getElementById('cam-preview-initial-btns');
    const camPreviewNextActions = document.getElementById('cam-preview-next-actions');
    const camPreviewRetakeBtn = document.getElementById('cam-preview-retake-btn');
    const camPreviewConfirmBtn = document.getElementById('cam-preview-confirm-btn');
    const camPreviewNextCamBtn = document.getElementById('cam-preview-next-cam-btn');
    const camPreviewFinishBtn = document.getElementById('cam-preview-finish-btn');
    const camPreviewCloseBtn = document.getElementById('cam-preview-close-btn');

    const btnQuickSnapUnknown = document.getElementById('btn-quick-snap-unknown');
    if (btnQuickSnapUnknown) {
      btnQuickSnapUnknown.addEventListener('click', () => {
        isCapturingUnknown = true;
        triggerNativeCameraCapture();
      });
    }

    function openCamPreviewUploadModal(file, dataUrl) {
      if (!camPreviewUploadModal) return;

      // Reset dynamic views
      if (camPreviewNextHint) camPreviewNextHint.classList.add('hidden');
      if (camPreviewNextActions) camPreviewNextActions.classList.add('hidden');
      if (camPreviewInitialBtns) camPreviewInitialBtns.classList.remove('hidden');

      const currentIndex = loadedStrips.length;
      let defaultConc = 1.0;
      let defaultUnit = (currentExperiment && currentExperiment.unit) || 'ng/mL';

      const isUnknownCapture = isCapturingUnknown;
      isCapturingUnknown = false;

      if (isUnknownCapture) {
        if (camPreviewStepBadge) {
          camPreviewStepBadge.textContent = 'Unknown Test Sample';
          camPreviewStepBadge.className = 'text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200';
        }
        if (camPreviewModeTag) camPreviewModeTag.textContent = 'Unknown Specimen (To Quantify)';
      } else if (currentMode === 'unknown' && currentExperiment && currentExperiment.concs && currentExperiment.concs.length > 0) {
        const totalPoints = currentExperiment.concs.length;
        if (camPreviewStepBadge) {
          camPreviewStepBadge.textContent = `Standard #${currentIndex + 1} of ${totalPoints}`;
          camPreviewStepBadge.className = 'text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200';
        }
        if (camPreviewModeTag) camPreviewModeTag.textContent = 'Standard Calibration Point';

        if (currentIndex < totalPoints) {
          defaultConc = currentExperiment.concs[currentIndex].value;
          defaultUnit = currentExperiment.concs[currentIndex].unit || defaultUnit;
        } else {
          defaultConc = currentExperiment.concs[totalPoints - 1].value;
          defaultUnit = currentExperiment.concs[totalPoints - 1].unit || defaultUnit;
        }
      } else if (currentMode === 'lod' && currentExperiment && currentExperiment.concs && currentExperiment.concs.length > 0) {
        const totalPoints = currentExperiment.concs.length;
        if (camPreviewStepBadge) {
          camPreviewStepBadge.textContent = `Strip #${currentIndex + 1} of ${totalPoints}`;
          camPreviewStepBadge.className = 'text-[10px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200';
        }
        if (camPreviewModeTag) camPreviewModeTag.textContent = 'LoD Calibration Point';

        if (currentIndex < totalPoints) {
          defaultConc = currentExperiment.concs[currentIndex].value;
          defaultUnit = currentExperiment.concs[currentIndex].unit || defaultUnit;
        } else {
          defaultConc = currentExperiment.concs[totalPoints - 1].value;
          defaultUnit = currentExperiment.concs[totalPoints - 1].unit || defaultUnit;
        }
      } else {
        if (camPreviewStepBadge) {
          camPreviewStepBadge.textContent = `Strip #${currentIndex + 1}`;
          camPreviewStepBadge.className = 'text-[10px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200';
        }
        if (camPreviewModeTag) camPreviewModeTag.textContent = 'Target Concentration';
        if (currentExperiment && currentExperiment.conc != null) {
          defaultConc = currentExperiment.conc;
          defaultUnit = currentExperiment.unit || defaultUnit;
        }
      }

      if (camPreviewConcInput) camPreviewConcInput.value = defaultConc;
      if (camPreviewUnitDisplay) camPreviewUnitDisplay.textContent = defaultUnit;
      if (camPreviewImg) camPreviewImg.src = dataUrl;

      const approxKb = file ? Math.round(file.size / 1024) : Math.round(dataUrl.length * 0.75 / 1024);
      const sizeLabel = approxKb > 1024 ? (approxKb / 1024).toFixed(1) + ' MB' : approxKb + ' KB';
      if (camPreviewMetaPill) camPreviewMetaPill.textContent = `${sizeLabel} • Native Focus`;

      pendingCapturedStrip = {
        file: file,
        dataUrl: dataUrl,
        index: currentIndex,
        defaultUnit: defaultUnit,
        isUnknown: isUnknownCapture
      };

      camPreviewUploadModal.classList.remove('hidden');
    }

    // Native Camera Input Change Listener
    nativeCamInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      if (isHookDilutionCapture) {
        isHookDilutionCapture = false;
        const reader = new FileReader();
        reader.onload = async (event) => {
          await processHookDilutionStrip(event.target.result);
        };
        reader.readAsDataURL(file);
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        openCamPreviewUploadModal(file, event.target.result);
      };
      reader.readAsDataURL(file);
    });

    // Retake Button: Discards preview and immediately launches native camera again
    if (camPreviewRetakeBtn) {
      camPreviewRetakeBtn.addEventListener('click', () => {
        if (camPreviewUploadModal) camPreviewUploadModal.classList.add('hidden');
        pendingCapturedStrip = null;
        triggerNativeCameraCapture();
      });
    }

    // Close / Cancel Button
    if (camPreviewCloseBtn) {
      camPreviewCloseBtn.addEventListener('click', () => {
        if (camPreviewUploadModal) camPreviewUploadModal.classList.add('hidden');
        pendingCapturedStrip = null;
      });
    }

    // Confirm Strip Button
    if (camPreviewConfirmBtn) {
      camPreviewConfirmBtn.addEventListener('click', () => {
        if (!pendingCapturedStrip) return;

        const isUnknown = pendingCapturedStrip.isUnknown || false;
        const unknownCount = loadedStrips.filter(s => s.isUnknown).length;

        const userVal = parseFloat(camPreviewConcInput ? camPreviewConcInput.value : '');
        const finalConc = isNaN(userVal) ? 0.0 : userVal;
        const finalUnit = pendingCapturedStrip.defaultUnit || 'ng/mL';

        const rawFileName = pendingCapturedStrip.file ? pendingCapturedStrip.file.name : '';
        const assignedName = rawFileName || (isUnknown ? `Unknown_${unknownCount + 1}.jpg` : `Strip_${pendingCapturedStrip.index + 1}_${finalConc}${finalUnit}.jpg`);

        const approxKb = pendingCapturedStrip.file ? Math.round(pendingCapturedStrip.file.size / 1024) : Math.round(pendingCapturedStrip.dataUrl.length * 0.75 / 1024);
        const sizeLabel = approxKb > 1024 ? (approxKb / 1024).toFixed(1) + ' MB' : approxKb + ' KB';

        addLoadedStripItem({
          name: assignedName,
          size: sizeLabel,
          dataUrl: pendingCapturedStrip.dataUrl,
          assignedConc: finalConc,
          assignedUnit: finalUnit,
          isUnknown: isUnknown,
          unknownId: isUnknown ? `Sample_${unknownCount + 1}` : null,
          dilutionFactor: 1.0
        });

        const nextIndex = loadedStrips.length;

        // If in LoD mode and there are more concentrations to capture
        if (currentMode === 'lod' && currentExperiment && currentExperiment.concs && nextIndex < currentExperiment.concs.length) {
          const nextPt = currentExperiment.concs[nextIndex];
          if (camPreviewNextHint) {
            camPreviewNextHint.innerHTML = `✅ <strong>Strip #${nextIndex} confirmed (${finalConc} ${finalUnit})!</strong><br>Next in series: <strong>Strip #${nextIndex + 1} of ${currentExperiment.concs.length} (${nextPt.value} ${nextPt.unit})</strong>.`;
            camPreviewNextHint.classList.remove('hidden');
          }
          if (camPreviewNextCamBtn) {
            camPreviewNextCamBtn.innerHTML = `<span>📸</span> Capture Next Strip (${nextPt.value} ${nextPt.unit})`;
          }
          if (camPreviewInitialBtns) camPreviewInitialBtns.classList.add('hidden');
          if (camPreviewNextActions) camPreviewNextActions.classList.remove('hidden');
        } else {
          // Completed or Single Strip mode
          if (camPreviewUploadModal) camPreviewUploadModal.classList.add('hidden');
          pendingCapturedStrip = null;
        }
      });
    }

    // Next Strip Camera Button: Launches native camera for the next calibration point
    if (camPreviewNextCamBtn) {
      camPreviewNextCamBtn.addEventListener('click', () => {
        if (camPreviewUploadModal) camPreviewUploadModal.classList.add('hidden');
        pendingCapturedStrip = null;
        triggerNativeCameraCapture();
      });
    }

    // Finish / View Batch Button
    if (camPreviewFinishBtn) {
      camPreviewFinishBtn.addEventListener('click', () => {
        if (camPreviewUploadModal) camPreviewUploadModal.classList.add('hidden');
        pendingCapturedStrip = null;
      });
    }

    function addLoadedStripItem(item) {
      item.id = 'strip_' + Math.random().toString(36).substring(2, 9);
      loadedStrips.push(item);
      renderLoadedStripsList();
    }

    function removeLoadedStripItem(id) {
      loadedStrips = loadedStrips.filter(s => s.id !== id);
      renderLoadedStripsList();
    }

    function renderLoadedStripsList() {
      const listEl = document.getElementById('loaded-strips-list');
      const countBadge = document.getElementById('loaded-count-badge');
      const startBtn = document.getElementById('start-analysis-btn');

      countBadge.textContent = `${loadedStrips.length} Strips`;

      if (loadedStrips.length === 0) {
        listEl.innerHTML = `
          <div id="loaded-empty-msg" class="text-center py-8 text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl">
            No sample strips loaded yet.<br>Use the camera or file sources above to add strips.
          </div>
        `;
        startBtn.disabled = true;
        startBtn.className = 'w-full bg-slate-200 text-slate-400 font-bold py-3.5 rounded-2xl text-xs transition shadow-xs cursor-not-allowed flex items-center justify-center gap-1.5';
        startBtn.innerHTML = `<span>Start Quantification</span><span>⚡</span>`;
        return;
      }

      startBtn.disabled = false;
      startBtn.className = 'w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3.5 rounded-2xl text-xs transition shadow-md flex items-center justify-center gap-1.5 cursor-pointer active:scale-95';
      startBtn.innerHTML = `<span>Start Quantification (${loadedStrips.length} Strips)</span><span>⚡</span>`;

      listEl.innerHTML = '';
      loadedStrips.forEach((strip, index) => {
        const itemCard = document.createElement('div');
        itemCard.className = 'bg-slate-50 border border-slate-200 rounded-2xl p-3 flex flex-col gap-2 transition hover:bg-white shadow-2xs';

        // Top Row: File Name + Preview Button + Delete
        let topHtml = `
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <span class="text-sm">📄</span>
              <button class="btn-preview-strip text-left font-bold text-xs text-slate-800 hover:text-teal-600 truncate transition" data-id="${strip.id}" title="Click to preview image">
                ${strip.name}
              </button>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-[10px] text-slate-400 font-mono">${strip.size}</span>
              <button class="btn-preview-strip w-7 h-7 rounded-lg bg-white border border-slate-200 hover:border-teal-500 text-slate-700 flex items-center justify-center text-xs transition shadow-2xs" data-id="${strip.id}" title="Preview Image">
                👁️
              </button>
              <button class="btn-delete-strip w-7 h-7 rounded-lg bg-white border border-slate-200 hover:border-rose-500 text-rose-500 hover:bg-rose-50 flex items-center justify-center text-xs transition shadow-2xs" data-id="${strip.id}" title="Remove">
                ✕
              </button>
            </div>
          </div>
        `;

        // If Unknown Mode, LoD Mode or multiple concentrations defined in Single Strip mode:
        let assignHtml = '';
        const hasMultipleConcs = currentExperiment.concs && currentExperiment.concs.length > 1;

        if (currentMode === 'unknown') {
          if (strip.isUnknown) {
            assignHtml = `
              <div class="pt-2 border-t border-emerald-200/80 flex flex-wrap items-center justify-between gap-2 bg-emerald-50/70 p-2 rounded-xl border border-emerald-200">
                <div class="flex items-center gap-1.5 flex-1 min-w-[160px]">
                  <span class="text-[10px] font-bold text-emerald-950 flex items-center gap-1 shrink-0">
                    <span>🎯</span> Unknown ID:
                  </span>
                  <input type="text" value="${strip.unknownId || ('Sample_' + (index + 1))}" data-id="${strip.id}"
                    class="input-unknown-id flex-1 px-2 py-0.5 text-xs bg-white border border-emerald-300 rounded-lg text-emerald-950 font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500">
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <span class="text-[9.5px] font-bold text-emerald-800">Dilution:</span>
                  <select data-id="${strip.id}" class="select-unknown-df px-2 py-0.5 text-xs bg-white border border-emerald-300 rounded-lg text-emerald-900 font-bold font-mono focus:outline-none">
                    <option value="1" ${(strip.dilutionFactor === 1 || !strip.dilutionFactor) ? 'selected' : ''}>1x (Neat)</option>
                    <option value="10" ${strip.dilutionFactor === 10 ? 'selected' : ''}>10x (1:10)</option>
                    <option value="50" ${strip.dilutionFactor === 50 ? 'selected' : ''}>50x (1:50)</option>
                    <option value="100" ${strip.dilutionFactor === 100 ? 'selected' : ''}>100x (1:100)</option>
                  </select>
                  <button type="button" class="btn-toggle-strip-role text-[9.5px] font-bold text-slate-500 hover:text-slate-800 bg-white px-2 py-0.5 rounded-lg border border-slate-200 transition" data-id="${strip.id}">
                    Set as Calibrator
                  </button>
                </div>
              </div>
            `;
          } else {
            const optList = (currentExperiment.concs || []).map(c => 
              `<option value="${c.value}" ${strip.assignedConc === c.value ? 'selected' : ''}>${c.value} ${c.unit}${c.value === 0 ? ' (Blank)' : ''}</option>`
            ).join('');

            assignHtml = `
              <div class="pt-2 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2 bg-slate-100/70 p-2 rounded-xl border border-slate-200">
                <div class="flex items-center gap-1.5 flex-1 min-w-[200px]">
                  <span class="text-[10px] font-bold text-slate-700 shrink-0">Standard Calibrator:</span>
                  <input type="number" step="any" value="${strip.assignedConc}" data-id="${strip.id}"
                    class="input-strip-conc w-20 px-2 py-1 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 font-mono text-center font-bold focus:outline-none focus:ring-1 focus:ring-teal-500" placeholder="0.0">
                  <span class="text-xs font-mono font-bold text-slate-700">${strip.assignedUnit || currentExperiment.unit}</span>
                  ${optList ? `
                    <select data-id="${strip.id}" class="select-quick-level px-1.5 py-1 text-[10px] bg-teal-50 border border-teal-200 rounded-lg text-teal-800 font-semibold focus:outline-none" title="Quick pick from configured levels">
                      <option value="" disabled selected>Preset ▾</option>
                      ${optList}
                    </select>
                  ` : ''}
                </div>
                <button type="button" class="btn-toggle-strip-role text-[9.5px] font-bold text-emerald-700 hover:text-emerald-800 bg-white px-2 py-0.5 rounded-lg border border-emerald-200 transition" data-id="${strip.id}">
                  🎯 Set as Unknown
                </button>
              </div>
            `;
          }
        } else if (currentMode === 'lod' || hasMultipleConcs) {
          const optList = (currentExperiment.concs || []).map(c => 
            `<option value="${c.value}" ${strip.assignedConc === c.value ? 'selected' : ''}>${c.value} ${c.unit}${c.value === 0 ? ' (Blank)' : ''}</option>`
          ).join('');

          assignHtml = `
            <div class="pt-2 border-t border-slate-200/80 flex items-center justify-between gap-2 bg-slate-100/70 p-2 rounded-xl border border-slate-200">
              <span class="text-[10px] font-bold text-slate-700 shrink-0">Assigned Conc:</span>
              <div class="flex items-center gap-1.5 flex-1 justify-end">
                <input type="number" step="any" value="${strip.assignedConc}" data-id="${strip.id}"
                  class="input-strip-conc w-20 px-2 py-1 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 font-mono text-center font-bold focus:outline-none focus:ring-1 focus:ring-teal-500" placeholder="0.0">
                <select data-id="${strip.id}" class="select-strip-unit px-1.5 py-1 text-[11px] bg-white border border-slate-300 rounded-lg text-slate-800 font-medium focus:outline-none">
                  <option value="ng/mL" ${strip.assignedUnit === 'ng/mL' ? 'selected' : ''}>ng/mL</option>
                  <option value="µg/mL" ${strip.assignedUnit === 'µg/mL' ? 'selected' : ''}>µg/mL</option>
                  <option value="mg/mL" ${strip.assignedUnit === 'mg/mL' ? 'selected' : ''}>mg/mL</option>
                </select>
                ${optList ? `
                  <select data-id="${strip.id}" class="select-quick-level px-1.5 py-1 text-[10px] bg-teal-50 border border-teal-200 rounded-lg text-teal-800 font-semibold focus:outline-none" title="Quick pick from configured levels">
                    <option value="" disabled selected>Preset ▾</option>
                    ${optList}
                  </select>
                ` : ''}
              </div>
            </div>
          `;
        }

        itemCard.innerHTML = topHtml + assignHtml;
        listEl.appendChild(itemCard);
      });

      // Bind Preview Events
      document.querySelectorAll('.btn-preview-strip').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = btn.dataset.id;
          const strip = loadedStrips.find(s => s.id === id);
          if (strip) openImagePreviewModal(strip.name, strip.dataUrl);
        });
      });

      // Bind Delete Events
      document.querySelectorAll('.btn-delete-strip').forEach(btn => {
        btn.addEventListener('click', () => {
          removeLoadedStripItem(btn.dataset.id);
        });
      });

      // Bind Conc Inputs
      document.querySelectorAll('.input-strip-conc').forEach(inp => {
        inp.addEventListener('input', (e) => {
          const id = inp.dataset.id;
          const val = parseFloat(inp.value) || 0.0;
          const strip = loadedStrips.find(s => s.id === id);
          if (strip) strip.assignedConc = val;
        });
      });

      // Bind Unknown ID Inputs
      document.querySelectorAll('.input-unknown-id').forEach(inp => {
        inp.addEventListener('input', (e) => {
          const id = inp.dataset.id;
          const strip = loadedStrips.find(s => s.id === id);
          if (strip) strip.unknownId = e.target.value.trim();
        });
      });

      // Bind Unknown Dilution Factor Selects
      document.querySelectorAll('.select-unknown-df').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const id = sel.dataset.id;
          const strip = loadedStrips.find(s => s.id === id);
          if (strip) strip.dilutionFactor = parseFloat(e.target.value) || 1.0;
        });
      });

      // Bind Role Toggle (Standard <-> Unknown)
      document.querySelectorAll('.btn-toggle-strip-role').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const strip = loadedStrips.find(s => s.id === id);
          if (strip) {
            strip.isUnknown = !strip.isUnknown;
            if (strip.isUnknown && !strip.unknownId) {
              const uCount = loadedStrips.filter(s => s.isUnknown).length;
              strip.unknownId = `Sample_${uCount}`;
              strip.dilutionFactor = 1.0;
            }
            renderLoadedStripsList();
          }
        });
      });

      document.querySelectorAll('.select-strip-unit').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const id = sel.dataset.id;
          const strip = loadedStrips.find(s => s.id === id);
          if (strip) strip.assignedUnit = sel.value;
        });
      });

      document.querySelectorAll('.select-quick-level').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const id = sel.dataset.id;
          const val = parseFloat(sel.value);
          const strip = loadedStrips.find(s => s.id === id);
          if (strip && !isNaN(val)) {
            strip.assignedConc = val;
            renderLoadedStripsList();
          }
        });
      });
    }

    // Image Preview Modal Handlers
    const imagePreviewModal = document.getElementById('image-preview-modal');
    const previewModalFilename = document.getElementById('preview-modal-filename');
    const previewModalImg = document.getElementById('preview-modal-img');
    const closePreviewModalBtn = document.getElementById('close-preview-modal-btn');

    function openImagePreviewModal(filename, dataUrl) {
      previewModalFilename.textContent = filename;
      previewModalImg.src = dataUrl;
      imagePreviewModal.classList.remove('hidden');
    }

    closePreviewModalBtn.addEventListener('click', () => {
      imagePreviewModal.classList.add('hidden');
    });

    imagePreviewModal.addEventListener('click', (e) => {
      if (e.target === imagePreviewModal) imagePreviewModal.classList.add('hidden');
    });

    // ===================================================================
    // BUNDLED ON-DEVICE TWO-STAGE YOLOv8 QUANTIFICATION ENGINE
    // Stage 1: best_strip_detector.onnx -> Strip Localization & Spatial Cropping
    // Normalization: Analytical Standard H = 800 px (Parity with Colab & serve_mobile.py)
    // Membrane ROI: Central 70% ROI (Eliminating white plastic cassette casing dilution)
    // Stage 2: best_band_detector.onnx -> C & T Band Identification on Normalized Strip
    // Optical Densitometry: AuNP Differential Absorbance S(y) = (255-G) - (255-R) = R - G

    // --- View 5: Results View Presentation ---
    function displayResultsView(exp) {
      if (!exp) return;
      const titleEl = document.getElementById('results-exp-title');
      if (titleEl) titleEl.textContent = exp.name || 'Experiment Results';
      const modeLabel = exp.mode === 'unknown' ? 'Unknown Concentration Quantification' : (exp.mode === 'lod' ? 'LoD Calibration Series' : 'Single Strip Mode');
      const dateStr = (exp.date || '').replace('T', ' ');
      const stripCount = (exp.strips && Array.isArray(exp.strips)) ? exp.strips.length : 0;
      
      const metaEl = document.getElementById('results-exp-meta');
      if (metaEl) metaEl.textContent = `${stripCount} Strips Quantified • ${modeLabel} • ${dateStr}`;
      
      const countBadge = document.getElementById('results-strips-count-badge');
      if (countBadge) countBadge.textContent = `${stripCount} Strips`;

      const lodSection = document.getElementById('results-lod-section');
      const auditCard = document.getElementById('results-model-audit-card');

      if (exp.lodCalibration && exp.lodCalibration.lod_conc != null && exp.lodCalibration.lod_plot) {
        if (lodSection) lodSection.classList.remove('hidden');

        const lodValDisp = document.getElementById('lod-val-display');
        if (lodValDisp) lodValDisp.innerHTML = `${exp.lodCalibration.lod_conc} <span class="text-xs text-purple-300 font-normal">${exp.unit || 'ng/mL'}</span>`;
        
        const r2El = document.getElementById('lod-r2-display');
        if (r2El) {
          const r2Val = typeof exp.lodCalibration.r_squared === 'number' ? exp.lodCalibration.r_squared : parseFloat(exp.lodCalibration.r_squared || 0);
          r2El.textContent = r2Val.toFixed(4);
        }
        
        const lobDisp = document.getElementById('lod-lob-display');
        if (lobDisp) lobDisp.textContent = `Limit of Blank (LoB): ${exp.lodCalibration.lob_signal || 0} a.u.`;

        const lodImg = document.getElementById('lod-curve-img');
        if (lodImg) {
          lodImg.src = exp.lodCalibration.lod_plot;
          lodImg.onclick = () => {
            openFigureZoomModal(exp.lodCalibration.lod_plot);
          };
        }

        // Zoom button
        const zoomBtn = document.getElementById('zoom-lod-plot-btn');
        if (zoomBtn) {
          zoomBtn.onclick = () => {
            openFigureZoomModal(exp.lodCalibration.lod_plot);
          };
        }

        // Download LoD Curve PNG
        const downloadPlotBtn = document.getElementById('download-lod-plot-btn');
        if (downloadPlotBtn) {
          downloadPlotBtn.onclick = () => {
            downloadImage(exp.lodCalibration.lod_plot, `${exp.name || 'Assay'}_Standard_Curve_LoD.png`);
          };
        }

        // --- POPULATE DETAILED ANALYTICAL MODEL AUDIT CARD BELOW GRAPH ---
        if (auditCard) {
          auditCard.classList.remove('hidden');
          const cal = exp.lodCalibration;
          const selectedModel = cal.selectedModel || '4PL';

          // Model Badge & F-Test Tag
          const modelBadge = document.getElementById('audit-model-badge');
          if (modelBadge) {
            modelBadge.textContent = `${selectedModel} (${selectedModel === '5PL' ? 'Asymmetric Plateau' : 'Symmetric Logistic'})`;
            modelBadge.className = `text-[10px] font-bold px-2.5 py-0.5 rounded-full ${selectedModel === '5PL' ? 'bg-purple-50 text-purple-800 border-purple-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'} font-mono`;
          }

          const decisionTag = document.getElementById('audit-decision-tree-tag');
          if (decisionTag) {
            if (typeof cal.f_stat === 'number' && typeof cal.p_val === 'number') {
              decisionTag.textContent = `F = ${cal.f_stat.toFixed(2)}, p = ${cal.p_val < 0.001 ? '< 0.001' : cal.p_val.toFixed(3)}`;
            } else {
              decisionTag.textContent = 'Analytical Fit (CLSI EP17)';
            }
          }

          // Formula Display
          const formulaDisp = document.getElementById('audit-formula-display');
          if (formulaDisp) {
            if (Array.isArray(cal.params) && cal.params.length >= 4) {
              const [a, b, c, d] = cal.params.map(v => Number(v || 0));
              if (selectedModel === '5PL' && cal.params.length >= 5) {
                const g = Number(cal.params[4] || 1);
                formulaDisp.textContent = `y = ${d.toFixed(4)} + (${a.toFixed(4)} - ${d.toFixed(4)}) / [1 + (x / ${c.toFixed(4)})^${b.toFixed(4)}]^${g.toFixed(4)}`;
              } else {
                formulaDisp.textContent = `y = ${d.toFixed(4)} + (${a.toFixed(4)} - ${d.toFixed(4)}) / [1 + (x / ${c.toFixed(4)})^${b.toFixed(4)}]`;
              }
            } else {
              formulaDisp.textContent = 'Standard 4-Parameter Logistic (4PL) Calibration Model';
            }
          }

          const rationaleDisp = document.getElementById('audit-decision-rationale');
          if (rationaleDisp) {
            rationaleDisp.textContent = cal.rationale || '';
          }

          // Parameters Grid
          if (Array.isArray(cal.params) && cal.params.length >= 4) {
            const elA = document.getElementById('audit-param-a');
            const elB = document.getElementById('audit-param-b');
            const elC = document.getElementById('audit-param-c');
            const elD = document.getElementById('audit-param-d');
            if (elA) elA.textContent = Number(cal.params[0] || 0).toFixed(4);
            if (elB) elB.textContent = Number(cal.params[1] || 0).toFixed(4);
            if (elC) elC.textContent = `${Number(cal.params[2] || 0).toFixed(4)} ${exp.unit || ''}`;
            if (elD) elD.textContent = Number(cal.params[3] || 0).toFixed(4);
          }

          // Quantitative Boundaries
          const elLdr = document.getElementById('audit-ldr-range');
          const elSat = document.getElementById('audit-sat-threshold');
          const elLob = document.getElementById('audit-lob-val');
          const elLod = document.getElementById('audit-lod-val');
          if (elLdr) elLdr.textContent = (cal.ldr_min != null && cal.ldr_max != null) ? `${cal.ldr_min} – ${cal.ldr_max} ${exp.unit || ''}` : `0 – 10.0 ${exp.unit || ''}`;
          if (elSat) elSat.textContent = cal.sat_threshold != null ? `T/C ≥ ${cal.sat_threshold} (ULoQ: ${cal.uloq_conc || 'N/A'} ${exp.unit || ''})` : 'Monitored';
          if (elLob) elLob.textContent = `${cal.lob_signal || '0.000'} a.u.`;
          if (elLod) elLod.textContent = `${cal.lod_conc || '0.000'} ${exp.unit || ''}`;

          // Standards Back-Calculated Recovery Table
          const recoveryTbody = document.getElementById('audit-recovery-table-body');
          if (recoveryTbody) {
            recoveryTbody.innerHTML = '';
            if (Array.isArray(cal.recoveries) && cal.recoveries.length > 0) {
              cal.recoveries.forEach(rec => {
                const tr = document.createElement('tr');
                tr.className = 'hover:bg-slate-50 transition border-b border-slate-100';
                const meanTc = typeof rec.meanTc === 'number' ? rec.meanTc.toFixed(4) : (rec.meanTc || '0.0000');
                const sdTc = typeof rec.sdTc === 'number' ? rec.sdTc.toFixed(4) : (rec.sdTc || '0.0000');
                const recPct = typeof rec.recoveryPct === 'number' ? rec.recoveryPct.toFixed(1) : (rec.recoveryPct || '100.0');
                const cvPct = typeof rec.cvPct === 'number' ? rec.cvPct.toFixed(1) : (rec.cvPct || '0.0');
                tr.innerHTML = `
                  <td class="p-2 font-bold text-slate-800">${rec.nominalConc || 0} ${exp.unit || ''}${rec.nominalConc === 0 ? ' (Blank)' : ''}</td>
                  <td class="p-2">${meanTc} ± ${sdTc}</td>
                  <td class="p-2 text-teal-700 font-bold">${rec.calcConc || '0.000'} ${exp.unit || ''}</td>
                  <td class="p-2 font-bold ${rec.pass ? 'text-emerald-700' : 'text-rose-600'}">${recPct}%</td>
                  <td class="p-2 text-slate-600">${cvPct}%</td>
                  <td class="p-2"><span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${rec.pass ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">${rec.pass ? 'PASS' : 'FLAGGED'}</span></td>
                `;
                recoveryTbody.appendChild(tr);
              });
            }
          }

          // Unknown Samples Table
          const unknownSection = document.getElementById('results-unknown-batch-section');
          const unknownTbody = document.getElementById('unknown-quant-table-body');
          const unknownCountPill = document.getElementById('unknown-samples-count-pill');

          if (Array.isArray(cal.unknown_results) && cal.unknown_results.length > 0) {
            if (unknownSection) unknownSection.classList.remove('hidden');
            if (unknownCountPill) unknownCountPill.textContent = `${cal.unknown_results.length} Unknowns`;
            if (unknownTbody) {
              unknownTbody.innerHTML = '';
              cal.unknown_results.forEach(u => {
                const tr = document.createElement('tr');
                tr.className = 'hover:bg-emerald-50/40 transition border-b border-slate-100';

                const zone = u.zone || 'Quantified';
                let zoneClass = 'bg-slate-100 text-slate-700';
                if (zone.includes('Linear')) zoneClass = 'bg-emerald-50 text-emerald-800 border border-emerald-200';
                else if (zone.includes('Saturated')) zoneClass = 'bg-amber-50 text-amber-800 border border-amber-200';
                else if (u.isHookSuspect || zone.includes('Hook')) zoneClass = 'bg-rose-50 text-rose-800 border border-rose-200';

                const finalConcNum = typeof u.finalConc === 'number' ? u.finalConc : parseFloat(u.finalConc || 0);
                const ciUpperNum = typeof u.ciUpper === 'number' ? u.ciUpper : (finalConcNum * 1.05);
                const ciMargin = Math.abs(ciUpperNum - finalConcNum).toFixed(3);
                const ciDisplay = `${finalConcNum.toFixed(3)} ± ${ciMargin} ${exp.unit || ''}`;
                const tcDisplay = typeof u.tcRatio === 'number' ? u.tcRatio.toFixed(4) : (u.tcRatio || '0.0000');

                tr.innerHTML = `
                  <td class="p-2 font-bold text-slate-900">${u.sampleId || 'Sample'}</td>
                  <td class="p-2 font-mono">${tcDisplay}</td>
                  <td class="p-2 font-mono font-bold text-emerald-700">${ciDisplay}</td>
                  <td class="p-2"><span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${zoneClass}">${zone}</span></td>
                  <td class="p-2 font-mono">${u.dilutionFactor || 1.0}x</td>
                  <td class="p-2 text-center">
                    <button class="btn-verify-hook-dilution px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-sans font-bold text-[10px] shadow-2xs transition active:scale-95 cursor-pointer"
                      data-id="${u.id || ''}" data-sampleid="${u.sampleId || ''}" data-tc="${u.tcRatio || ''}">
                      🧪 Verify 1:10 Dilution
                    </button>
                  </td>
                `;
                unknownTbody.appendChild(tr);
              });

              // Bind Hook Verification Buttons
              document.querySelectorAll('.btn-verify-hook-dilution').forEach(btn => {
                btn.addEventListener('click', () => {
                  const sampleId = btn.dataset.sampleid;
                  const uRecord = cal.unknown_results.find(u => u.sampleId === sampleId || u.id === btn.dataset.id);
                  if (uRecord) openHookDilutionModal(uRecord, exp);
                });
              });
            }
          } else {
            if (unknownSection) unknownSection.classList.add('hidden');
          }
        }
      } else {
        if (lodSection) lodSection.classList.add('hidden');
        if (auditCard) auditCard.classList.add('hidden');
      }

      // Render Individual Analyzed Strips Gallery
      const gallery = document.getElementById('results-strips-gallery');
      gallery.innerHTML = '';

      exp.strips.forEach((strip, idx) => {
        if (!strip.publicationPlot || strip.publicationPlot === 'null' || strip.publicationPlot === 'undefined') {
          strip.publicationPlot = createChromatogramPlotDataUrl(strip, exp);
        }

        const card = document.createElement('div');
        card.className = 'bg-white border border-slate-200 rounded-3xl p-4 shadow-xs space-y-3';

        let badgeBg = strip.status === 'POSITIVE' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                      (strip.status === 'NEGATIVE' ? 'bg-sky-50 text-sky-800 border-sky-200' : 'bg-rose-50 text-rose-800 border-rose-200');

        card.innerHTML = `
          <!-- Strip Header -->
          <div class="flex items-center justify-between pb-2 border-b border-slate-100">
            <div>
              <div class="text-[10px] font-bold text-slate-400 font-mono">${strip.isUnknown ? '🎯 UNKNOWN TEST SAMPLE' : `STRIP #${idx + 1}`}</div>
              <h4 class="text-xs font-bold text-slate-900 truncate max-w-[200px]">${strip.fileName}</h4>
            </div>
            <span class="text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${badgeBg}">
              ${strip.status}
            </span>
          </div>

          <!-- Quantitative Metrics Row -->
          <div class="grid grid-cols-2 gap-2 text-center">
            <div class="bg-slate-50 border border-slate-200/80 rounded-xl p-2">
              <span class="text-[9px] font-bold text-slate-400 uppercase">T/C Ratio</span>
              <div class="text-lg font-black text-slate-900 font-mono mt-0.5">${Number(strip.tcRatio || 0).toFixed(4)}</div>
            </div>
            <div class="bg-slate-50 border border-slate-200/80 rounded-xl p-2">
              <span class="text-[9px] font-bold text-slate-400 uppercase">${strip.isUnknown ? 'Quantified Conc' : (exp.mode === 'lod' ? 'Assigned Conc' : 'Calculated Conc')}</span>
              <div class="text-base font-black text-teal-600 font-mono mt-0.5">
                ${strip.isUnknown ? (strip.calculatedConc != null ? Number(strip.calculatedConc).toFixed(3) : '—') : (exp.mode === 'lod' ? (strip.assignedConc != null ? strip.assignedConc : '0') : (strip.calculatedConc != null ? Number(strip.calculatedConc).toFixed(3) : (strip.assignedConc != null ? strip.assignedConc : '0.000')))} <span class="text-[10px] font-normal text-slate-500">${strip.assignedUnit || exp.unit || 'ng/mL'}</span>
              </div>
            </div>
          </div>

          <div class="flex justify-around items-center text-xs font-mono py-1 bg-slate-50 rounded-xl border border-slate-100">
            <span class="text-purple-700 font-bold">C Area: ${Number(strip.cArea || 0).toFixed(1)}</span>
            <span class="text-slate-300">|</span>
            <span class="text-blue-700 font-bold">T Area: ${Number(strip.tArea || 0).toFixed(1)}</span>
          </div>

          <!-- Publication Figure (Screenshot 2 Style) -->
          <div class="rounded-xl overflow-hidden border border-slate-200 bg-white relative group">
            <img src="${strip.publicationPlot}" class="w-full h-auto block object-contain cursor-zoom-in img-strip-plot" data-plot="${strip.publicationPlot}" alt="Chromatogram">
          </div>

          <div class="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
            <button class="btn-zoom-single-plot text-teal-600 hover:text-teal-700 font-bold" data-plot="${strip.publicationPlot}">
              🔍 Zoom Plot
            </button>
            <button class="btn-download-single-plot text-slate-600 hover:text-slate-800 font-medium" data-plot="${strip.publicationPlot}" data-filename="${strip.fileName}">
              ⬇ Download PNG
            </button>
          </div>
        `;

        gallery.appendChild(card);
      });

      // Bind Plot Zoom & Download buttons
      document.querySelectorAll('.img-strip-plot, .btn-zoom-single-plot').forEach(el => {
        el.addEventListener('click', () => {
          openFigureZoomModal(el.dataset.plot);
        });
      });

      document.querySelectorAll('.btn-download-single-plot').forEach(el => {
        el.addEventListener('click', () => {
          downloadImage(el.dataset.plot, `LFIA_${el.dataset.filename}_Plot.png`);
        });
      });
    }

    // =========================================================================
    // HOOK (PROZONE) EFFECT TWO-POINT DILUTION PARALLELISM TEST CONTROLLER
    // =========================================================================
    let currentVerifyingUnknown = null;
    let currentVerifyingExp = null;

    const hookDilutionModal = document.getElementById('hook-dilution-modal');
    const closeHookModalBtn = document.getElementById('close-hook-modal-btn');
    const hookModalSampleTitle = document.getElementById('hook-modal-sample-title');
    const hookModalNeatTc = document.getElementById('hook-modal-neat-tc');
    const btnHookSnapCamera = document.getElementById('btn-hook-snap-camera');
    const btnHookUploadFile = document.getElementById('btn-hook-upload-file');
    const hookDilutionFileInput = document.getElementById('hook-dilution-file-input');
    const hookComparisonResult = document.getElementById('hook-comparison-result');


    // --- Home Screen Stats & Recent Folders Renderer ---
    function renderHomeStatsAndRecent() {
      const exps = getStoredExperiments();
      const expCountEl = document.getElementById('stat-experiments-count');
      const stripsCountEl = document.getElementById('stat-strips-count');
      const lodCountEl = document.getElementById('stat-lod-count');
      const recentListEl = document.getElementById('home-recent-folders-list');

      if (expCountEl) expCountEl.textContent = exps.length;

      let totalStrips = 0;
      let totalLods = 0;

      exps.forEach(e => {
        totalStrips += (e.strips ? e.strips.length : 0);
        if (e.lodCalibration && e.lodCalibration.lod_plot) {
          totalLods++;
        }
      });

      if (stripsCountEl) stripsCountEl.textContent = totalStrips;
      if (lodCountEl) lodCountEl.textContent = totalLods;

      if (exps.length === 0) {
        recentListEl.innerHTML = `
          <div class="text-center py-5 text-xs text-slate-400 space-y-2">
            <div>No stored experiment records yet.<br>Start an analysis above or test with benchmark data.</div>
            <button id="btn-load-demo-home" class="px-3 py-1.5 bg-teal-50 hover:bg-teal-100 border border-teal-200 text-teal-700 font-bold rounded-xl text-[11px] transition">
              🧪 Load Benchmark Dataset to Test
            </button>
          </div>
        `;
        const loadDemoHomeBtn = document.getElementById('btn-load-demo-home');
        if (loadDemoHomeBtn) {
          loadDemoHomeBtn.addEventListener('click', async () => {
            await getOrInitDemoExperiment();
            renderHomeStatsAndRecent();
          });
        }
        return;
      }

      recentListEl.innerHTML = '';
      exps.slice(0, 3).forEach(exp => {
        const item = document.createElement('div');
        item.className = 'bg-slate-50 border border-slate-200/80 rounded-2xl p-2.5 flex items-center justify-between text-xs transition hover:bg-slate-100/80 cursor-pointer';
        item.innerHTML = `
          <div class="flex items-center gap-2">
            <span class="text-base">${exp.mode === 'lod' ? '📈' : '🔬'}</span>
            <div>
              <div class="font-bold text-slate-900">${exp.name}</div>
              <div class="text-[10px] text-slate-500 font-mono">${exp.strips ? exp.strips.length : 0} strips • ${exp.date ? exp.date.slice(0, 10) : ''}</div>
            </div>
          </div>
          <span class="text-teal-600 font-bold text-xs">Open →</span>
        `;
        item.addEventListener('click', () => {
          currentResultsBundle = exp;
          displayResultsView(exp);
          showView('results');
        });
        recentListEl.appendChild(item);
      });
    }

    // =========================================================================
    // OVER-THE-AIR (OTA) AUTO-UPDATE CONTROLLER (GitHub Pages Cloud Engine)
    // =========================================================================
    const RAPIDQUANT_LOCAL_VERSION = '2.2.0';
    const GITHUB_OTA_ENDPOINT = 'https://harishs-io.github.io/RapidQuant/version.json';


  // Export module interface
  window.RQ.UI = {
    initExperimentSetupView,
    initSampleLoaderView,
    renderSetupConcRows,
    addSetupConcRow,
    validateSetupForm,
    getSelectedAssayUnit,
    openCalendarPopup,
    openCamPreviewUploadModal,
    addLoadedStripItem,
    removeLoadedStripItem,
    renderLoadedStripsList,
    handleBatchFiles,
    openImagePreviewModal,
    displayResultsView,
    renderHomeStatsAndRecent
  };

  // Backwards compatibility globals
  window.initExperimentSetupView = initExperimentSetupView;
  window.initSampleLoaderView = initSampleLoaderView;
  window.renderSetupConcRows = renderSetupConcRows;
  window.addSetupConcRow = addSetupConcRow;
  window.validateSetupForm = validateSetupForm;
  window.getSelectedAssayUnit = getSelectedAssayUnit;
  window.openCalendarPopup = openCalendarPopup;
  window.openCamPreviewUploadModal = openCamPreviewUploadModal;
  window.addLoadedStripItem = addLoadedStripItem;
  window.removeLoadedStripItem = removeLoadedStripItem;
  window.renderLoadedStripsList = renderLoadedStripsList;
  window.handleBatchFiles = handleBatchFiles;
  window.openImagePreviewModal = openImagePreviewModal;
  window.displayResultsView = displayResultsView;
  window.renderHomeStatsAndRecent = renderHomeStatsAndRecent;

})(typeof window !== 'undefined' ? window : globalThis);
