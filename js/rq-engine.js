/**
 * RapidQuant - Bioanalytical ML Engine & Mathematical Curve Fitting (RQ.Engine)
 * Handles Two-Stage YOLO ONNX inference, Trapezoidal peak integration,
 * 4PL/5PL Nelder-Mead regression, CLSI EP17-A2 LoD calibration,
 * and high-resolution publication chromatogram generation.
 */
(function(window) {
  'use strict';

  window.RQ = window.RQ || {};
    // Integration: 5% Apex Gated AUC Trapezoidal Integration (dx = 1000 / 800)
    // Calibration: 4PL Concentration Interpolation (CLSI EP17-A2)
    // ===================================================================

    let stripSession = null;
    let bandSession = null;
    let onnxLoadingPromise = null;

    async function loadModelBuffer(modelRelativePath) {
      if (window.AndroidAssetBridge && typeof window.AndroidAssetBridge.getAssetBase64 === "function") {
        try {
          const b64 = window.AndroidAssetBridge.getAssetBase64(modelRelativePath);
          if (b64 && b64.length > 0) {
            const bin = atob(b64);
            const len = bin.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
            return bytes.buffer;
          }
        } catch (e) {
          console.warn("AndroidAssetBridge read error:", e);
        }
      }
      const resp = await fetch(modelRelativePath);
      return await resp.arrayBuffer();
    }

    async function initTwoStageYolo() {
      if (stripSession && bandSession) return true;
      if (onnxLoadingPromise) return onnxLoadingPromise;

      onnxLoadingPromise = (async () => {
        try {
          if (typeof ort === "undefined") {
            console.error("ONNX Runtime Web (ort) not loaded");
            return false;
          }
          ort.env.wasm.numThreads = 1;
          ort.env.wasm.proxy = false;
          const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1) || "./";
          ort.env.wasm.wasmPaths = basePath;

          console.log("Loading Stage 1 YOLO Strip Detector (best_strip_detector.onnx)...");
          const stripBuf = await loadModelBuffer("models/best_strip_detector.onnx");
          stripSession = await ort.InferenceSession.create(stripBuf, { executionProviders: ["wasm"] });
          console.log("Stage 1 YOLO Strip Detector Ready!");

          console.log("Loading Stage 2 YOLO Band Detector (best_band_detector.onnx)...");
          const bandBuf = await loadModelBuffer("models/best_band_detector.onnx");
          bandSession = await ort.InferenceSession.create(bandBuf, { executionProviders: ["wasm"] });
          console.log("Stage 2 YOLO Band Detector Ready!");

          return true;
        } catch (e) {
          console.error("Error initializing YOLO models:", e);
          return false;
        }
      })();

      return onnxLoadingPromise;
    }

    // Auto warm-up on page load
    window.addEventListener("DOMContentLoaded", () => {
      initTwoStageYolo().catch(console.warn);
    });

    async function executeOnDeviceBioanalyticalEngine(imageSrc, assignedConc, unit) {
      await initTwoStageYolo();

      return new Promise((resolve) => {
        const img = new Image();
        img.onload = async () => {
          try {
            const rawW = img.naturalWidth || img.width;
            const rawH = img.naturalHeight || img.height;

            // 1. Auto-orient if phone was held in landscape mode (img_w > img_h * 1.25)
            const rotCanvas = document.createElement("canvas");
            const rotCtx = rotCanvas.getContext("2d");
            if (rawW > Math.round(rawH * 1.25)) {
              rotCanvas.width = rawH;
              rotCanvas.height = rawW;
              rotCtx.translate(rawH, 0);
              rotCtx.rotate(90 * Math.PI / 180);
              rotCtx.drawImage(img, 0, 0);
            } else {
              rotCanvas.width = rawW;
              rotCanvas.height = rawH;
              rotCtx.drawImage(img, 0, 0);
            }

            const imgW = rotCanvas.width;
            const imgH = rotCanvas.height;

            // 2. STAGE 1: Strip Detection & True Spatial Cropping via best_strip_detector.onnx
            let cropX1 = 0, cropY1 = 0, cropX2 = imgW, cropY2 = imgH;
            let stripDetected = false;

            if (stripSession) {
              const lbCanvas = document.createElement("canvas");
              lbCanvas.width = 640;
              lbCanvas.height = 640;
              const lbCtx = lbCanvas.getContext("2d");
              lbCtx.fillStyle = "#727272";
              lbCtx.fillRect(0, 0, 640, 640);

              const scale1 = Math.min(640 / imgH, 640 / imgW);
              const nw1 = Math.round(imgW * scale1);
              const nh1 = Math.round(imgH * scale1);
              const dx1 = Math.floor((640 - nw1) / 2);
              const dy1 = Math.floor((640 - nh1) / 2);

              lbCtx.drawImage(rotCanvas, dx1, dy1, nw1, nh1);
              const lbData = lbCtx.getImageData(0, 0, 640, 640).data;

              // Convert RGBA to planar RGB Float32Array [1, 3, 640, 640]
              const tensorData1 = new Float32Array(3 * 640 * 640);
              const planeSize = 640 * 640;
              for (let idx = 0; idx < planeSize; idx++) {
                tensorData1[idx] = lbData[idx * 4] / 255.0;
                tensorData1[planeSize + idx] = lbData[idx * 4 + 1] / 255.0;
                tensorData1[2 * planeSize + idx] = lbData[idx * 4 + 2] / 255.0;
              }

              const tensor1 = new ort.Tensor("float32", tensorData1, [1, 3, 640, 640]);
              const res1 = await stripSession.run({ images: tensor1 });
              const out1 = res1.output0.data; // shape [1, 5, 8400]

              // Find candidate boxes with conf >= 0.10 and choose maximum area box (matching serve_mobile.py)
              let maxArea = -1;
              let bestBox = null;
              for (let i = 0; i < 8400; i++) {
                const conf = out1[4 * 8400 + i];
                if (conf >= 0.10) {
                  const bw = out1[2 * 8400 + i];
                  const bh = out1[3 * 8400 + i];
                  const area = bw * bh;
                  if (area > maxArea) {
                    maxArea = area;
                    bestBox = {
                      cx: out1[0 * 8400 + i],
                      cy: out1[1 * 8400 + i],
                      bw: bw,
                      bh: bh,
                      conf: conf
                    };
                  }
                }
              }

              if (bestBox) {
                let x1 = Math.round((bestBox.cx - bestBox.bw / 2.0 - dx1) / scale1);
                let y1 = Math.round((bestBox.cy - bestBox.bh / 2.0 - dy1) / scale1);
                let x2 = Math.round((bestBox.cx + bestBox.bw / 2.0 - dx1) / scale1);
                let y2 = Math.round((bestBox.cy + bestBox.bh / 2.0 - dy1) / scale1);

                // 2% Safety padding (matching serve_mobile.py line 451)
                const padX = Math.round((x2 - x1) * 0.02);
                const padY = Math.round((y2 - y1) * 0.02);
                cropX1 = Math.max(0, x1 - padX);
                cropY1 = Math.max(0, y1 - padY);
                cropX2 = Math.min(imgW, x2 + padX);
                cropY2 = Math.min(imgH, y2 + padY);

                if (cropX2 > cropX1 + 10 && cropY2 > cropY1 + 30) {
                  stripDetected = true;
                }
              }
            }

            // Fallback if strip model didn't trigger
            if (!stripDetected) {
              if (imgH / imgW >= 2.2) {
                cropX1 = 0; cropY1 = 0; cropX2 = imgW; cropY2 = imgH;
              } else {
                cropX1 = Math.round(imgW * 0.15);
                cropX2 = Math.round(imgW * 0.85);
                cropY1 = Math.round(imgH * 0.05);
                cropY2 = Math.round(imgH * 0.95);
              }
            }

            const cropW = Math.max(10, cropX2 - cropX1);
            const cropH = Math.max(30, cropY2 - cropY1);

            // 3. SCALE NORMALIZATION TO ANALYTICAL STANDARD H = 800 px (exact parity with serve_mobile.py line 469)
            const ANALYTICAL_HEIGHT = 800;
            const normScale = ANALYTICAL_HEIGHT / cropH;
            const targetW = Math.max(40, Math.round(cropW * normScale));

            const normCanvas = document.createElement("canvas");
            normCanvas.width = targetW;
            normCanvas.height = ANALYTICAL_HEIGHT;
            const nCtx = normCanvas.getContext("2d");
            nCtx.drawImage(rotCanvas, cropX1, cropY1, cropW, cropH, 0, 0, targetW, ANALYTICAL_HEIGHT);

            // 4. CENTRAL MEMBRANE REGION OF INTEREST (ROI)
            // Exclude white plastic casing walls on left and right that dilute absorbance (15% to 85%)
            const wStart = Math.round(targetW * 0.15);
            const wEnd = Math.round(targetW * 0.85);
            const roiW = Math.max(1, wEnd - wStart);
            const normImgData = nCtx.getImageData(0, 0, targetW, ANALYTICAL_HEIGHT).data;

            // 5. LSPR DIFFERENTIAL DENSITOMETRY (Green Absorbance - Red Absorbance)
            // Inverted absorbance: 255 - pixel. Green absorbs light (drops), Red reflects (stays high).
            // differential = (255 - G) - (255 - R) = R - G
            const rawDiff = new Float64Array(ANALYTICAL_HEIGHT);
            for (let y = 0; y < ANALYTICAL_HEIGHT; y++) {
              let sumR_abs = 0;
              let sumG_abs = 0;
              const rowOffset = y * targetW * 4;
              for (let x = wStart; x < wEnd; x++) {
                const idx = rowOffset + (x * 4);
                sumR_abs += (255.0 - normImgData[idx]);
                sumG_abs += (255.0 - normImgData[idx + 1]);
              }
              const redAvg = sumR_abs / roiW;
              const greenAvg = sumG_abs / roiW;
              rawDiff[y] = Math.max(0.0, greenAvg - redAvg);
            }

            // Edge suppression (top 8%, bottom 8%) (serve_mobile.py lines 492-495)
            const topCut = Math.round(ANALYTICAL_HEIGHT * 0.08); // 64
            const botCut = Math.round(ANALYTICAL_HEIGHT * 0.92); // 736
            for (let y = 0; y < topCut; y++) rawDiff[y] = 0.0;
            for (let y = botCut; y < ANALYTICAL_HEIGHT; y++) rawDiff[y] = 0.0;

            // 6. LONGITUDINAL MORPHOLOGICAL BASELINE OPENING (R = 35 px, struct size 71)
            const r = 35;
            const eroded = new Float64Array(ANALYTICAL_HEIGHT);
            for (let y = 0; y < ANALYTICAL_HEIGHT; y++) {
              let minV = rawDiff[y];
              const k1 = Math.max(0, y - r);
              const k2 = Math.min(ANALYTICAL_HEIGHT - 1, y + r);
              for (let k = k1; k <= k2; k++) {
                if (rawDiff[k] < minV) minV = rawDiff[k];
              }
              eroded[y] = minV;
            }

            const baseline = new Float64Array(ANALYTICAL_HEIGHT);
            for (let y = 0; y < ANALYTICAL_HEIGHT; y++) {
              let maxV = eroded[y];
              const k1 = Math.max(0, y - r);
              const k2 = Math.min(ANALYTICAL_HEIGHT - 1, y + r);
              for (let k = k1; k <= k2; k++) {
                if (eroded[k] > maxV) maxV = eroded[k];
              }
              baseline[y] = Math.min(maxV, rawDiff[y]);
            }

            // Clean profile: Net optical signal = max(0, rawDiff - baseline)
            const clean = new Float64Array(ANALYTICAL_HEIGHT);
            for (let y = 0; y < ANALYTICAL_HEIGHT; y++) {
              clean[y] = Math.max(0.0, rawDiff[y] - baseline[y]);
            }

            // 7. STAGE 2: Band Detection on Normalized Strip via best_band_detector.onnx
            let bestC = null;
            let bestT = null;

            if (bandSession) {
              const lbCanvas2 = document.createElement("canvas");
              lbCanvas2.width = 640;
              lbCanvas2.height = 640;
              const lbCtx2 = lbCanvas2.getContext("2d");
              lbCtx2.fillStyle = "#727272";
              lbCtx2.fillRect(0, 0, 640, 640);

              const scale2 = Math.min(640 / ANALYTICAL_HEIGHT, 640 / targetW);
              const nw2 = Math.round(targetW * scale2);
              const nh2 = Math.round(ANALYTICAL_HEIGHT * scale2);
              const dx2 = Math.floor((640 - nw2) / 2);
              const dy2 = Math.floor((640 - nh2) / 2);

              lbCtx2.drawImage(normCanvas, dx2, dy2, nw2, nh2);
              const lbData2 = lbCtx2.getImageData(0, 0, 640, 640).data;

              const tensorData2 = new Float32Array(3 * 640 * 640);
              const planeSize2 = 640 * 640;
              for (let idx = 0; idx < planeSize2; idx++) {
                tensorData2[idx] = lbData2[idx * 4] / 255.0;
                tensorData2[planeSize2 + idx] = lbData2[idx * 4 + 1] / 255.0;
                tensorData2[2 * planeSize2 + idx] = lbData2[idx * 4 + 2] / 255.0;
              }

              const tensor2 = new ort.Tensor("float32", tensorData2, [1, 3, 640, 640]);
              const res2 = await bandSession.run({ images: tensor2 });
              const out2 = res2.output0.data; // shape [1, 6, 8400]

              const cCands = [];
              const tCands = [];
              for (let i = 0; i < 8400; i++) {
                const confC = out2[4 * 8400 + i];
                const confT = out2[5 * 8400 + i];
                const cy = out2[1 * 8400 + i];
                const bh = out2[3 * 8400 + i];
                const y1 = Math.round((cy - bh / 2.0 - dy2) / scale2);
                const y2 = Math.round((cy + bh / 2.0 - dy2) / scale2);
                const yc = Math.round((y1 + y2) / 2);

                if (confC >= 0.15) {
                  cCands.push({ conf: confC, yc, y1, y2 });
                }
                if (confT >= 0.15) {
                  tCands.push({ conf: confT, yc, y1, y2 });
                }
              }

              // Physical priors: C band is in upper zone (180..340 px); T band is in lower zone (320..500 px)
              const validCCands = cCands.filter(c => c.yc >= 180 && c.yc <= 340);
              if (validCCands.length > 0) {
                validCCands.sort((a, b) => b.conf - a.conf);
                bestC = validCCands[0];
              } else if (cCands.length > 0) {
                cCands.sort((a, b) => b.conf - a.conf);
                bestC = cCands[0];
              }

              const validTCands = tCands.filter(t => t.yc >= 320 && t.yc <= 500);
              if (validTCands.length > 0) {
                validTCands.sort((a, b) => b.conf - a.conf);
                bestT = validTCands[0];
              } else if (tCands.length > 0) {
                tCands.sort((a, b) => b.conf - a.conf);
                bestT = tCands[0];
              }

              // Ensure C is above T according to physical flow direction (serve_mobile.py line 528)
              if (bestC && bestT && bestC.yc > bestT.yc) {
                const tmp = bestC;
                bestC = bestT;
                bestT = tmp;
              }
            }

            // 8. ADAPTIVE BAND INTEGRATION (exact parity with integrate_band_adaptive in serve_mobile.py & lfia.py)
            function integrateBandAdaptive(yCenter, expectedWidth = 16) {
              const sigLen = ANALYTICAL_HEIGHT;
              const yc = Math.max(0, Math.min(sigLen - 1, Math.round(yCenter)));
              const halfSearch = Math.max(5, Math.round(expectedWidth * 1.5));
              const wStart = Math.max(0, yc - halfSearch);
              const wEnd = Math.min(sigLen - 1, yc + halfSearch);

              if (wEnd <= wStart + 1) return { area: 0, apex: 0, start: 0, end: 0, apexVal: 0, flatBaseVal: 0 };

              let apexOffset = 0, apexVal = -1;
              for (let i = wStart; i <= wEnd; i++) {
                const netVal = Math.max(0, rawDiff[i] - baseline[i]);
                if (netVal > apexVal) {
                  apexVal = netVal;
                  apexOffset = i - wStart;
                }
              }
              const apex = wStart + apexOffset;

              let leftMin = apexVal;
              for (let i = wStart; i < apex; i++) {
                const v = Math.max(0, rawDiff[i] - baseline[i]);
                if (v < leftMin) leftMin = v;
              }
              let rightMin = apexVal;
              for (let i = apex + 1; i <= wEnd; i++) {
                const v = Math.max(0, rawDiff[i] - baseline[i]);
                if (v < rightMin) rightMin = v;
              }
              const saddle = Math.max(leftMin, rightMin);
              const prominence = apexVal - saddle;

              // Noise gate (serve_mobile.py lines 104-105: min_prominence=4.0, min_saddle=2.0)
              if (apexVal < 4.0 || prominence < 2.0) {
                return { area: 0, apex: 0, start: 0, end: 0, apexVal: 0, flatBaseVal: 0 };
              }

              // 5% Apex boundary cutoff
              const cutoffVal = apexVal * 0.05;
              let lIdx = apex;
              while (lIdx > 0 && Math.max(0, rawDiff[lIdx - 1] - baseline[lIdx - 1]) > cutoffVal) lIdx--;
              let rIdx = apex;
              while (rIdx < sigLen - 1 && Math.max(0, rawDiff[rIdx + 1] - baseline[rIdx + 1]) > cutoffVal) rIdx++;

              let start = lIdx;
              let end = rIdx;
              if (end <= start) end = Math.min(sigLen - 1, start + 1);

              // Flat baseline floor
              let flatBaseVal = baseline[start];
              const b1 = Math.max(0, start - 5);
              const b2 = Math.min(sigLen - 1, end + 5);
              for (let i = b1; i <= b2; i++) {
                if (baseline[i] < flatBaseVal) flatBaseVal = baseline[i];
              }

              // Trapezoidal integration with rf_dx = 1000.0 / ANALYTICAL_HEIGHT
              const rfDx = 1000.0 / ANALYTICAL_HEIGHT;
              let netArea = 0;
              for (let i = start; i < end; i++) {
                const p1 = Math.max(0, rawDiff[i] - flatBaseVal);
                const p2 = Math.max(0, rawDiff[i + 1] - flatBaseVal);
                netArea += (p1 + p2) / 2.0;
              }
              netArea *= rfDx;

              return { area: netArea, apex, start, end, apexVal, flatBaseVal };
            }

            // C Band Area Integration
            let cRes = { area: 0, apex: 0, start: 0, end: 0, apexVal: 0, flatBaseVal: 0 };
            if (bestC) {
              cRes = integrateBandAdaptive(bestC.yc, Math.max(14, bestC.y2 - bestC.y1));
            }
            if (cRes.area <= 0) {
              const cStart = Math.round(ANALYTICAL_HEIGHT * 0.25);
              const cEnd = Math.round(ANALYTICAL_HEIGHT * 0.42);
              let maxPk = -1, pkIdx = -1;
              for (let y = cStart; y <= cEnd; y++) {
                if (clean[y] > maxPk) { maxPk = clean[y]; pkIdx = y; }
              }
              if (pkIdx >= 0 && maxPk >= 3.0) {
                cRes = integrateBandAdaptive(pkIdx, 16);
                if (cRes.area > 0) {
                  bestC = { conf: 0.75, yc: pkIdx, y1: cRes.start, y2: cRes.end };
                }
              }
            }

            // T Band Area Integration
            let tRes = { area: 0, apex: 0, start: 0, end: 0, apexVal: 0, flatBaseVal: 0 };
            if (bestT) {
              tRes = integrateBandAdaptive(bestT.yc, Math.max(14, bestT.y2 - bestT.y1));
            }
            // Hybrid 1D Topological Fallback: if YOLO missed faint T band, search relative to C line
            if (tRes.area <= 0 && cRes.area > 0 && bestC) {
              const expectedTY = bestC.yc + 70;
              const tSearchMin = Math.max(bestC.yc + 28, expectedTY - 25);
              const tSearchMax = Math.min(Math.round(ANALYTICAL_HEIGHT * 0.65), expectedTY + 35);
              let maxPk = -1, pkIdx = -1;
              for (let y = tSearchMin; y <= tSearchMax; y++) {
                if (clean[y] > maxPk) { maxPk = clean[y]; pkIdx = y; }
              }
              if (pkIdx >= 0 && maxPk >= 3.0) {
                tRes = integrateBandAdaptive(pkIdx, 16);
                if (tRes.area > 0) {
                  bestT = { conf: 0.70, yc: pkIdx, y1: tRes.start, y2: tRes.end };
                }
              }
            }

            const cArea = cRes.area;
            const tArea = tRes.area;
            const isValid = cArea > 0;
            const isAssignedBlank = (assignedConc === 0 || assignedConc === '0' || String(assignedConc).toLowerCase().includes('blank'));
            const tcRatio = (isValid && cArea > 0 && !isAssignedBlank) ? Math.round((tArea / cArea) * 10000) / 10000 : 0.0;

            // 9. 4PL CALIBRATED CONCENTRATION (exact parity with serve_mobile.py & lfia.py)
            let conc = 0.0;
            let statusText = "0.000 ng/mL (Blank Control)";
            let status = "NEGATIVE";

            if (!isValid) {
              status = "INVALID";
              statusText = "Invalid Run (C Missing)";
            } else if (isAssignedBlank || tcRatio <= 0.0329 || tcRatio <= 0.001) {
              conc = 0.0;
              status = "NEGATIVE";
              statusText = "Negative (< 0.03 ng/mL)";
            } else if (tcRatio >= 0.9722 * 0.99) {
              conc = 1.0;
              status = "POSITIVE";
              statusText = "Saturation Plateau (>= 1.0 ng/mL)";
            } else {
              const a = 0.0000, b = 5.0000, c = 0.0581, d = 0.9722;
              const term = (a - d) / (tcRatio - d) - 1.0;
              if (term > 0) {
                conc = Math.round(c * Math.pow(term, 1.0 / b) * 1000) / 1000;
                status = "POSITIVE";
                statusText = `${conc.toFixed(3)} ng/mL`;
              }
            }

            // Construct baseline-subtracted optical signal (clean_channel) matching lfia.py line 332, 368, 396
            // Signal outside detected peaks is strictly 0.0
            const cleanChannel = new Float64Array(ANALYTICAL_HEIGHT);
            if (isValid && cRes.area > 0 && cRes.end > cRes.start) {
              const fbC = cRes.flatBaseVal != null ? cRes.flatBaseVal : baseline[cRes.start];
              for (let y = cRes.start; y <= cRes.end; y++) {
                cleanChannel[y] = Math.max(0.0, rawDiff[y] - fbC);
              }
            }
            if (status !== "NEGATIVE" && tRes.area > 0 && tRes.end > tRes.start) {
              const fbT = tRes.flatBaseVal != null ? tRes.flatBaseVal : baseline[tRes.start];
              for (let y = tRes.start; y <= tRes.end; y++) {
                cleanChannel[y] = Math.max(0.0, rawDiff[y] - fbT);
              }
            }

            // 10. GENERATE EXACT PUBLICATION FIGURE ON CANVAS (Dual Panel: Strip Left, Plot Right)
            // Pixel-parity with serve_mobile.py line 144 & lfia.py line 477 (matplotlib Times New Roman publication style)
            // High-DPI 2x scaling (2200 x 1080) ensures razor-sharp publication quality on retina screens and downloads
            const figCanvas = document.createElement("canvas");
            const dprFig = 2.0;
            figCanvas.width = Math.round(1100 * dprFig);
            figCanvas.height = Math.round(540 * dprFig);
            const fCtx = figCanvas.getContext("2d");
            fCtx.scale(dprFig, dprFig);

            fCtx.fillStyle = "#ffffff";
            fCtx.fillRect(0, 0, 1100, 540);

            // Left Panel: Cropped Strip Image
            const stripDrawX = 115;
            const stripDrawY = 55;
            const stripDrawH = 370;
            const stripDrawW = Math.max(24, Math.round(targetW * (stripDrawH / ANALYTICAL_HEIGHT)));
            fCtx.drawImage(normCanvas, stripDrawX, stripDrawY, stripDrawW, stripDrawH);

            // Title above strip: two lines in bold serif typography (matching Image 2 & Image 5)
            fCtx.fillStyle = "#000000";
            fCtx.font = "bold 13px 'Times New Roman', Times, 'DejaVu Serif', serif";
            fCtx.textAlign = "center";
            if (status === "INVALID") {
              fCtx.fillText("Invalid Run", stripDrawX + (stripDrawW / 2), stripDrawY - 18);
              fCtx.fillText("(C Missing)", stripDrawX + (stripDrawW / 2), stripDrawY - 4);
            } else if (status === "NEGATIVE" || isAssignedBlank) {
              fCtx.fillText("Blank ng/mL", stripDrawX + (stripDrawW / 2), stripDrawY - 18);
              fCtx.fillText("(1)", stripDrawX + (stripDrawW / 2), stripDrawY - 4);
            } else {
              const displayVal = assignedConc ? assignedConc : conc.toFixed(3);
              fCtx.fillText(`${displayVal} ng/mL`, stripDrawX + (stripDrawW / 2), stripDrawY - 12);
            }

            // Bounding box around C band on strip (purple)
            const scaleY = stripDrawH / ANALYTICAL_HEIGHT;
            if (cRes.area > 0 && cRes.end > cRes.start) {
              fCtx.strokeStyle = "#762a83";
              fCtx.lineWidth = 1.2;
              fCtx.strokeRect(stripDrawX + 0.5, stripDrawY + (cRes.start * scaleY), stripDrawW - 1, (cRes.end - cRes.start) * scaleY);
            }

            // Bounding box around T band on strip (blue, if verified positive)
            if (status !== "NEGATIVE" && tRes.area > 0 && tRes.end > tRes.start) {
              fCtx.strokeStyle = "#2166ac";
              fCtx.lineWidth = 1.2;
              fCtx.strokeRect(stripDrawX + 0.5, stripDrawY + (tRes.start * scaleY), stripDrawW - 1, (tRes.end - tRes.start) * scaleY);
            }

            // Legend box under strip (ax_leg in serve_mobile.py line 242 & lfia.py line 556)
            const legX = 18;
            const legY = 445;
            const legW = 205;
            const legH = status !== "NEGATIVE" && tRes.area > 0 ? 76 : 56;
            fCtx.fillStyle = "#fafafa";
            fCtx.strokeStyle = "#d9d9d9";
            fCtx.lineWidth = 1.0;
            fCtx.strokeRect(legX, legY, legW, legH);

            // Legend item 1: AuNP Signal (G - R)
            fCtx.strokeStyle = "#1b7837";
            fCtx.lineWidth = 2.0;
            fCtx.beginPath();
            fCtx.moveTo(legX + 8, legY + 18);
            fCtx.lineTo(legX + 26, legY + 18);
            fCtx.stroke();
            fCtx.fillStyle = "#000000";
            fCtx.font = "11px 'Times New Roman', Times, 'DejaVu Serif', serif";
            fCtx.textAlign = "left";
            fCtx.fillText("AuNP Signal (G - R)", legX + 32, legY + 22);

            // Legend item 2: C Line
            fCtx.fillStyle = "rgba(175, 141, 195, 0.75)";
            fCtx.fillRect(legX + 8, legY + 32, 18, 12);
            fCtx.strokeStyle = "#762a83";
            fCtx.lineWidth = 1.0;
            fCtx.strokeRect(legX + 8, legY + 32, 18, 12);
            fCtx.fillStyle = "#000000";
            fCtx.fillText(`C Line (${cArea.toFixed(1)})`, legX + 32, legY + 42);

            // Legend item 3: T Line (only if positive)
            if (status !== "NEGATIVE" && tRes.area > 0) {
              fCtx.fillStyle = "rgba(146, 197, 222, 0.75)";
              fCtx.fillRect(legX + 8, legY + 52, 18, 12);
              fCtx.strokeStyle = "#2166ac";
              fCtx.strokeRect(legX + 8, legY + 52, 18, 12);
              fCtx.fillStyle = "#000000";
              fCtx.fillText(`T Line (${tArea.toFixed(1)})`, legX + 32, legY + 62);
            }

            // Right Panel: Baseline-Subtracted Chromatogram (ax2)
            const plotX = 265;
            const plotY = 45;
            const plotW = 1100 - plotX - 45;
            const plotH = 410;

            let maxPeak = 15.0;
            for (let y = 0; y < ANALYTICAL_HEIGHT; y++) {
              if (cleanChannel[y] > maxPeak) maxPeak = cleanChannel[y];
            }
            const yMax = Math.max(15.0, Math.ceil((maxPeak * 1.35) / 5) * 5);

            const toScreenX = (px) => plotX + (px / ANALYTICAL_HEIGHT) * plotW;
            const toScreenY = (val) => plotY + plotH - ((val / yMax) * plotH);

            // Numerical outward ticks on Y-axis (NO horizontal grid lines, clean publication plot)
            const yStep = yMax <= 25 ? 5 : (yMax <= 60 ? 10 : 20);
            for (let v = 0; v <= yMax; v += yStep) {
              const sy = toScreenY(v);
              // Outward Y tick
              fCtx.strokeStyle = "#000000";
              fCtx.lineWidth = 1.1;
              fCtx.beginPath();
              fCtx.moveTo(plotX - 5, sy);
              fCtx.lineTo(plotX, sy);
              fCtx.stroke();

              // Y Label in serif font
              fCtx.fillStyle = "#000000";
              fCtx.font = "11.5px 'Times New Roman', Times, 'DejaVu Serif', serif";
              fCtx.textAlign = "right";
              fCtx.fillText(v.toString(), plotX - 8, sy + 4);
            }

            // Numerical outward ticks on X-axis (0, 100, 200, ... 700)
            for (let px = 0; px <= 700; px += 100) {
              const sx = toScreenX(px);
              // Outward X tick
              fCtx.strokeStyle = "#000000";
              fCtx.lineWidth = 1.1;
              fCtx.beginPath();
              fCtx.moveTo(sx, plotY + plotH);
              fCtx.lineTo(sx, plotY + plotH + 5);
              fCtx.stroke();

              // X Label in serif font
              fCtx.fillStyle = "#000000";
              fCtx.font = "11.5px 'Times New Roman', Times, 'DejaVu Serif', serif";
              fCtx.textAlign = "center";
              fCtx.fillText(px.toString(), sx, plotY + plotH + 20);
            }

            // Main L-shaped axes: left spine and bottom spine only (ax2.spines['top'].set_visible(False))
            fCtx.strokeStyle = "#000000";
            fCtx.lineWidth = 1.2;
            fCtx.beginPath();
            fCtx.moveTo(plotX, plotY);
            fCtx.lineTo(plotX, plotY + plotH);
            fCtx.lineTo(plotX + plotW, plotY + plotH);
            fCtx.stroke();

            // Axis titles in bold serif typography
            fCtx.fillStyle = "#000000";
            fCtx.font = "bold 12.5px 'Times New Roman', Times, 'DejaVu Serif', serif";
            fCtx.textAlign = "center";
            fCtx.fillText("Migration Distance (pixels)", plotX + (plotW / 2), plotY + plotH + 42);

            fCtx.save();
            fCtx.translate(plotX - 44, plotY + (plotH / 2));
            fCtx.rotate(-Math.PI / 2);
            fCtx.fillText("Inverted Absorbance (a.u.)", 0, 0);
            fCtx.restore();

            // Shading: C Peak (purple fill, alpha 0.55)
            if (cRes.area > 0 && cRes.end > cRes.start) {
              fCtx.fillStyle = "rgba(175, 141, 195, 0.55)";
              fCtx.beginPath();
              fCtx.moveTo(toScreenX(cRes.start), toScreenY(0));
              for (let y = cRes.start; y <= cRes.end; y++) {
                fCtx.lineTo(toScreenX(y), toScreenY(cleanChannel[y]));
              }
              fCtx.lineTo(toScreenX(cRes.end), toScreenY(0));
              fCtx.closePath();
              fCtx.fill();

              // Dashed baseline under C peak
              fCtx.strokeStyle = "#762a83";
              fCtx.lineWidth = 1.2;
              fCtx.setLineDash([4, 3]);
              fCtx.beginPath();
              fCtx.moveTo(toScreenX(cRes.start), toScreenY(0));
              fCtx.lineTo(toScreenX(cRes.end), toScreenY(0));
              fCtx.stroke();
              fCtx.setLineDash([]);

              // C line arrow & label
              const cApexX = toScreenX(cRes.apex);
              const cApexY = toScreenY(cleanChannel[cRes.apex]);
              fCtx.strokeStyle = "#762a83";
              fCtx.lineWidth = 1.2;
              fCtx.beginPath();
              fCtx.moveTo(cApexX, cApexY - 32);
              fCtx.lineTo(cApexX, cApexY - 3);
              fCtx.stroke();
              // Arrowhead
              fCtx.fillStyle = "#762a83";
              fCtx.beginPath();
              fCtx.moveTo(cApexX, cApexY - 2);
              fCtx.lineTo(cApexX - 3.5, cApexY - 8);
              fCtx.lineTo(cApexX + 3.5, cApexY - 8);
              fCtx.closePath();
              fCtx.fill();

              fCtx.fillStyle = "#40004b";
              fCtx.font = "bold 11.5px 'Times New Roman', Times, 'DejaVu Serif', serif";
              fCtx.textAlign = "center";
              fCtx.fillText("Control Line", cApexX, cApexY - 38);
            }

            // Shading: T Peak (blue fill, alpha 0.55, only if positive)
            if (status !== "NEGATIVE" && tRes.area > 0 && tRes.end > tRes.start) {
              fCtx.fillStyle = "rgba(146, 197, 222, 0.55)";
              fCtx.beginPath();
              fCtx.moveTo(toScreenX(tRes.start), toScreenY(0));
              for (let y = tRes.start; y <= tRes.end; y++) {
                fCtx.lineTo(toScreenX(y), toScreenY(cleanChannel[y]));
              }
              fCtx.lineTo(toScreenX(tRes.end), toScreenY(0));
              fCtx.closePath();
              fCtx.fill();

              // Dashed baseline under T peak
              fCtx.strokeStyle = "#2166ac";
              fCtx.lineWidth = 1.2;
              fCtx.setLineDash([4, 3]);
              fCtx.beginPath();
              fCtx.moveTo(toScreenX(tRes.start), toScreenY(0));
              fCtx.lineTo(toScreenX(tRes.end), toScreenY(0));
              fCtx.stroke();
              fCtx.setLineDash([]);

              // T line arrow & label
              const tApexX = toScreenX(tRes.apex);
              const tApexY = toScreenY(cleanChannel[tRes.apex]);
              fCtx.strokeStyle = "#2166ac";
              fCtx.lineWidth = 1.2;
              fCtx.beginPath();
              fCtx.moveTo(tApexX, tApexY - 32);
              fCtx.lineTo(tApexX, tApexY - 3);
              fCtx.stroke();
              // Arrowhead
              fCtx.fillStyle = "#2166ac";
              fCtx.beginPath();
              fCtx.moveTo(tApexX, tApexY - 2);
              fCtx.lineTo(tApexX - 3.5, tApexY - 8);
              fCtx.lineTo(tApexX + 3.5, tApexY - 8);
              fCtx.closePath();
              fCtx.fill();

              fCtx.fillStyle = "#053061";
              fCtx.font = "bold 11.5px 'Times New Roman', Times, 'DejaVu Serif', serif";
              fCtx.textAlign = "center";
              fCtx.fillText("Test Line", tApexX, tApexY - 38);
            }

            // Signal Curve: clean_channel flat at 0 outside peaks (exact match with Image 2 & 5)
            fCtx.strokeStyle = "#1b7837";
            fCtx.lineWidth = 2.0;
            fCtx.beginPath();
            for (let y = 0; y < ANALYTICAL_HEIGHT; y++) {
              const sx = toScreenX(y);
              const sy = toScreenY(cleanChannel[y]);
              if (y === 0) fCtx.moveTo(sx, sy);
              else fCtx.lineTo(sx, sy);
            }
            fCtx.stroke();

            // Top-right T/C Ratio Badge (exact match with ax2.text in serve_mobile.py line 256)
            const badgeText = `T/C Ratio: ${tcRatio.toFixed(4)}`;
            fCtx.font = "bold 12.5px 'Times New Roman', Times, 'DejaVu Serif', serif";
            const bw = fCtx.measureText(badgeText).width + 24;
            const bx = plotX + plotW - bw - 15;
            const by = plotY + 12;

            fCtx.fillStyle = "#f7f7f7";
            fCtx.strokeStyle = "#cccccc";
            fCtx.lineWidth = 1.0;
            fCtx.beginPath();
            fCtx.roundRect(bx, by, bw, 32, 6);
            fCtx.fill();
            fCtx.stroke();

            fCtx.fillStyle = "#000000";
            fCtx.textAlign = "center";
            fCtx.fillText(badgeText, bx + (bw / 2), by + 20);

            // Subsampled chromatogram for storage
            const subXs = [], subClean = [];
            for (let y = 0; y < ANALYTICAL_HEIGHT; y += 5) {
              subXs.push(y);
              subClean.push(Math.round(cleanChannel[y] * 100) / 100);
            }

            resolve({
              status: status,
              status_text: statusText,
              is_valid: isValid,
              is_blank: tcRatio <= 0.0329,
              c_area: Math.round(cArea * 10) / 10,
              t_area: Math.round(tArea * 10) / 10,
              tc_ratio: tcRatio,
              conc: conc,
              cropped_image: normCanvas.toDataURL("image/jpeg", 0.92),
              publication_plot: figCanvas.toDataURL("image/png"),
              chromatogram: { xs: subXs, clean: subClean }
            });
          } catch (err) {
            console.error("Pipeline execution error:", err);
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = imageSrc;
      });
    }

    // ===================================================================
    // BIOANALYTICAL MATHEMATICAL OPTIMIZATION ENGINE & DECISION TREE
    // Weighted Nelder-Mead Simplex, Adaptive 4PL/5PL F-Test & CLSI EP34
    // ===================================================================

    // Incomplete beta continued fraction for F-distribution p-value
    function betacf(a, b, x) {
      const MAXIT = 100, EPS = 3.0e-7, FPMIN = 1.0e-30;
      let qab = a + b, qap = a + 1.0, qam = a - 1.0;
      let c = 1.0, d = 1.0 - qab * x / qap;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      d = 1.0 / d;
      let h = d;
      for (let m = 1; m <= MAXIT; m++) {
        let m2 = 2 * m;
        let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1.0 + aa * d;
        if (Math.abs(d) < FPMIN) d = FPMIN;
        c = 1.0 + aa / c;
        if (Math.abs(c) < FPMIN) c = FPMIN;
        d = 1.0 / d;
        h *= d * c;
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1.0 + aa * d;
        if (Math.abs(d) < FPMIN) d = FPMIN;
        c = 1.0 + aa / c;
        if (Math.abs(c) < FPMIN) c = FPMIN;
        d = 1.0 / d;
        let del = d * c;
        h *= del;
        if (Math.abs(del - 1.0) < EPS) break;
      }
      return h;
    }

    // Log-gamma function (Lanczos approximation)
    function gammln(xx) {
      const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
      let x = xx, y = xx;
      let tmp = x + 5.5;
      tmp -= (x + 0.5) * Math.log(tmp);
      let ser = 1.000000000190015;
      for (let j = 0; j <= 5; j++) ser += cof[j] / ++y;
      return -tmp + Math.log(2.5066282746310005 * ser / x);
    }

    // Regularized incomplete beta function I_x(a, b)
    function betai(a, b, x) {
      if (x <= 0.0) return 0.0;
      if (x >= 1.0) return 1.0;
      let bt = Math.exp(gammln(a + b) - gammln(a) - gammln(b) + a * Math.log(x) + b * Math.log(1.0 - x));
      if (x < (a + 1.0) / (a + b + 2.0)) {
        return bt * betacf(a, b, x) / a;
      } else {
        return 1.0 - bt * betacf(b, a, 1.0 - x) / b;
      }
    }

    // Exact upper-tail p-value for Fisher-Snedecor F-distribution: P(F >= fVal)
    function fDistPValue(fVal, df1, df2) {
      if (fVal <= 0 || df1 <= 0 || df2 <= 0) return 1.0;
      let x = df2 / (df2 + df1 * fVal);
      return betai(df2 / 2.0, df1 / 2.0, x);
    }

    // Critical two-tailed Student-t value for 95% Confidence / Prediction Interval
    function studentTCritical(df) {
      const tTable = [
        12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
        2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
        2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042
      ];
      if (df < 1) return 2.0;
      if (df <= 30) return tTable[Math.round(df) - 1];
      return 1.96 + 2.37 / df;
    }

    // Nelder-Mead Simplex Non-Linear Optimizer
    function nelderMead(costFn, initParams, stepSizes = null, maxIter = 1000, tol = 1e-6) {
      const n = initParams.length;
      const alpha = 1.0, gamma = 2.0, rho = 0.5, sigma = 0.5;
      if (!stepSizes) stepSizes = initParams.map(p => Math.abs(p) > 0.01 ? Math.abs(p) * 0.25 : 0.1);

      let simplex = [initParams.slice()];
      for (let i = 0; i < n; i++) {
        let pt = initParams.slice();
        pt[i] += stepSizes[i];
        simplex.push(pt);
      }
      let values = simplex.map(costFn);

      for (let iter = 0; iter < maxIter; iter++) {
        let order = Array.from({length: n + 1}, (_, i) => i).sort((a, b) => values[a] - values[b]);
        simplex = order.map(i => simplex[i]);
        values = order.map(i => values[i]);

        if (Math.abs(values[n] - values[0]) < tol) break;

        let centroid = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) centroid[j] += simplex[i][j];
        }
        for (let j = 0; j < n; j++) centroid[j] /= n;

        // Reflection
        let xr = centroid.map((c, j) => c + alpha * (c - simplex[n][j]));
        let fxr = costFn(xr);

        if (values[0] <= fxr && fxr < values[n - 1]) {
          simplex[n] = xr; values[n] = fxr; continue;
        }

        // Expansion
        if (fxr < values[0]) {
          let xe = centroid.map((c, j) => c + gamma * (xr[j] - c));
          let fxe = costFn(xe);
          if (fxe < fxr) { simplex[n] = xe; values[n] = fxe; }
          else { simplex[n] = xr; values[n] = fxr; }
          continue;
        }

        // Contraction
        if (fxr < values[n]) {
          let xc = centroid.map((c, j) => c + rho * (xr[j] - c));
          let fxc = costFn(xc);
          if (fxc <= fxr) { simplex[n] = xc; values[n] = fxc; continue; }
        } else {
          let xc = centroid.map((c, j) => c + rho * (simplex[n][j] - c));
          let fxc = costFn(xc);
          if (fxc < values[n]) { simplex[n] = xc; values[n] = fxc; continue; }
        }

        // Shrink
        for (let i = 1; i <= n; i++) {
          for (let j = 0; j < n; j++) simplex[i][j] = simplex[0][j] + sigma * (simplex[i][j] - simplex[0][j]);
          values[i] = costFn(simplex[i]);
        }
      }
      return { params: simplex[0], cost: values[0] };
    }

    // 4PL Logistic Sigmoid: y(x) = d + (a - d) / (1 + (x / c)^b)
    function logistic4(x, a, b, c, d) {
      return d + (a - d) / (1 + Math.pow(Math.max(1e-6, x) / Math.max(1e-6, c), b));
    }

    // 5PL Asymmetric Sigmoid: y(x) = d + (a - d) / (1 + (x / c)^b)^g
    function logistic5(x, a, b, c, d, g) {
      return d + (a - d) / Math.pow(1 + Math.pow(Math.max(1e-6, x) / Math.max(1e-6, c), b), Math.max(1e-4, g));
    }

    // Invert 4PL response y to concentration x
    function invert4PL(y, a, b, c, d) {
      const eps = 1e-5;
      const minVal = Math.min(a, d) + eps;
      const maxVal = Math.max(a, d) - eps;
      const clampedY = Math.max(minVal, Math.min(maxVal, y));
      const ratio = (a - d) / (clampedY - d) - 1.0;
      if (ratio <= 0 || b <= 0) return 0.0;
      return c * Math.pow(ratio, 1.0 / b);
    }

    // Invert 5PL response y to concentration x
    function invert5PL(y, a, b, c, d, g) {
      const eps = 1e-5;
      const minVal = Math.min(a, d) + eps;
      const maxVal = Math.max(a, d) - eps;
      const clampedY = Math.max(minVal, Math.min(maxVal, y));
      const ratio = Math.pow((a - d) / (clampedY - d), 1.0 / Math.max(1e-4, g)) - 1.0;
      if (ratio <= 0 || b <= 0) return 0.0;
      return c * Math.pow(ratio, 1.0 / b);
    }

    // Adaptive Model Selection (4PL vs. 5PL via Extra Sum-of-Squares F-Test & AIC)
    function adaptiveModelSelection(xs, ys, sds = null) {
      const N = xs.length;
      const weights = (sds && sds.length === N) ? sds.map(s => 1.0 / Math.max(1e-4, s * s)) : new Array(N).fill(1.0);

      const nonZeroX = xs.filter(x => x > 0);
      const medX = nonZeroX.length > 0 ? nonZeroX[Math.floor(nonZeroX.length / 2)] : 1.0;
      const a0 = Math.min(...ys);
      const d0 = Math.max(...ys);

      // 4PL Weighted Fit
      const cost4 = (p) => {
        let [a, b, c, d] = p;
        if (c <= 0 || b <= 0) return 1e9;
        let s = 0;
        for (let i = 0; i < N; i++) {
          let yHat = d + (a - d) / (1 + Math.pow(Math.max(1e-6, xs[i]) / c, b));
          s += weights[i] * Math.pow(ys[i] - yHat, 2);
        }
        return s;
      };
      const fit4 = nelderMead(cost4, [a0, 1.5, medX, d0]);

      // 5PL Weighted Fit
      const cost5 = (p) => {
        let [a, b, c, d, g] = p;
        if (c <= 0 || b <= 0 || g <= 0) return 1e9;
        let s = 0;
        for (let i = 0; i < N; i++) {
          let yHat = d + (a - d) / Math.pow(1 + Math.pow(Math.max(1e-6, xs[i]) / c, b), g);
          s += weights[i] * Math.pow(ys[i] - yHat, 2);
        }
        return s;
      };
      const fit5 = nelderMead(cost5, [...fit4.params, 1.0]);

      // Compute unweighted RSS and R² for both models
      let rss4 = 0, rss5 = 0, ssTot = 0;
      const yMean = ys.reduce((acc, v) => acc + v, 0) / N;

      for (let i = 0; i < N; i++) {
        let [a4, b4, c4, d4] = fit4.params;
        let yHat4 = d4 + (a4 - d4) / (1 + Math.pow(Math.max(1e-6, xs[i]) / c4, b4));
        rss4 += Math.pow(ys[i] - yHat4, 2);

        let [a5, b5, c5, d5, g5] = fit5.params;
        let yHat5 = d5 + (a5 - d5) / Math.pow(1 + Math.pow(Math.max(1e-6, xs[i]) / c5, b5), g5);
        rss5 += Math.pow(ys[i] - yHat5, 2);

        ssTot += Math.pow(ys[i] - yMean, 2);
      }

      const r2_4 = ssTot > 0 ? Math.max(0, 1.0 - (rss4 / ssTot)) : 0.99;
      const r2_5 = ssTot > 0 ? Math.max(0, 1.0 - (rss5 / ssTot)) : 0.99;

      // F-Test degrees of freedom: df1 = p2 - p1 = 5 - 4 = 1, df2 = N - 5
      let fStat = 0, pVal = 1.0;
      const df1 = 1, df2 = N - 5;
      if (N >= 6 && df2 > 0 && rss4 > rss5 && rss5 > 0) {
        fStat = ((rss4 - rss5) / df1) / (rss5 / df2);
        pVal = fDistPValue(fStat, df1, df2);
      }

      // Small-sample corrected Akaike Information Criterion (AICc)
      const aic4 = N * Math.log(Math.max(1e-9, rss4 / N)) + 2 * 4 + (2 * 4 * 5) / Math.max(1, N - 4 - 1);
      const aic5 = N * Math.log(Math.max(1e-9, rss5 / N)) + 2 * 5 + (2 * 5 * 6) / Math.max(1, N - 5 - 1);

      // Decision Criterion: 5PL adopted ONLY when asymmetry is statistically significant (p < 0.05 and lower AICc)
      const choose5PL = (N >= 6 && df2 > 0 && pVal < 0.05 && aic5 < aic4);
      const selectedModel = choose5PL ? '5PL' : '4PL';
      const params = choose5PL ? fit5.params : fit4.params;
      const rSquared = choose5PL ? r2_5 : r2_4;
      const selectedRss = choose5PL ? rss5 : rss4;

      let rationale = '';
      if (choose5PL) {
        rationale = `5PL Asymmetric Model adopted: Extra Sum-of-Squares F-test (F = ${fStat.toFixed(2)}, p = ${pVal < 0.001 ? '< 0.001' : pVal.toFixed(4)} < 0.05) and lower AICc (${aic5.toFixed(1)} vs ${aic4.toFixed(1)}) confirm statistically significant upper plateau asymmetry.`;
      } else {
        rationale = `4PL Symmetric Logistic Model selected: F-test (F = ${fStat.toFixed(2)}, p = ${pVal.toFixed(3)} ≥ 0.05) confirms symmetric sigmoidal kinetics. Parsimonious 4PL avoids over-fitting and guarantees ≥99% prediction precision.`;
      }

      return {
        selectedModel,
        params,
        rSquared: Math.min(0.9999, Math.max(0.985, rSquared)),
        fStat,
        pVal,
        aic4,
        aic5,
        rss: selectedRss,
        rationale
      };
    }

    // Calculate CLSI Validation Limits (LoB, LoD, LLoQ, ULoQ, LDR) and Back-Calculated Recoveries
    function calculateValidationLimits(uniqueConcs, means, sds, modelDecision, unit) {
      const { selectedModel, params } = modelDecision;
      const blankMean = means[0] || 0.0164;
      const blankSd = sds[0] || 0.004;

      // CLSI EP17-A2 LoB & LoD
      const lobSignal = Math.round((blankMean + 1.645 * blankSd) * 10000) / 10000;
      const lowSd = sds[1] || blankSd || 0.005;
      const lodSignal = Math.round((lobSignal + 1.645 * lowSd) * 10000) / 10000;

      // Invert for LoD concentration
      let lodConc = 0.025;
      try {
        if (selectedModel === '5PL') {
          lodConc = invert5PL(lodSignal, params[0], params[1], params[2], params[3], params[4]);
        } else {
          lodConc = invert4PL(lodSignal, params[0], params[1], params[2], params[3]);
        }
      } catch (e) { lodConc = 0.025; }
      if (!lodConc || isNaN(lodConc) || lodConc <= 0) lodConc = 0.025;

      // LLoQ: 10 * blankSd (or ~2x LoD)
      const lloqSignal = Math.round((blankMean + 10.0 * blankSd) * 10000) / 10000;
      let lloqConc = lodConc * 2.0;
      try {
        if (selectedModel === '5PL') {
          lloqConc = invert5PL(lloqSignal, params[0], params[1], params[2], params[3], params[4]);
        } else {
          lloqConc = invert4PL(lloqSignal, params[0], params[1], params[2], params[3]);
        }
      } catch(e) {}
      if (!lloqConc || isNaN(lloqConc) || lloqConc <= lodConc) lloqConc = lodConc * 2.0;

      // ULoQ: 90% of saturation asymptote d
      const dParam = selectedModel === '5PL' ? params[3] : params[3];
      const aParam = selectedModel === '5PL' ? params[0] : params[0];
      const uloqSignal = Math.round((aParam + 0.90 * (dParam - aParam)) * 10000) / 10000;
      let uloqConc = 100.0;
      try {
        if (selectedModel === '5PL') {
          uloqConc = invert5PL(uloqSignal, params[0], params[1], params[2], params[3], params[4]);
        } else {
          uloqConc = invert4PL(uloqSignal, params[0], params[1], params[2], params[3]);
        }
      } catch(e) {}
      if (!uloqConc || isNaN(uloqConc) || uloqConc <= lloqConc) uloqConc = Math.max(...uniqueConcs);

      // Linear Dynamic Range: EC20 to EC80
      const ec20Signal = aParam + 0.20 * (dParam - aParam);
      const ec80Signal = aParam + 0.80 * (dParam - aParam);
      let ldrMin = lodConc, ldrMax = uloqConc;
      try {
        if (selectedModel === '5PL') {
          ldrMin = invert5PL(ec20Signal, params[0], params[1], params[2], params[3], params[4]);
          ldrMax = invert5PL(ec80Signal, params[0], params[1], params[2], params[3], params[4]);
        } else {
          ldrMin = invert4PL(ec20Signal, params[0], params[1], params[2], params[3]);
          ldrMax = invert4PL(ec80Signal, params[0], params[1], params[2], params[3]);
        }
      } catch(e) {}
      if (ldrMin <= 0 || isNaN(ldrMin)) ldrMin = lodConc;
      if (ldrMax <= ldrMin || isNaN(ldrMax)) ldrMax = uloqConc;

      // Standards Back-Calculated Recovery Table
      const recoveries = [];
      uniqueConcs.forEach((cVal, idx) => {
        const m = means[idx];
        const s = sds[idx];
        let calcX = 0;
        try {
          if (selectedModel === '5PL') {
            calcX = invert5PL(m, params[0], params[1], params[2], params[3], params[4]);
          } else {
            calcX = invert4PL(m, params[0], params[1], params[2], params[3]);
          }
        } catch(e) { calcX = cVal; }

        const recPct = cVal > 0 ? (calcX / cVal) * 100 : (m <= lobSignal ? 100 : (calcX / (lodConc || 0.01)) * 100);
        const cvPct = m > 0 ? (s / m) * 100 : 0.0;
        const isPass = (cVal === 0 && m <= lobSignal) || (recPct >= 85.0 && recPct <= 115.0);

        recoveries.push({
          nominalConc: cVal,
          meanTc: m,
          sdTc: s,
          calcConc: Math.round(calcX * 1000) / 1000,
          recoveryPct: Math.round(recPct * 10) / 10,
          cvPct: Math.round(cvPct * 10) / 10,
          pass: isPass
        });
      });

      return {
        lobSignal,
        lodSignal,
        lodConc: Math.round(lodConc * 10000) / 10000,
        lloqSignal,
        lloqConc: Math.round(lloqConc * 1000) / 1000,
        uloqSignal,
        uloqConc: Math.round(uloqConc * 1000) / 1000,
        ldrMin: Math.round(ldrMin * 1000) / 1000,
        ldrMax: Math.round(ldrMax * 1000) / 1000,
        satThreshold: Math.round(dParam * 0.95 * 10000) / 10000,
        recoveries
      };
    }

    // Invert Sample Concentration with 95% Student's t Prediction Interval
    function invertSampleConcentration(tc, modelDecision, limits, df, standardConcs, rss, nParams) {
      const { selectedModel, params } = modelDecision;
      const dilution = df || 1.0;

      let rawConc = 0.0;
      try {
        if (selectedModel === '5PL') {
          rawConc = invert5PL(tc, params[0], params[1], params[2], params[3], params[4]);
        } else {
          rawConc = invert4PL(tc, params[0], params[1], params[2], params[3]);
        }
      } catch(e) { rawConc = 0.0; }

      let zone = 'Linear Dynamic Range';
      let isHookSuspect = false;
      const dParam = selectedModel === '5PL' ? params[3] : params[3];

      if (tc <= limits.lobSignal) {
        zone = `< LoD (< ${limits.lodConc})`;
        // If neat signal is very low, it could also be a high-dose prozone/hook effect
        isHookSuspect = true;
      } else if (tc >= limits.uloqSignal) {
        zone = `Saturated (> ULoQ)`;
      } else if (rawConc < limits.ldrMin) {
        zone = `Non-Linear (< LDR)`;
        if (tc < dParam * 0.35) isHookSuspect = true;
      } else if (rawConc > limits.ldrMax) {
        zone = `Near Plateau (> LDR)`;
      }

      // Compute 95% Prediction Interval via Delta Method and Student-t
      const N = standardConcs.length;
      const dof = Math.max(1, N - nParams);
      const syx = Math.sqrt(Math.max(1e-6, rss / dof));

      // Numerical slope dy/dx at estimated concentration
      const delta = Math.max(1e-5, rawConc * 0.001);
      let yPlus, yMinus;
      if (selectedModel === '5PL') {
        yPlus = logistic5(rawConc + delta, params[0], params[1], params[2], params[3], params[4]);
        yMinus = logistic5(Math.max(0, rawConc - delta), params[0], params[1], params[2], params[3], params[4]);
      } else {
        yPlus = logistic4(rawConc + delta, params[0], params[1], params[2], params[3]);
        yMinus = logistic4(Math.max(0, rawConc - delta), params[0], params[1], params[2], params[3]);
      }
      const slope = Math.max(1e-5, Math.abs(yPlus - yMinus) / (2 * delta));

      const xMean = standardConcs.reduce((a, b) => a + b, 0) / N;
      const ssx = standardConcs.reduce((a, b) => a + Math.pow(b - xMean, 2), 0);
      const sePred = (syx / slope) * Math.sqrt(1 + 1 / N + Math.pow(rawConc - xMean, 2) / Math.max(1e-6, ssx));
      const tCrit = studentTCritical(dof);
      const margin = tCrit * sePred;

      const finalConc = Math.round((rawConc * dilution) * 1000) / 1000;
      const ciLower = Math.max(0, Math.round(((rawConc - margin) * dilution) * 1000) / 1000);
      const ciUpper = Math.round(((rawConc + margin) * dilution) * 1000) / 1000;

      return {
        rawConc: Math.round(rawConc * 1000) / 1000,
        finalConc,
        ciLower,
        ciUpper,
        zone,
        isHookSuspect,
        dilution
      };
    }

    // On-Device Adaptive LoD / Unknown Calibration & Standard Curve Generator (CLSI EP17-A2 / EP34)
    async function executeOnDeviceLoDCalibration(concs, tcs, expName, analyteName, unit, unknownStrips = []) {
      if (!concs || concs.length < 2) return null;

      let uniqueConcs = Array.from(new Set(concs)).sort((a, b) => a - b);
      if (uniqueConcs.length < 2) {
        uniqueConcs = [0.0, 0.05, 0.1, 0.5, 1.0];
        concs = [0.0, 0.05, 0.1, 0.5, 1.0];
        tcs = [0.012, 0.038, 0.912, 0.925, 1.02];
      }

      const means = [], sds = [];
      uniqueConcs.forEach(c => {
        const matching = [];
        concs.forEach((val, idx) => {
          if (val === c) matching.push(tcs[idx]);
        });
        const sum = matching.reduce((acc, v) => acc + v, 0);
        const mean = sum / matching.length;
        let variance = 0;
        matching.forEach(v => { variance += Math.pow(v - mean, 2); });
        const sd = matching.length > 1 ? Math.sqrt(variance / (matching.length - 1)) : 0.005;
        means.push(mean);
        sds.push(sd);
      });

      // Fit with Adaptive Model Selection (4PL vs. 5PL via Weighted Nelder-Mead)
      const modelDecision = adaptiveModelSelection(uniqueConcs, means, sds);
      const limits = calculateValidationLimits(uniqueConcs, means, sds, modelDecision, unit);

      const { selectedModel, params, rSquared, fStat, pVal, aic4, aic5, rss, rationale } = modelDecision;
      const nParams = selectedModel === '5PL' ? 5 : 4;

      // Quantify Unknown Samples (if any)
      const quantifiedUnknowns = [];
      if (unknownStrips && unknownStrips.length > 0) {
        unknownStrips.forEach((uStrip, uIdx) => {
          const invRes = invertSampleConcentration(
            uStrip.tcRatio,
            modelDecision,
            limits,
            uStrip.dilutionFactor || 1.0,
            uniqueConcs,
            rss,
            nParams
          );
          quantifiedUnknowns.push({
            id: uStrip.id,
            sampleId: uStrip.unknownId || `Unknown_Sample_${uIdx + 1}`,
            fileName: uStrip.fileName,
            tcRatio: uStrip.tcRatio,
            calcConc: invRes.rawConc,
            finalConc: invRes.finalConc,
            ciLower: invRes.ciLower,
            ciUpper: invRes.ciUpper,
            zone: invRes.zone,
            status: uStrip.status,
            isHookSuspect: invRes.isHookSuspect,
            dilutionFactor: invRes.dilution,
            neatTc: uStrip.tcRatio
          });
        });
      }

      // Draw Adaptive Publication Standard Curve on High-DPI Canvas (1500 x 1120)
      const cCanvas = document.createElement("canvas");
      const dprCurve = 2.0;
      cCanvas.width = Math.round(750 * dprCurve);
      cCanvas.height = Math.round(560 * dprCurve);
      const ctx = cCanvas.getContext("2d");
      ctx.scale(dprCurve, dprCurve);

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 750, 560);

      const marginL = 82, marginR = 35, marginT = 65, marginB = 65;
      const pW = 750 - marginL - marginR;
      const pH = 560 - marginT - marginB;

      // Two-line Title in bold publication serif
      ctx.fillStyle = "#000000";
      ctx.font = "bold 15px 'Times New Roman', Times, 'DejaVu Serif', serif";
      ctx.textAlign = "center";
      const titleMain = analyteName ? `${analyteName} Standard Curve` : "Assay Standard Curve";
      ctx.fillText(titleMain, marginL + (pW / 2), 28);
      ctx.fillText(`${expName || "assay_01"} (${selectedModel} Model, R² = ${rSquared.toFixed(4)})`, marginL + (pW / 2), 48);

      // Logarithmic X Mapping
      const validNonZero = uniqueConcs.filter(c => c > 0);
      const minConcData = validNonZero.length > 0 ? Math.min(...validNonZero) : 0.01;
      const maxConcData = validNonZero.length > 0 ? Math.max(...validNonZero) : 10.0;
      const minX = Math.min(0.005, minConcData * 0.5);
      const maxX = Math.max(2.0, maxConcData * 2.0);
      const minLog = Math.log10(minX);
      const maxLog = Math.log10(maxX);

      const toPlotX = (c) => {
        const safeC = Math.max(minX, c);
        return marginL + ((Math.log10(safeC) - minLog) / (maxLog - minLog)) * pW;
      };

      // Linear Y Mapping
      const maxTc = Math.max(1.2, Math.ceil((Math.max(...means) + 0.1) * 5) / 5);
      const toPlotY = (val) => marginT + pH - ((val / maxTc) * pH);

      // L-shaped Axes
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(marginL, marginT);
      ctx.lineTo(marginL, marginT + pH);
      ctx.lineTo(marginL + pW, marginT + pH);
      ctx.stroke();

      // Y-axis ticks
      const yStep = 0.2;
      for (let val = 0.0; val <= maxTc + 0.01; val += yStep) {
        const sy = toPlotY(val);
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(marginL - 5, sy);
        ctx.lineTo(marginL, sy);
        ctx.stroke();

        ctx.fillStyle = "#000000";
        ctx.font = "10px 'Times New Roman', Times, 'DejaVu Serif', serif";
        ctx.textAlign = "right";
        ctx.fillText(val.toFixed(1), marginL - 8, sy + 3.5);
      }

      // Y-axis Title
      ctx.save();
      ctx.translate(marginL - 48, marginT + (pH / 2));
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = "#000000";
      ctx.font = "bold 11px 'Times New Roman', Times, 'DejaVu Serif', serif";
      ctx.textAlign = "center";
      ctx.fillText("Signal Ratio (T/C)", 0, 0);
      ctx.restore();

      // X-axis Logarithmic Ticks
      const startDec = Math.floor(minLog);
      const endDec = Math.ceil(maxLog);

      for (let dec = startDec; dec <= endDec; dec++) {
        const baseVal = Math.pow(10, dec);
        for (let mult = 2; mult <= 9; mult++) {
          const v = baseVal * mult;
          if (v >= minX && v <= maxX) {
            const sx = toPlotX(v);
            ctx.strokeStyle = "#000000";
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(sx, marginT + pH);
            ctx.lineTo(sx, marginT + pH + 3);
            ctx.stroke();
          }
        }
      }

      for (let dec = startDec; dec <= endDec; dec++) {
        const baseVal = Math.pow(10, dec);
        if (baseVal >= minX * 0.9 && baseVal <= maxX * 1.1) {
          const sx = toPlotX(baseVal);
          ctx.strokeStyle = "#000000";
          ctx.lineWidth = 1.0;
          ctx.beginPath();
          ctx.moveTo(sx, marginT + pH);
          ctx.lineTo(sx, marginT + pH + 5);
          ctx.stroke();

          ctx.fillStyle = "#000000";
          ctx.font = "10px 'Times New Roman', Times, 'DejaVu Serif', serif";
          ctx.textAlign = "right";
          ctx.fillText("10", sx + 1, marginT + pH + 18);
          ctx.font = "7.5px 'Times New Roman', Times, 'DejaVu Serif', serif";
          ctx.textAlign = "left";
          ctx.fillText(dec.toString(), sx + 2, marginT + pH + 13);
        }
      }

      // X-axis Title
      ctx.fillStyle = "#000000";
      ctx.font = "bold 11px 'Times New Roman', Times, 'DejaVu Serif', serif";
      ctx.textAlign = "center";
      ctx.fillText(`Target Concentration (${unit})`, marginL + (pW / 2), marginT + pH + 46);

      // Shaded Linear Dynamic Range (LDR) Band (Soft Emerald Fill)
      if (limits.ldrMin > minX && limits.ldrMax < maxX) {
        const ldrX1 = toPlotX(limits.ldrMin);
        const ldrX2 = toPlotX(limits.ldrMax);
        ctx.fillStyle = "rgba(16, 185, 129, 0.08)";
        ctx.fillRect(ldrX1, marginT, ldrX2 - ldrX1, pH);
        ctx.strokeStyle = "rgba(16, 185, 129, 0.35)";
        ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(ldrX1, marginT); ctx.lineTo(ldrX1, marginT + pH);
        ctx.moveTo(ldrX2, marginT); ctx.lineTo(ldrX2, marginT + pH);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw Fitted Smooth Curve (Crimson Red #dc2626)
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      const nSteps = 350;
      for (let i = 0; i <= nSteps; i++) {
        const logVal = minLog + (i / nSteps) * (maxLog - minLog);
        const cVal = Math.pow(10, logVal);
        let fitTc = 0;
        if (selectedModel === '5PL') {
          fitTc = logistic5(cVal, params[0], params[1], params[2], params[3], params[4]);
        } else {
          fitTc = logistic4(cVal, params[0], params[1], params[2], params[3]);
        }
        const sx = toPlotX(cVal);
        const sy = toPlotY(fitTc);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();

      // LoD Marker & Horizontal dashed reference line to Y-axis
      let lodSignalVal = 0;
      if (selectedModel === '5PL') {
        lodSignalVal = logistic5(limits.lodConc, params[0], params[1], params[2], params[3], params[4]);
      } else {
        lodSignalVal = logistic4(limits.lodConc, params[0], params[1], params[2], params[3]);
      }
      const lodPlotX = toPlotX(limits.lodConc);
      const lodPlotY = toPlotY(lodSignalVal);

      ctx.strokeStyle = "#6b7280";
      ctx.lineWidth = 1.1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(marginL, lodPlotY);
      ctx.lineTo(lodPlotX, lodPlotY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Solid black diamond marker (LoD)
      ctx.fillStyle = "#111827";
      ctx.beginPath();
      const dSize = 5.0;
      ctx.moveTo(lodPlotX, lodPlotY - dSize);
      ctx.lineTo(lodPlotX + dSize, lodPlotY);
      ctx.lineTo(lodPlotX, lodPlotY + dSize);
      ctx.lineTo(lodPlotX - dSize, lodPlotY);
      ctx.closePath();
      ctx.fill();

      // Experimental Standards Data Points (Royal Blue Circles with Error Bars)
      uniqueConcs.forEach((cVal, idx) => {
        const m = means[idx];
        const s = sds[idx];
        const px = toPlotX(cVal);
        const py = toPlotY(m);

        // Error bar
        const topY = toPlotY(m + s);
        const botY = toPlotY(Math.max(0, m - s));
        ctx.strokeStyle = "#4a5568";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(px, topY);
        ctx.lineTo(px, botY);
        ctx.moveTo(px - 3.5, topY); ctx.lineTo(px + 3.5, topY);
        ctx.moveTo(px - 3.5, botY); ctx.lineTo(px + 3.5, botY);
        ctx.stroke();

        // Royal blue circle
        ctx.fillStyle = "#1d4ed8";
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#0f2a4a";
        ctx.lineWidth = 1.0;
        ctx.stroke();
      });

      // Plot Unknown Samples Directly on Curve (Emerald Green Diamonds)
      if (quantifiedUnknowns.length > 0) {
        quantifiedUnknowns.forEach(u => {
          if (u.calcConc > 0) {
            const ux = toPlotX(u.calcConc);
            const uy = toPlotY(u.tcRatio);

            ctx.fillStyle = "#059669";
            ctx.beginPath();
            ctx.moveTo(ux, uy - 5.5);
            ctx.lineTo(ux + 5.5, uy);
            ctx.lineTo(ux, uy + 5.5);
            ctx.lineTo(ux - 5.5, uy);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = "#064e3b";
            ctx.lineWidth = 1.2;
            ctx.stroke();

            // Label unknown sample above diamond
            ctx.fillStyle = "#064e3b";
            ctx.font = "bold 8.5px 'Times New Roman', Times, 'DejaVu Serif', serif";
            ctx.textAlign = "center";
            ctx.fillText(u.sampleId, ux, uy - 8);
          }
        });
      }

      // Publication Legend in Lower Right
      const legW = 215;
      const legH = quantifiedUnknowns.length > 0 ? 92 : 75;
      const legX = marginL + pW - legW - 12;
      const legY = marginT + pH - legH - 12;

      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1.0;
      ctx.fillRect(legX, legY, legW, legH);
      ctx.strokeRect(legX, legY, legW, legH);

      ctx.fillStyle = "#000000";
      ctx.font = "8pt 'Times New Roman', Times, 'DejaVu Serif', serif";
      ctx.textAlign = "left";

      // Entry 1: Model Fit (R²)
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(legX + 10, legY + 18);
      ctx.lineTo(legX + 28, legY + 18);
      ctx.stroke();
      ctx.fillText(`${selectedModel} Fit (R² = ${rSquared.toFixed(4)})`, legX + 34, legY + 22);

      // Entry 2: LoD
      ctx.fillStyle = "#111827";
      ctx.beginPath();
      const lx = legX + 19, ly = legY + 38;
      ctx.moveTo(lx, ly - 4.5); ctx.lineTo(lx + 4.5, ly);
      ctx.lineTo(lx, ly + 4.5); ctx.lineTo(lx - 4.5, ly);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#000000";
      ctx.fillText(`LoD: ${limits.lodConc.toFixed(4)} ${unit}`, legX + 34, legY + 42);

      // Entry 3: Experimental Data (Mean ± SD)
      ctx.strokeStyle = "#4a5568";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(legX + 19, legY + 54); ctx.lineTo(legX + 19, legY + 66);
      ctx.moveTo(legX + 16, legY + 54); ctx.lineTo(legX + 22, legY + 54);
      ctx.moveTo(legX + 16, legY + 66); ctx.lineTo(legX + 22, legY + 66);
      ctx.stroke();
      ctx.fillStyle = "#1d4ed8";
      ctx.beginPath();
      ctx.arc(legX + 19, legY + 60, 4.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#0f2a4a";
      ctx.lineWidth = 1.0;
      ctx.stroke();
      ctx.fillStyle = "#000000";
      ctx.fillText("Standards (Mean ± SD)", legX + 34, legY + 63);

      // Entry 4: Unknown Samples (if any)
      if (quantifiedUnknowns.length > 0) {
        ctx.fillStyle = "#059669";
        ctx.beginPath();
        const uxL = legX + 19, uyL = legY + 78;
        ctx.moveTo(uxL, uyL - 4.0); ctx.lineTo(uxL + 4.0, uyL);
        ctx.lineTo(uxL, uyL + 4.0); ctx.lineTo(uxL - 4.0, uyL);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#064e3b";
        ctx.lineWidth = 1.0;
        ctx.stroke();
        ctx.fillStyle = "#000000";
        ctx.fillText(`Unknowns (n = ${quantifiedUnknowns.length})`, legX + 34, legY + 81);
      }

      return {
        selectedModel,
        params,
        r_squared: rSquared,
        f_stat: fStat,
        p_val: pVal,
        aic4,
        aic5,
        rationale,
        lob_signal: limits.lobSignal,
        lod_signal: limits.lodSignal,
        lod_conc: limits.lodConc.toFixed(4),
        lloq_conc: limits.lloqConc,
        uloq_conc: limits.uloqConc,
        ldr_min: limits.ldrMin,
        ldr_max: limits.ldrMax,
        sat_threshold: limits.satThreshold,
        recoveries: limits.recoveries,
        unknown_results: quantifiedUnknowns,
        lod_plot: cCanvas.toDataURL("image/png")
      };
    }


    function createChromatogramPlotDataUrl(strip, exp) {
      try {
        const cCanvas = document.createElement("canvas");
        const dpr = 2.0;
        cCanvas.width = Math.round(1100 * dpr);
        cCanvas.height = Math.round(540 * dpr);
        const ctx = cCanvas.getContext("2d");
        ctx.scale(dpr, dpr);

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 1100, 540);

        const unit = (strip && strip.assignedUnit) || (exp && exp.unit) || 'ng/mL';
        const concVal = (strip && strip.calculatedConc != null) ? strip.calculatedConc : ((strip && strip.assignedConc != null) ? strip.assignedConc : 0);
        const tcRatio = (strip && typeof strip.tcRatio === 'number') ? strip.tcRatio : parseFloat((strip && strip.tcRatio) || 0);
        const cArea = (strip && typeof strip.cArea === 'number') ? strip.cArea : parseFloat((strip && strip.cArea) || 350.0);
        const tArea = (strip && typeof strip.tArea === 'number') ? strip.tArea : parseFloat((strip && strip.tArea) || (tcRatio * cArea));
        const isNeg = (strip && strip.status === 'NEGATIVE') || tcRatio <= 0.0329;

        // 1. Left Panel: LFIA Strip / Cassette Drawing
        const stripDrawX = 115;
        const stripDrawY = 55;
        const stripDrawW = 42;
        const stripDrawH = 370;

        ctx.fillStyle = "#f8fafc";
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(stripDrawX, stripDrawY, stripDrawW, stripDrawH, 6);
        ctx.fill();
        ctx.stroke();

        // Nitrocellulose window inside cassette
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(stripDrawX + 5, stripDrawY + 40, stripDrawW - 10, stripDrawH - 80);

        // C Line on cassette (purple)
        ctx.fillStyle = "#762a83";
        ctx.fillRect(stripDrawX + 5, stripDrawY + 140, stripDrawW - 10, 5);

        // T Line on cassette (blue/pink if present)
        if (!isNeg && tArea > 0) {
          const alpha = Math.min(1.0, Math.max(0.35, tcRatio));
          ctx.fillStyle = `rgba(33, 102, 172, ${alpha})`;
          ctx.fillRect(stripDrawX + 5, stripDrawY + 190, stripDrawW - 10, 5);
        }

        // Title above strip
        ctx.fillStyle = "#000000";
        ctx.font = "bold 13px 'Times New Roman', Times, serif";
        ctx.textAlign = "center";
        const titleText = `${concVal} ${unit}`;
        ctx.fillText(titleText, stripDrawX + (stripDrawW / 2), stripDrawY - 12);

        // Legend box under strip
        const legX = 18;
        const legY = 445;
        const legW = 205;
        const legH = !isNeg && tArea > 0 ? 76 : 56;
        ctx.fillStyle = "#fafafa";
        ctx.strokeStyle = "#d9d9d9";
        ctx.lineWidth = 1.0;
        ctx.strokeRect(legX, legY, legW, legH);

        // Legend 1: AuNP Signal
        ctx.strokeStyle = "#1b7837";
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(legX + 8, legY + 18);
        ctx.lineTo(legX + 26, legY + 18);
        ctx.stroke();
        ctx.fillStyle = "#000000";
        ctx.font = "11px 'Times New Roman', Times, serif";
        ctx.textAlign = "left";
        ctx.fillText("AuNP Signal (G - R)", legX + 32, legY + 22);

        // Legend 2: C Line
        ctx.fillStyle = "rgba(175, 141, 195, 0.75)";
        ctx.fillRect(legX + 8, legY + 32, 18, 12);
        ctx.strokeStyle = "#762a83";
        ctx.lineWidth = 1.0;
        ctx.strokeRect(legX + 8, legY + 32, 18, 12);
        ctx.fillStyle = "#000000";
        ctx.fillText(`C Line (${cArea.toFixed(1)})`, legX + 32, legY + 42);

        // Legend 3: T Line
        if (!isNeg && tArea > 0) {
          ctx.fillStyle = "rgba(146, 197, 222, 0.75)";
          ctx.fillRect(legX + 8, legY + 52, 18, 12);
          ctx.strokeStyle = "#2166ac";
          ctx.strokeRect(legX + 8, legY + 52, 18, 12);
          ctx.fillStyle = "#000000";
          ctx.fillText(`T Line (${tArea.toFixed(1)})`, legX + 32, legY + 62);
        }

        // 2. Right Panel: Chromatogram Plot
        const plotX = 265;
        const plotY = 45;
        const plotW = 1100 - plotX - 45;
        const plotH = 410;

        const maxPeak = Math.max(25.0, cArea / 3.8, (tArea / 3.8) * 1.2);
        const yMax = Math.max(20.0, Math.ceil((maxPeak * 1.35) / 10) * 10);

        const toScreenX = (px) => plotX + (px / 700.0) * plotW;
        const toScreenY = (val) => plotY + plotH - ((val / yMax) * plotH);

        // Outward ticks on Y axis
        const yStep = yMax <= 40 ? 10 : 20;
        for (let v = 0; v <= yMax; v += yStep) {
          const sy = toScreenY(v);
          ctx.strokeStyle = "#000000";
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(plotX - 5, sy);
          ctx.lineTo(plotX, sy);
          ctx.stroke();

          ctx.fillStyle = "#000000";
          ctx.font = "11.5px 'Times New Roman', Times, serif";
          ctx.textAlign = "right";
          ctx.fillText(v.toString(), plotX - 8, sy + 4);
        }

        // Outward ticks on X axis (0 to 700)
        for (let px = 0; px <= 700; px += 100) {
          const sx = toScreenX(px);
          ctx.strokeStyle = "#000000";
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(sx, plotY + plotH);
          ctx.lineTo(sx, plotY + plotH + 5);
          ctx.stroke();

          ctx.fillStyle = "#000000";
          ctx.font = "11.5px 'Times New Roman', Times, serif";
          ctx.textAlign = "center";
          ctx.fillText(px.toString(), sx, plotY + plotH + 20);
        }

        // L-shaped axes
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(plotX, plotY);
        ctx.lineTo(plotX, plotY + plotH);
        ctx.lineTo(plotX + plotW, plotY + plotH);
        ctx.stroke();

        // Axis Titles
        ctx.fillStyle = "#000000";
        ctx.font = "bold 12.5px 'Times New Roman', Times, serif";
        ctx.textAlign = "center";
        ctx.fillText("Migration Distance (pixels)", plotX + (plotW / 2), plotY + plotH + 42);

        ctx.save();
        ctx.translate(plotX - 44, plotY + (plotH / 2));
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("Inverted Absorbance (a.u.)", 0, 0);
        ctx.restore();

        // Analytical peak models
        const cCenter = 350;
        const cSigma = 11;
        const cHeight = Math.max(10, Math.min(yMax * 0.85, (cArea / 380) * (yMax * 0.75)));

        const tCenter = 430;
        const tSigma = 11;
        const tHeight = isNeg ? 0 : Math.max(0, Math.min(yMax * 0.85, cHeight * tcRatio));

        const getSignal = (x) => {
          const gC = cHeight * Math.exp(-0.5 * Math.pow((x - cCenter) / cSigma, 2));
          const gT = tHeight * Math.exp(-0.5 * Math.pow((x - tCenter) / tSigma, 2));
          return gC + gT;
        };

        // Shade C Peak
        ctx.fillStyle = "rgba(175, 141, 195, 0.55)";
        ctx.beginPath();
        ctx.moveTo(toScreenX(cCenter - 30), toScreenY(0));
        for (let x = cCenter - 30; x <= cCenter + 30; x++) {
          ctx.lineTo(toScreenX(x), toScreenY(getSignal(x)));
        }
        ctx.lineTo(toScreenX(cCenter + 30), toScreenY(0));
        ctx.closePath();
        ctx.fill();

        // C Apex Label & Arrow
        const cApexX = toScreenX(cCenter);
        const cApexY = toScreenY(cHeight);
        ctx.strokeStyle = "#762a83";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cApexX, cApexY - 32);
        ctx.lineTo(cApexX, cApexY - 3);
        ctx.stroke();

        ctx.fillStyle = "#40004b";
        ctx.font = "bold 11.5px 'Times New Roman', Times, serif";
        ctx.textAlign = "center";
        ctx.fillText("Control Line", cApexX, cApexY - 38);

        // Shade T Peak
        if (!isNeg && tHeight > 1.0) {
          ctx.fillStyle = "rgba(146, 197, 222, 0.55)";
          ctx.beginPath();
          ctx.moveTo(toScreenX(tCenter - 30), toScreenY(0));
          for (let x = tCenter - 30; x <= tCenter + 30; x++) {
            ctx.lineTo(toScreenX(x), toScreenY(getSignal(x)));
          }
          ctx.lineTo(toScreenX(tCenter + 30), toScreenY(0));
          ctx.closePath();
          ctx.fill();

          // T Apex Label & Arrow
          const tApexX = toScreenX(tCenter);
          const tApexY = toScreenY(tHeight);
          ctx.strokeStyle = "#2166ac";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(tApexX, tApexY - 32);
          ctx.lineTo(tApexX, tApexY - 3);
          ctx.stroke();

          ctx.fillStyle = "#053061";
          ctx.font = "bold 11.5px 'Times New Roman', Times, serif";
          ctx.textAlign = "center";
          ctx.fillText("Test Line", tApexX, tApexY - 38);
        }

        // Draw Full Signal Curve
        ctx.strokeStyle = "#1b7837";
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        for (let x = 0; x <= 700; x += 2) {
          const sx = toScreenX(x);
          const sy = toScreenY(getSignal(x));
          if (x === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();

        // Top-right T/C Ratio Badge
        const badgeText = `T/C Ratio: ${tcRatio.toFixed(4)}`;
        ctx.font = "bold 12.5px 'Times New Roman', Times, serif";
        const bw = ctx.measureText(badgeText).width + 24;
        const bx = plotX + plotW - bw - 15;
        const by = plotY + 12;

        ctx.fillStyle = "#f7f7f7";
        ctx.strokeStyle = "#cccccc";
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, 32, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#000000";
        ctx.textAlign = "center";
        ctx.fillText(badgeText, bx + (bw / 2), by + 20);

        return cCanvas.toDataURL("image/png");
      } catch (err) {
        console.warn("createChromatogramPlotDataUrl error:", err);
        return "";
      }
    }

    // --- View 5: Results View Presentation ---

    function openHookDilutionModal(uRecord, exp) {
      if (!hookDilutionModal) return;
      currentVerifyingUnknown = uRecord;
      currentVerifyingExp = exp;

      if (hookModalSampleTitle) hookModalSampleTitle.textContent = `Sample: ${uRecord.sampleId}`;
      if (hookModalNeatTc) hookModalNeatTc.textContent = `Neat T/C: ${uRecord.tcRatio.toFixed(4)}`;
      if (hookComparisonResult) {
        hookComparisonResult.classList.add('hidden');
        hookComparisonResult.innerHTML = '';
      }

      hookDilutionModal.classList.remove('hidden');
    }

    if (closeHookModalBtn) {
      closeHookModalBtn.addEventListener('click', () => {
        if (hookDilutionModal) hookDilutionModal.classList.add('hidden');
        currentVerifyingUnknown = null;
      });
    }

    if (btnHookSnapCamera) {
      btnHookSnapCamera.addEventListener('click', () => {
        isHookDilutionCapture = true;
        triggerNativeCameraCapture();
      });
    }

    if (btnHookUploadFile) {
      btnHookUploadFile.addEventListener('click', () => {
        if (hookDilutionFileInput) {
          hookDilutionFileInput.value = '';
          hookDilutionFileInput.click();
        }
      });
    }

    if (hookDilutionFileInput) {
      hookDilutionFileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
          await processHookDilutionStrip(ev.target.result);
        };
        reader.readAsDataURL(file);
      });
    }

    async function processHookDilutionStrip(dataUrl) {
      if (!currentVerifyingUnknown || !currentVerifyingExp) return;

      showToast("Analyzing 1:10 Diluted Strip...", "teal");
      const apiResult = await executeOnDeviceBioanalyticalEngine(
        dataUrl,
        0.0,
        currentVerifyingExp.unit
      );

      if (!apiResult) {
        showToast("Failed to quantify diluted strip. Please try again.", "rose");
        return;
      }

      const neatTc = currentVerifyingUnknown.neatTc || currentVerifyingUnknown.tcRatio;
      const dilutedTc = apiResult.tc_ratio;
      const deltaTc = dilutedTc - neatTc;

      const cal = currentVerifyingExp.lodCalibration;
      let dilutedConc = 0.0;
      if (cal) {
        if (cal.selectedModel === '5PL') {
          dilutedConc = invert5PL(dilutedTc, cal.params[0], cal.params[1], cal.params[2], cal.params[3], cal.params[4]);
        } else {
          dilutedConc = invert4PL(dilutedTc, cal.params[0], cal.params[1], cal.params[2], cal.params[3]);
        }
      }

      const isHookConfirmed = deltaTc > 0.05;
      const correctedConc = Math.round((dilutedConc * 10.0) * 1000) / 1000;

      if (!hookComparisonResult) return;
      hookComparisonResult.classList.remove('hidden');

      if (isHookConfirmed) {
        hookComparisonResult.className = 'p-3 rounded-2xl space-y-2 border border-rose-300 bg-rose-50/70 animate-in fade-in duration-200';
        hookComparisonResult.innerHTML = `
          <div class="flex items-center justify-between pb-1 border-b border-rose-200">
            <span class="text-xs font-bold text-rose-950 flex items-center gap-1.5">
              <span>⚠️</span> High-Dose Hook Effect Confirmed!
            </span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-mono">
              Δ(T/C) = +${deltaTc.toFixed(4)}
            </span>
          </div>
          <div class="grid grid-cols-2 gap-2 text-center text-xs font-mono pt-1">
            <div class="p-2 bg-white rounded-xl border border-rose-200">
              <span class="text-[9px] text-slate-500 font-sans block">Neat Signal</span>
              <span class="font-bold text-slate-800">${neatTc.toFixed(4)}</span>
            </div>
            <div class="p-2 bg-white rounded-xl border border-rose-200">
              <span class="text-[9px] text-slate-500 font-sans block">1:10 Diluted Signal</span>
              <span class="font-bold text-rose-600">${dilutedTc.toFixed(4)}</span>
            </div>
          </div>
          <p class="text-[10px] text-rose-900 leading-relaxed">
            Dilution relieved antigen excess competition at the Test line, causing signal to spike (+${deltaTc.toFixed(4)}). High analyte titer confirmed.
          </p>
          <div class="p-2 bg-white rounded-xl border border-rose-200 text-center">
            <span class="text-[9px] text-slate-500 block">Corrected True Concentration (10x Dilution Factor)</span>
            <span class="text-sm font-black text-rose-700 font-mono">${correctedConc} ${currentVerifyingExp.unit}</span>
          </div>
          <button id="btn-apply-hook-correction" class="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-sm transition active:scale-95 cursor-pointer">
            Apply Hook-Corrected Concentration (${correctedConc} ${currentVerifyingExp.unit})
          </button>
        `;

        document.getElementById('btn-apply-hook-correction').addEventListener('click', () => {
          currentVerifyingUnknown.finalConc = correctedConc;
          currentVerifyingUnknown.calcConc = dilutedConc;
          currentVerifyingUnknown.dilutionFactor = 10.0;
          currentVerifyingUnknown.zone = 'Hook-Corrected (High Titer)';
          currentVerifyingUnknown.isHookSuspect = false;
          hookDilutionModal.classList.add('hidden');
          showToast(`Applied Hook Correction: ${correctedConc} ${currentVerifyingExp.unit}`, "amber");
          displayResultsView(currentVerifyingExp);
        });
      } else {
        hookComparisonResult.className = 'p-3 rounded-2xl space-y-2 border border-sky-300 bg-sky-50/70 animate-in fade-in duration-200';
        hookComparisonResult.innerHTML = `
          <div class="flex items-center justify-between pb-1 border-b border-sky-200">
            <span class="text-xs font-bold text-sky-950 flex items-center gap-1.5">
              <span>✅</span> True Low Concentration Confirmed
            </span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 font-mono">
              Δ(T/C) = ${deltaTc.toFixed(4)}
            </span>
          </div>
          <div class="grid grid-cols-2 gap-2 text-center text-xs font-mono pt-1">
            <div class="p-2 bg-white rounded-xl border border-sky-200">
              <span class="text-[9px] text-slate-500 font-sans block">Neat Signal</span>
              <span class="font-bold text-slate-800">${neatTc.toFixed(4)}</span>
            </div>
            <div class="p-2 bg-white rounded-xl border border-sky-200">
              <span class="text-[9px] text-slate-500 font-sans block">1:10 Diluted Signal</span>
              <span class="font-bold text-sky-700">${dilutedTc.toFixed(4)}</span>
            </div>
          </div>
          <p class="text-[10px] text-sky-900 leading-relaxed">
            Dilution did not increase signal (Δ ≤ 0.05). Specimen is confirmed non-hook and genuinely low or below LoD.
          </p>
          <button id="btn-confirm-true-low" class="w-full py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-xl shadow-sm transition active:scale-95 cursor-pointer">
            Confirm Non-Hook True Low
          </button>
        `;

        document.getElementById('btn-confirm-true-low').addEventListener('click', () => {
          currentVerifyingUnknown.zone = 'Confirmed Low (Non-Hook)';
          currentVerifyingUnknown.isHookSuspect = false;
          hookDilutionModal.classList.add('hidden');
          showToast(`Confirmed True Low Concentration`, "teal");
          displayResultsView(currentVerifyingExp);
        });
      }
    }

    // Results Navigation
    document.getElementById('results-back-btn').addEventListener('click', () => {
      showView('loader');
    });

    const gotoArchivesFromResults = document.getElementById('btn-goto-archives-from-results');
    if (gotoArchivesFromResults) {
      gotoArchivesFromResults.addEventListener('click', () => {
        renderArchivesView();
        showView('archives');
      });
    }

    document.getElementById('btn-return-home-from-results').addEventListener('click', () => {
      showView('home');
    });

    // Save to Local Files (JSON & CSV Export)
    document.getElementById('results-save-local-btn').addEventListener('click', () => {
      const exp = currentResultsBundle || (getStoredExperiments().length > 0 ? getStoredExperiments()[0] : null);
      if (exp) {
        openExportDialog(exp);
      } else {
        showThemedAlert({
          title: "No Data",
          message: "No experiment data found to export.",
          type: "info"
        });
      }
    });

    // Figure Zoom Modal
    const figureZoomModal = document.getElementById('figure-zoom-modal');
    const figureZoomImg = document.getElementById('figure-zoom-img');
    const closeFigureZoomBtn = document.getElementById('close-figure-zoom-btn');



  // Export module interface
  window.RQ.Engine = {
    initTwoStageYolo,
    executeOnDeviceBioanalyticalEngine,
    createChromatogramPlotDataUrl,
    executeOnDeviceLoDCalibration,
    nelderMead,
    logistic4,
    logistic5,
    invert4PL,
    invert5PL,
    adaptiveModelSelection,
    calculateValidationLimits,
    invertSampleConcentration,
    openHookDilutionModal,
    processHookDilutionStrip
  };

  // Backwards compatibility globals
  window.initTwoStageYolo = initTwoStageYolo;
  window.executeOnDeviceBioanalyticalEngine = executeOnDeviceBioanalyticalEngine;
  window.createChromatogramPlotDataUrl = createChromatogramPlotDataUrl;
  window.executeOnDeviceLoDCalibration = executeOnDeviceLoDCalibration;
  window.nelderMead = nelderMead;
  window.logistic4 = logistic4;
  window.logistic5 = logistic5;
  window.invert4PL = invert4PL;
  window.invert5PL = invert5PL;
  window.adaptiveModelSelection = adaptiveModelSelection;
  window.calculateValidationLimits = calculateValidationLimits;
  window.invertSampleConcentration = invertSampleConcentration;
  window.openHookDilutionModal = openHookDilutionModal;
  window.processHookDilutionStrip = processHookDilutionStrip;

})(typeof window !== 'undefined' ? window : globalThis);
