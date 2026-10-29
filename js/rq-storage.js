/**
 * RapidQuant - Storage & Native Document Export Module (RQ.Storage)
 * Handles LocalStorage persistence, Android ACTION_CREATE_DOCUMENT
 * Save As picker, direct MediaStore Downloads saving, and study report packaging.
 */
(function(window) {
  'use strict';

  window.RQ = window.RQ || {};

  const DB_KEY = 'lfia_experiments_v2';

  function showAppLoader(msg) {
    if (window.RQ && window.RQ.Core && typeof window.RQ.Core.showToast === 'function') {
      window.RQ.Core.showToast(msg || 'Packaging files...', 'info');
    }
  }

  function hideAppLoader() {
    // Safe no-op
  }
    function getStoredExperiments() {
      try {
        return JSON.parse(localStorage.getItem(DB_KEY) || '[]');
      } catch (e) {
        return [];
      }
    }

    function saveStoredExperiments(experiments) {
      try {
        localStorage.setItem(DB_KEY, JSON.stringify(experiments));
      } catch (e) {
        console.warn("Storage quota exceeded or error:", e);
      }
    }

    // =========================================================================
    // THEMED APPLICATION DIALOG CONTROLLER (Replaces native alert & confirm)
    // =========================================================================
    const themedDialogModal = document.getElementById('app-themed-dialog-modal');

    function downloadImage(dataUrl, filename) {
      if (!dataUrl || dataUrl === 'null' || dataUrl === 'undefined') {
        showToast("No image available to download", "amber");
        return;
      }

      // Android native direct save to Downloads
      if (window.AndroidAssetBridge && typeof window.AndroidAssetBridge.saveFileDirect === 'function') {
        const parts = dataUrl.split(',');
        const b64 = parts.length > 1 ? parts[1] : parts[0];
        const ok = window.AndroidAssetBridge.saveFileDirect(filename, b64, 'image/png');
        if (ok) {
          showToast(`💾 Saved ${filename} to Downloads`, 'teal');
        } else {
          showToast(`Could not save ${filename}`, 'rose');
        }
        return;
      }

      // Web browser / iOS fallback
      try {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast(`Downloaded ${filename}`, 'teal');
      } catch (e) {
        if (typeof window.open === 'function') window.open(dataUrl, '_blank');
      }
    }

    // --- View 6: In-App Archives & Storage View ---
    function renderArchivesView() {
      const foldersList = document.getElementById('archives-folders-list');
      const totalCount = document.getElementById('archives-total-count');
      const exps = getStoredExperiments();

      totalCount.textContent = `${exps.length} Stored Folders`;

      if (exps.length === 0) {
        foldersList.innerHTML = `
          <div class="text-center py-12 text-xs text-slate-400 border border-dashed border-slate-200 rounded-3xl bg-white p-6 space-y-3">
            <span class="text-3xl block">📁</span>
            <div>No saved experiments in storage yet.<br>Perform a Single Strip or LoD run to record data.</div>
            <button id="btn-load-demo-archives" class="px-3.5 py-2 bg-teal-50 hover:bg-teal-100 border border-teal-200 text-teal-700 font-bold rounded-xl text-xs transition">
              🧪 Load Benchmark Dataset to Test
            </button>
          </div>
        `;
        const loadDemoBtn = document.getElementById('btn-load-demo-archives');
        if (loadDemoBtn) {
          loadDemoBtn.addEventListener('click', async () => {
            await getOrInitDemoExperiment();
            renderArchivesView();
          });
        }
        return;
      }

      foldersList.innerHTML = '';
      exps.forEach((exp, idx) => {
        if (!exp.id) exp.id = 'exp_' + (exp.timestamp || exp.date || idx || Date.now());

        const folderCard = document.createElement('div');
        folderCard.className = 'bg-white border border-slate-200 rounded-3xl p-4 shadow-xs space-y-3';

        const modeBadge = exp.mode === 'lod' ? 
          '<span class="text-[9px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">LoD Calibration</span>' :
          '<span class="text-[9px] font-bold px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">Single Strip</span>';

        let lodInfo = '';
        if (exp.lodCalibration) {
          lodInfo = `<span class="text-[10px] font-bold text-purple-700 font-mono">LoD: ${exp.lodCalibration.lod_conc} ${exp.unit || 'ng/mL'} (R²=${exp.lodCalibration.r_squared})</span>`;
        }

        folderCard.innerHTML = `
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="flex items-center gap-1.5 mb-0.5">
                ${modeBadge}
                <span class="text-[10px] text-slate-400 font-mono">${exp.date ? exp.date.replace('T', ' ') : ''}</span>
              </div>
              <h4 class="text-sm font-bold text-slate-900">${exp.name || 'LFIA Experiment'}</h4>
              <p class="text-xs text-slate-500 mt-0.5">${exp.strips ? exp.strips.length : 0} Strips • ${exp.captureMolecule || 'Standard LFIA'}</p>
            </div>
            <div class="text-right">
              ${lodInfo}
            </div>
          </div>

          <div class="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
            <button class="btn-open-archive-folder text-teal-600 hover:text-teal-700 font-bold flex items-center gap-1">
              <span>📂 Open Folder</span>
            </button>
            <div class="flex items-center gap-2">
              <button class="btn-export-archive-folder text-slate-600 hover:text-teal-600 font-semibold text-[11px] px-2.5 py-1 rounded-lg hover:bg-teal-50 transition border border-slate-200 hover:border-teal-300">
                💾 Export Files
              </button>
              <button class="btn-delete-archive-folder text-rose-500 hover:text-rose-700 text-[11px] px-2 py-1 rounded-lg hover:bg-rose-50 transition">
                🗑️ Delete
              </button>
            </div>
          </div>
        `;

        // Direct event binding on each card (never fails on missing/undefined IDs)
        const exportBtn = folderCard.querySelector('.btn-export-archive-folder');
        if (exportBtn) {
          exportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            openExportDialog(exp);
          });
        }

        const openBtn = folderCard.querySelector('.btn-open-archive-folder');
        if (openBtn) {
          openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            currentResultsBundle = exp;
            displayResultsView(exp);
            showView('results');
          });
        }

        const deleteBtn = folderCard.querySelector('.btn-delete-archive-folder');
        if (deleteBtn) {
          deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            const ok = await showThemedConfirm({
              title: "Delete Experiment?",
              message: `Are you sure you want to delete '${exp.name || 'this experiment'}'?`,
              detailText: "This will permanently remove this assay and all associated strip chromatograms from local device storage.",
              confirmText: "Delete Saved Experiment",
              cancelText: "Cancel",
              isDestructive: true
            });
            if (ok) {
              let updated = getStoredExperiments().filter(item => item !== exp && item.id !== exp.id);
              saveStoredExperiments(updated);
              renderArchivesView();
              renderHomeStatsAndRecent();
            }
          });
        }

        foldersList.appendChild(folderCard);
      });
    }

    document.getElementById('archives-back-btn').addEventListener('click', () => {
      showView('home');
    });

    // Search filter in Archives
    document.getElementById('archives-search-input').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('#archives-folders-list > div').forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(q) ? 'block' : 'none';
      });
    });

    // Export All Archives (also opens the Advanced Themed Export Dialog)
    document.getElementById('archives-export-all-btn').addEventListener('click', async () => {
      let exps = getStoredExperiments();
      let exp = exps.length > 0 ? exps[0] : await getOrInitDemoExperiment();
      openExportDialog(exp);
    });

    async function getOrInitDemoExperiment() {
      let exps = getStoredExperiments();
      if (exps.length > 0) return exps[0];
      if (currentResultsBundle) return currentResultsBundle;

      // Auto-initialize benchmark dataset so user can immediately test export & folder picker on Mac/Desktop
      let demoLod = null;
      try {
        demoLod = await executeOnDeviceLoDCalibration(
          [0.0, 0.03, 0.1, 0.5, 1.0],
          [0.012, 0.038, 0.912, 0.925, 1.02],
          'LoD_Series_20261028',
          'AuNP LFIA',
          'ng/mL'
        );
      } catch (e) {
        console.warn("LoD plot gen notice:", e);
      }

      const demoExp = {
        id: 'exp_benchmark_' + Date.now(),
        name: 'LoD_Series_20261028',
        mode: 'lod',
        conc: 0.1,
        unit: 'ng/mL',
        description: 'AuNP lateral flow immunoassay 6-point concentration series calibration with 4PL curve fitting.',
        date: new Date().toISOString().slice(0, 16),
        captureMolecule: 'Anti-Analyte mAb (Test Line)',
        detectionMolecule: 'AuNP-mAb Conjugate (530 nm LSPR)',
        timestamp: new Date().toISOString(),
        strips: [
          {
            id: 'strip_demo_1',
            fileName: 'Blank_Control_AuNP.jpeg',
            assignedConc: 0.0,
            assignedUnit: 'ng/mL',
            status: 'Valid Assay',
            statusText: 'Pass (C Line Verified)',
            tcRatio: 0.0,
            calculatedConc: '0.0000',
            cArea: 152.4,
            tArea: 0.0,
            publicationPlot: (window.SAMPLE_IMAGES && window.SAMPLE_IMAGES['Blank_1_AuNP.jpeg']) ? window.SAMPLE_IMAGES['Blank_1_AuNP.jpeg'] : null,
            croppedImage: null,
            chromatogram: null
          },
          {
            id: 'strip_demo_2',
            fileName: '0.1_ng_mL_AuNP.jpeg',
            assignedConc: 0.1,
            assignedUnit: 'ng/mL',
            status: 'Valid Assay',
            statusText: 'Pass (C & T Lines Verified)',
            tcRatio: 0.9293,
            calculatedConc: '0.1070',
            cArea: 378.3,
            tArea: 365.7,
            publicationPlot: (window.SAMPLE_IMAGES && window.SAMPLE_IMAGES['0.1_1_AuNP.jpeg']) ? window.SAMPLE_IMAGES['0.1_1_AuNP.jpeg'] : null,
            croppedImage: null,
            chromatogram: null
          },
          {
            id: 'strip_demo_3',
            fileName: '0.5_ng_mL_AuNP.jpeg',
            assignedConc: 0.5,
            assignedUnit: 'ng/mL',
            status: 'Valid Assay',
            statusText: 'Pass (C & T Lines Verified)',
            tcRatio: 0.9250,
            calculatedConc: '0.4850',
            cArea: 382.1,
            tArea: 353.4,
            publicationPlot: (window.SAMPLE_IMAGES && window.SAMPLE_IMAGES['0.5_1_AuNP.jpeg']) ? window.SAMPLE_IMAGES['0.5_1_AuNP.jpeg'] : null,
            croppedImage: null,
            chromatogram: null
          },
          {
            id: 'strip_demo_4',
            fileName: '1.0_ng_mL_AuNP.jpeg',
            assignedConc: 1.0,
            assignedUnit: 'ng/mL',
            status: 'Valid Assay',
            statusText: 'Pass (C & T Lines Verified)',
            tcRatio: 0.9669,
            calculatedConc: '1.0020',
            cArea: 395.0,
            tArea: 381.9,
            publicationPlot: (window.SAMPLE_IMAGES && window.SAMPLE_IMAGES['1_1_AuNP.jpeg']) ? window.SAMPLE_IMAGES['1_1_AuNP.jpeg'] : null,
            croppedImage: null,
            chromatogram: null
          }
        ],
        lodCalibration: demoLod || {
          r_squared: '0.9872',
          lod_conc: '0.0300',
          lob_signal: 0.0210,
          lod_plot: null
        }
      };

      exps = [demoExp];
      demoExp.strips.forEach(s => {
        s.publicationPlot = createChromatogramPlotDataUrl(s, demoExp);
      });
      saveStoredExperiments(exps);
      renderHomeStatsAndRecent();
      return demoExp;
    }

    document.getElementById('home-export-all-btn').addEventListener('click', async () => {
      const exp = await getOrInitDemoExperiment();
      openExportDialog(exp);
    });

    // =========================================================================
    // NATIVE SMART SAVE / EXPORT CONTROLLER (Phone Save As, Location Memory)
    // =========================================================================
    let activeExportBundle = null;
    let selectedExportFormat = 'zip';

    // Format selection buttons
    document.querySelectorAll('.btn-save-format').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-save-format').forEach(b => {
          b.classList.remove('active', 'border-teal-500', 'bg-teal-600', 'text-white', 'shadow-2xs');
          b.classList.add('border-slate-200', 'bg-white', 'text-slate-700');
        });
        btn.classList.add('active', 'border-teal-500', 'bg-teal-600', 'text-white', 'shadow-2xs');
        btn.classList.remove('border-slate-200', 'bg-white', 'text-slate-700');
        selectedExportFormat = btn.dataset.format || 'zip';
      });
    });

    function openExportDialog(exp) {
      if (!exp) return;
      activeExportBundle = exp;

      const modal = document.getElementById('export-options-modal');
      const subtitle = document.getElementById('export-modal-subtitle');
      const prevLocBox = document.getElementById('export-previous-location-box');
      const prevLocName = document.getElementById('export-previous-location-name');
      const btnSavePrev = document.getElementById('btn-save-to-previous-location');
      const btnChooseNew = document.getElementById('btn-save-choose-new-place');

      const stripCount = (exp.strips && Array.isArray(exp.strips)) ? exp.strips.length : 0;
      if (subtitle) {
        subtitle.textContent = `${exp.name || 'Experiment'} • ${stripCount} Strip${stripCount === 1 ? '' : 's'} Ready`;
      }

      // Check for previously saved location
      const storedLocation = localStorage.getItem('rapidquant_last_save_location');
      if (storedLocation) {
        if (prevLocBox) prevLocBox.classList.remove('hidden');
        if (prevLocName) prevLocName.textContent = storedLocation;
        if (btnSavePrev) {
          btnSavePrev.classList.remove('hidden');
          btnSavePrev.innerHTML = `<span>💾</span> Save to Stored Location`;
        }
        if (btnChooseNew) {
          btnChooseNew.innerHTML = `<span>📂</span> Select New Place (Save As...)`;
        }
      } else {
        if (prevLocBox) prevLocBox.classList.add('hidden');
        if (btnSavePrev) btnSavePrev.classList.add('hidden');
        if (btnChooseNew) {
          btnChooseNew.innerHTML = `<span>📂</span> Choose Place on Phone (Save As...)`;
        }
      }

      if (modal) {
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
      }
    }

    function closeExportDialog() {
      const modal = document.getElementById('export-options-modal');
      if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
      }
      activeExportBundle = null;
    }

    const closeExportBtn = document.getElementById('close-export-modal-btn');
    if (closeExportBtn) closeExportBtn.addEventListener('click', closeExportDialog);

    const cancelExportBtn = document.getElementById('cancel-export-modal-btn');
    if (cancelExportBtn) cancelExportBtn.addEventListener('click', closeExportDialog);

    // Button: Save to Stored Location
    const btnSavePrevLoc = document.getElementById('btn-save-to-previous-location');
    if (btnSavePrevLoc) {
      btnSavePrevLoc.addEventListener('click', () => {
        executeExperimentExport(activeExportBundle, selectedExportFormat, false);
      });
    }

    // Button: Select New Place (Opens Phone Save As option)
    const btnSaveChooseNew = document.getElementById('btn-save-choose-new-place');
    if (btnSaveChooseNew) {
      btnSaveChooseNew.addEventListener('click', () => {
        executeExperimentExport(activeExportBundle, selectedExportFormat, true);
      });
    }

    // Helper: Build ZIP blob containing CSV, JSON, PNGs, and standard curve
    async function buildExperimentZipBlob(exp, safeExpName) {
      if (typeof JSZip === 'undefined') throw new Error("JSZip library not available");
      const zip = new JSZip();

      // 1. CSV Summary Text
      let csvRawText = "Experiment Name,Date,Mode,Analyte Capture,Detection Molecule\n";
      csvRawText += `\"${exp.name}\",\"${exp.date || ''}\",\"${exp.mode || ''}\",\"${exp.captureMolecule || ''}\",\"${exp.detectionMolecule || ''}\"\n\n`;
      csvRawText += "Strip Index,File Name,Assigned Conc,Calculated Conc,Status,T/C Ratio,C Area,T Area\n";
      if (exp.strips) {
        exp.strips.forEach((s, idx) => {
          csvRawText += `${idx + 1},\"${s.fileName || ''}\",${s.assignedConc || 0},${s.calculatedConc || 0},\"${s.status || ''}\",${s.tcRatio || 0},${s.cArea || 0},${s.tArea || 0}\n`;
        });
      }
      if (exp.lodCalibration) {
        csvRawText += `\nLoD Calibration Metrics:\n`;
        csvRawText += `LoD Concentration (${exp.unit || 'ng/mL'}),${exp.lodCalibration.lod_conc || 0}\n`;
        csvRawText += `LoB Signal (a.u.),${exp.lodCalibration.lob_signal || 0}\n`;
        csvRawText += `Model Fit Goodness (R^2),${exp.lodCalibration.r_squared || 0}\n`;
      }
      zip.file(`${safeExpName}_Analytical_Summary.csv`, csvRawText);

      // 2. Full JSON Dataset
      zip.file(`${safeExpName}_Full_Dataset.json`, JSON.stringify(exp, null, 2));

      // 3. 4PL / 5PL Standard Curve Plot if present
      if (exp.lodCalibration && exp.lodCalibration.lod_plot) {
        const parts = exp.lodCalibration.lod_plot.split(',');
        if (parts.length > 1) {
          zip.file(`${safeExpName}_Standard_Curve.png`, parts[1], { base64: true });
        }
      }

      // 4. Individual Strip Chromatograms & Cropped Images
      if (exp.strips && Array.isArray(exp.strips)) {
        exp.strips.forEach((s, idx) => {
          const sName = (s.fileName || `Strip_${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_');
          if (s.publicationPlot) {
            const parts = s.publicationPlot.split(',');
            if (parts.length > 1) {
              zip.file(`Strip_${idx + 1}_${sName}_Chromatogram.png`, parts[1], { base64: true });
            }
          }
          if (s.croppedImage) {
            const parts = s.croppedImage.split(',');
            if (parts.length > 1) {
              zip.file(`Strip_${idx + 1}_${sName}_Cropped.jpg`, parts[1], { base64: true });
            }
          }
        });
      }

      return await zip.generateAsync({ type: 'blob' });
    }

    // Helper: Build Combined Multi-Page PDF blob using jsPDF
    async function buildExperimentPdfBlob(exp, safeExpName) {
      if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("jsPDF library not available");
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      // Page 1: Study Summary & Standard Curve
      doc.setFillColor(13, 148, 136); // Teal 600
      doc.rect(0, 0, 210, 24, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('RAPIDQUANT — STUDY QUANTIFICATION REPORT', 14, 15);

      doc.setTextColor(30, 41, 59);
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'normal');
      doc.text(`Experiment Name: ${exp.name}`, 14, 32);
      doc.text(`Date: ${exp.date || new Date().toISOString().slice(0, 10)}   |   Mode: ${exp.mode || 'LFIA Analysis'}`, 14, 38);
      doc.text(`Total Strips Analyzed: ${exp.strips ? exp.strips.length : 0}`, 14, 44);

      let nextY = 50;
      if (exp.lodCalibration) {
        doc.setFont('helvetica', 'bold');
        doc.text(`Analytical Limits & Model Calibration:`, 14, nextY);
        doc.setFont('helvetica', 'normal');
        doc.text(`• Fit Goodness (R²): ${exp.lodCalibration.r_squared || 'N/A'}`, 18, nextY + 6);
        doc.text(`• Limit of Detection (LoD): ${exp.lodCalibration.lod_conc || 'N/A'} ${exp.unit || 'ng/mL'}`, 18, nextY + 11);
        doc.text(`• Limit of Blank (LoB Signal): ${exp.lodCalibration.lob_signal || 'N/A'} a.u.`, 18, nextY + 16);
        nextY += 22;

        if (exp.lodCalibration.lod_plot) {
          doc.addImage(exp.lodCalibration.lod_plot, 'PNG', 25, nextY, 160, 115);
          nextY += 120;
        }
      }

      // Summary Table
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('Summary Results Table:', 14, nextY + 4);
      doc.setFillColor(241, 245, 249);
      doc.rect(14, nextY + 6, 182, 7, 'F');
      doc.text('#', 16, nextY + 11);
      doc.text('Sample Filename', 25, nextY + 11);
      doc.text('Assigned', 85, nextY + 11);
      doc.text('T/C Ratio', 115, nextY + 11);
      doc.text('C Area', 145, nextY + 11);
      doc.text('Status', 170, nextY + 11);

      doc.setFont('helvetica', 'normal');
      let tableY = nextY + 18;
      if (exp.strips) {
        exp.strips.slice(0, 7).forEach((s, i) => {
          doc.text(String(i + 1), 16, tableY);
          doc.text(String(s.fileName || '').slice(0, 24), 25, tableY);
          doc.text(`${s.assignedConc || 0} ${s.assignedUnit || exp.unit || 'ng/mL'}`, 85, tableY);
          doc.text(Number(s.tcRatio || 0).toFixed(4), 115, tableY);
          doc.text(Number(s.cArea || 0).toFixed(1), 145, tableY);
          doc.text(String(s.status || 'Done'), 170, tableY);
          tableY += 6;
        });
      }

      // Subsequent Pages: Individual Strip Chromatograms
      if (exp.strips) {
        exp.strips.forEach((s, idx) => {
          doc.addPage();
          doc.setFillColor(15, 118, 110);
          doc.rect(0, 0, 210, 18, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(11);
          doc.text(`STRIP #${idx + 1}: ${s.fileName || ''}`, 14, 12);

          doc.setTextColor(30, 41, 59);
          doc.setFontSize(9.5);
          doc.text(`T/C Ratio: ${Number(s.tcRatio || 0).toFixed(4)}   |   Status: ${s.status || ''}`, 14, 25);
          doc.text(`Assigned: ${s.assignedConc || 0} ${s.assignedUnit || exp.unit || 'ng/mL'}   |   C Area: ${Number(s.cArea || 0).toFixed(1)}   |   T Area: ${Number(s.tArea || 0).toFixed(1)}`, 14, 31);

          if (s.publicationPlot) {
            doc.addImage(s.publicationPlot, 'PNG', 12, 38, 186, 92);
          }

          if (s.croppedImage) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.text('Cropped Strip Cassette Scan:', 14, 140);
            doc.addImage(s.croppedImage, 'JPEG', 85, 145, 40, 135);
          }
        });
      }

      return doc.output('blob');
    }

    // Master Export Execution: handles Phone Save As, Storage, and Location Memory
    async function executeExperimentExport(exp, format, isChoosingNewPlace) {
      if (!exp) return;
      const safeExpName = (exp.name || 'assay_01').replace(/[^a-zA-Z0-9_-]/g, '_');
      const ext = format === 'pdf_combined' ? '.pdf' : '.zip';
      const filename = `${safeExpName}_Report${ext}`;
      const mimeType = format === 'pdf_combined' ? 'application/pdf' : 'application/zip';

      showAppLoader(`Packaging ${filename}...`);

      try {
        let blob = null;
        if (format === 'pdf_combined') {
          blob = await buildExperimentPdfBlob(exp, safeExpName);
        } else {
          blob = await buildExperimentZipBlob(exp, safeExpName);
        }
        hideAppLoader();

        if (!blob) throw new Error("Failed to create export file data.");

        // Helper to convert blob to base64
        const blobToBase64 = (b) => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const res = reader.result || '';
            const idx = res.indexOf(',');
            resolve(idx >= 0 ? res.slice(idx + 1) : res);
          };
          reader.onerror = reject;
          reader.readAsDataURL(b);
        });

        // 1. Native Android Asset Bridge (Device Storage & Native Save As Picker)
        if (window.AndroidAssetBridge) {
          const b64Data = await blobToBase64(blob);

          if (isChoosingNewPlace && typeof window.AndroidAssetBridge.saveFileWithPicker === 'function') {
            window.onNativeFileSaved = async function(success, loc) {
              closeExportDialog();
              if (success) {
                const finalLoc = loc || 'Phone Storage';
                localStorage.setItem('rapidquant_last_save_location', finalLoc);
                await showThemedAlert({
                  title: "Export Complete! 💾",
                  message: `Saved '${filename}' successfully.`,
                  detailText: `📁 Location: ${finalLoc}\n✓ All CSV tables, raw JSON data, standard curve, and strip chromatograms saved.`,
                  type: "success",
                  buttonText: "OK, Done"
                });
              } else if (loc !== 'cancelled') {
                showToast("Could not save to selected location.", "rose");
              }
            };
            window.AndroidAssetBridge.saveFileWithPicker(filename, b64Data, mimeType);
            return;
          } else if (typeof window.AndroidAssetBridge.saveFileDirect === 'function') {
            const ok = window.AndroidAssetBridge.saveFileDirect(filename, b64Data, mimeType);
            closeExportDialog();
            if (ok) {
              const finalLoc = localStorage.getItem('rapidquant_last_save_location') || 'Phone Downloads';
              await showThemedAlert({
                title: "Export Complete! 💾",
                message: `Saved '${filename}' to Phone Downloads.`,
                detailText: `📁 Location: ${finalLoc}\n✓ All CSV tables, raw JSON data, standard curve, and strip chromatograms saved.`,
                type: "success",
                buttonText: "OK, Done"
              });
            } else {
              showToast("Failed to write file to storage.", "rose");
            }
            return;
          }
        }

        // 2. Desktop Chrome / Edge Native Save File Picker
        let finalSavedLocation = localStorage.getItem('rapidquant_last_save_location') || 'Phone Downloads';

        if (isChoosingNewPlace && typeof window.showSaveFilePicker === 'function') {
          try {
            const fileHandle = await window.showSaveFilePicker({
              suggestedName: filename,
              types: [{
                description: format === 'pdf_combined' ? 'PDF Report' : 'ZIP Archive',
                accept: format === 'pdf_combined' ? { 'application/pdf': ['.pdf'] } : { 'application/zip': ['.zip'] }
              }]
            });
            if (fileHandle) {
              const writable = await fileHandle.createWritable();
              await writable.write(blob);
              await writable.close();
              finalSavedLocation = fileHandle.name || 'Device Storage';
              localStorage.setItem('rapidquant_last_save_location', finalSavedLocation);
              closeExportDialog();
              await showThemedAlert({
                title: "Export Complete! 💾",
                message: `Saved '${filename}' successfully.`,
                detailText: `📁 Location: ${finalSavedLocation}\n✓ All CSV tables, raw JSON data, standard curve, and strip chromatograms saved.`,
                type: "success",
                buttonText: "OK, Done"
              });
              return;
            }
          } catch (pickerErr) {
            if (pickerErr.name === 'AbortError') return;
            console.warn("showSaveFilePicker fallback:", pickerErr);
          }
        }

        // 3. Fallback: Browser Download Trigger
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);

        closeExportDialog();
        await showThemedAlert({
          title: "Export Complete! 💾",
          message: `Saved '${filename}' successfully.`,
          detailText: `📁 Location: ${finalSavedLocation}\n✓ All CSV tables, raw JSON data, standard curve, and strip chromatograms saved.`,
          type: "success",
          buttonText: "OK, Done"
        });

      } catch (err) {
        hideAppLoader();
        console.error("Export error:", err);
        await showThemedAlert({
          title: "Export Notice",
          message: "An issue occurred while saving files.",
          detailText: err.message,
          type: "warning"
        });
      }
    }

    function exportExperimentToLocalFiles(exp) {
      openExportDialog(exp);
    }

    window.openExportDialog = openExportDialog;
    window.closeExportDialog = closeExportDialog;



  // Export module interface
  window.RQ.Storage = {
    getStoredExperiments,
    saveStoredExperiments,
    getOrInitDemoExperiment,
    renderArchivesView,
    downloadImage,
    openExportDialog,
    closeExportDialog,
    executeExperimentExport,
    buildExperimentZipBlob,
    buildExperimentPdfBlob
  };

  // Backwards compatibility globals
  window.getStoredExperiments = getStoredExperiments;
  window.saveStoredExperiments = saveStoredExperiments;
  window.getOrInitDemoExperiment = getOrInitDemoExperiment;
  window.renderArchivesView = renderArchivesView;
  window.downloadImage = downloadImage;
  window.openExportDialog = openExportDialog;
  window.closeExportDialog = closeExportDialog;
  window.executeExperimentExport = executeExperimentExport;

})(typeof window !== 'undefined' ? window : globalThis);
