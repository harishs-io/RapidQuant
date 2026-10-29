/**
 * RapidQuant - Application Bootstrap & Event Orchestrator (RQ.Bootstrap)
 * Connects high-level workflow cards, batch execution pipeline, and initial view boot.
 */
(function(window) {
  'use strict';

  window.RQ = window.RQ || {};

  function initApp() {
    // --- Home Screen Primary Workflow Buttons ---
    const actSingle = document.getElementById('action-single-strip');
    if (actSingle) {
      actSingle.addEventListener('click', () => {
        window.RQ.State.currentMode = 'single';
        if (window.RQ.UI && window.RQ.UI.initExperimentSetupView) window.RQ.UI.initExperimentSetupView();
        if (window.RQ.Core && window.RQ.Core.showView) window.RQ.Core.showView('setup');
      });
    }

    const actLod = document.getElementById('action-lod-experiment');
    if (actLod) {
      actLod.addEventListener('click', () => {
        window.RQ.State.currentMode = 'lod';
        if (window.RQ.UI && window.RQ.UI.initExperimentSetupView) window.RQ.UI.initExperimentSetupView();
        if (window.RQ.Core && window.RQ.Core.showView) window.RQ.Core.showView('setup');
      });
    }

    const actUnknown = document.getElementById('action-unknown-quant');
    if (actUnknown) {
      actUnknown.addEventListener('click', () => {
        window.RQ.State.currentMode = 'unknown';
        if (window.RQ.UI && window.RQ.UI.initExperimentSetupView) window.RQ.UI.initExperimentSetupView();
        if (window.RQ.Core && window.RQ.Core.showView) window.RQ.Core.showView('setup');
      });
    }

    const actPrev = document.getElementById('action-view-previous-data');
    if (actPrev) {
      actPrev.addEventListener('click', () => {
        if (window.RQ.Storage && window.RQ.Storage.renderArchivesView) window.RQ.Storage.renderArchivesView();
        if (window.RQ.Core && window.RQ.Core.showView) window.RQ.Core.showView('archives');
      });
    }

    const navHome = document.getElementById('nav-home-btn');
    if (navHome) {
      navHome.addEventListener('click', () => {
        if (window.RQ.Core && window.RQ.Core.showView) window.RQ.Core.showView('home');
      });
    }

    const navArchives = document.getElementById('nav-archives-btn');
    if (navArchives) {
      navArchives.addEventListener('click', () => {
        if (window.RQ.Storage && window.RQ.Storage.renderArchivesView) window.RQ.Storage.renderArchivesView();
        if (window.RQ.Core && window.RQ.Core.showView) window.RQ.Core.showView('archives');
      });
    }

    const homeArchivesPillBtn = document.getElementById('home-archives-pill-btn');
    if (homeArchivesPillBtn) {
      homeArchivesPillBtn.addEventListener('click', () => {
        if (window.RQ.Storage && window.RQ.Storage.renderArchivesView) window.RQ.Storage.renderArchivesView();
        if (window.RQ.Core && window.RQ.Core.showView) window.RQ.Core.showView('archives');
      });
    }

    const homeSettingsPillBtn = document.getElementById('home-settings-pill-btn');
    if (homeSettingsPillBtn) {
      homeSettingsPillBtn.addEventListener('click', () => {
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) settingsModal.classList.remove('hidden');
      });
    }

    // --- Batch Execution & Two-Stage YOLO Quantification ---
    const batchHud = document.getElementById('batch-hud-overlay');
    const hudTitle = document.getElementById('hud-batch-title');
    const hudSubtitle = document.getElementById('hud-batch-subtitle');
    const startAnalysisBtn = document.getElementById('start-analysis-btn');

    if (startAnalysisBtn) {
      startAnalysisBtn.addEventListener('click', async () => {
        const loadedStrips = window.RQ.State.loadedStrips || [];
        const currentExperiment = window.RQ.State.currentExperiment || {};
        const currentMode = window.RQ.State.currentMode || 'single';

        if (loadedStrips.length === 0) return;

        if (batchHud) batchHud.classList.remove('hidden');
        if (hudTitle) hudTitle.textContent = 'Quantifying ' + (currentExperiment.name || 'Experiment');

        const analyzedStripsResults = [];

        for (let i = 0; i < loadedStrips.length; i++) {
          const item = loadedStrips[i];
          if (hudSubtitle) hudSubtitle.textContent = 'Analyzing Strip ' + (i + 1) + ' of ' + loadedStrips.length + ': ' + (item.name || '') + '...';

          const stepIds = ['step-s1', 'step-s2', 'step-s3', 'step-s4', 'step-s5', 'step-s6', 'step-s7'];
          stepIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.className = 'text-slate-400';
          });

          for (let s = 0; s < 4; s++) {
            await new Promise(r => setTimeout(r, 60));
            const el = document.getElementById(stepIds[s]);
            if (el) el.className = 'text-teal-600 font-bold';
          }

          if (hudSubtitle) hudSubtitle.textContent = 'Analyzing Strip ' + (i + 1) + ' of ' + loadedStrips.length + ' (Two-Stage YOLOv8)...';
          let apiResult = null;
          if (window.RQ.Engine && typeof window.RQ.Engine.executeOnDeviceBioanalyticalEngine === 'function') {
            apiResult = await window.RQ.Engine.executeOnDeviceBioanalyticalEngine(
              item.dataUrl,
              item.assignedConc,
              item.assignedUnit || currentExperiment.unit
            );
          } else if (typeof window.executeOnDeviceBioanalyticalEngine === 'function') {
            apiResult = await window.executeOnDeviceBioanalyticalEngine(
              item.dataUrl,
              item.assignedConc,
              item.assignedUnit || currentExperiment.unit
            );
          }

          for (let s = 4; s < 7; s++) {
            await new Promise(r => setTimeout(r, 40));
            const el = document.getElementById(stepIds[s]);
            if (el) el.className = 'text-teal-600 font-bold';
          }

          if (apiResult) {
            analyzedStripsResults.push({
              id: item.id,
              fileName: item.name,
              assignedConc: item.assignedConc,
              assignedUnit: item.assignedUnit,
              isUnknown: item.isUnknown || false,
              unknownId: item.unknownId || (item.isUnknown ? 'Sample_' + (analyzedStripsResults.length + 1) : null),
              dilutionFactor: item.dilutionFactor || 1.0,
              status: apiResult.status,
              statusText: apiResult.status_text,
              tcRatio: apiResult.tc_ratio,
              calculatedConc: apiResult.conc,
              cArea: apiResult.c_area,
              tArea: apiResult.t_area,
              publicationPlot: apiResult.publication_plot,
              croppedImage: apiResult.cropped_image,
              chromatogram: apiResult.chromatogram
            });
          }
        }

        const standardStrips = analyzedStripsResults.filter(r => !r.isUnknown);
        const unknownStrips = analyzedStripsResults.filter(r => r.isUnknown);

        let lodCalibrationResult = null;
        const calStrips = standardStrips.length >= 2 ? standardStrips : (unknownStrips.length === 0 && analyzedStripsResults.length >= 2 ? analyzedStripsResults : null);

        if (calStrips && calStrips.length >= 2) {
          if (hudSubtitle) hudSubtitle.textContent = 'Fitting Adaptive 4PL/5PL Calibration Curve via Nelder-Mead...';
          const calConcs = calStrips.map(r => (typeof r.assignedConc === 'number' ? r.assignedConc : parseFloat(r.assignedConc) || 0));
          const calTcs = calStrips.map(r => r.tcRatio);

          if (window.RQ.Engine && typeof window.RQ.Engine.executeOnDeviceLoDCalibration === 'function') {
            lodCalibrationResult = await window.RQ.Engine.executeOnDeviceLoDCalibration(
              calConcs,
              calTcs,
              currentExperiment.name || 'LFIA Experiment',
              currentExperiment.captureMolecule || 'AuNP LFIA',
              currentExperiment.unit || 'ng/mL',
              unknownStrips
            );
          } else if (typeof window.executeOnDeviceLoDCalibration === 'function') {
            lodCalibrationResult = await window.executeOnDeviceLoDCalibration(
              calConcs,
              calTcs,
              currentExperiment.name || 'LFIA Experiment',
              currentExperiment.captureMolecule || 'AuNP LFIA',
              currentExperiment.unit || 'ng/mL',
              unknownStrips
            );
          }
        }

        if (batchHud) batchHud.classList.add('hidden');

        const experimentRecord = {
          id: 'exp_' + Date.now(),
          name: currentExperiment.name,
          mode: currentMode,
          conc: currentExperiment.conc,
          unit: currentExperiment.unit,
          replicates: currentExperiment.replicates || 3,
          description: currentExperiment.description,
          date: currentExperiment.date,
          captureMolecule: currentExperiment.captureMolecule,
          detectionMolecule: currentExperiment.detectionMolecule,
          timestamp: new Date().toISOString(),
          strips: analyzedStripsResults,
          standards: standardStrips,
          unknowns: lodCalibrationResult ? lodCalibrationResult.unknown_results : unknownStrips,
          lodCalibration: lodCalibrationResult
        };

        const allExps = (window.RQ.Storage && typeof window.RQ.Storage.getStoredExperiments === 'function') ?
          window.RQ.Storage.getStoredExperiments() :
          (typeof window.getStoredExperiments === 'function' ? window.getStoredExperiments() : []);
        allExps.unshift(experimentRecord);

        if (window.RQ.Storage && typeof window.RQ.Storage.saveStoredExperiments === 'function') {
          window.RQ.Storage.saveStoredExperiments(allExps);
        } else if (typeof window.saveStoredExperiments === 'function') {
          window.saveStoredExperiments(allExps);
        }

        window.RQ.State.currentResultsBundle = experimentRecord;
        window.currentResultsBundle = experimentRecord;

        if (window.RQ.UI && typeof window.RQ.UI.displayResultsView === 'function') {
          window.RQ.UI.displayResultsView(experimentRecord);
        } else if (typeof window.displayResultsView === 'function') {
          window.displayResultsView(experimentRecord);
        }

        if (window.RQ.Core && typeof window.RQ.Core.showView === 'function') {
          window.RQ.Core.showView('results');
        } else if (typeof window.showView === 'function') {
          window.showView('results');
        }
      });
    }

    // Initial render
    if (window.RQ.UI && typeof window.RQ.UI.renderHomeStatsAndRecent === 'function') {
      window.RQ.UI.renderHomeStatsAndRecent();
    } else if (typeof window.renderHomeStatsAndRecent === 'function') {
      window.renderHomeStatsAndRecent();
    }

    if (window.RQ.Core && typeof window.RQ.Core.showView === 'function') {
      window.RQ.Core.showView('home');
    } else if (typeof window.showView === 'function') {
      window.showView('home');
    }
  }

  // Run on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

  window.RQ.Bootstrap = { initApp };

})(typeof window !== 'undefined' ? window : globalThis);
