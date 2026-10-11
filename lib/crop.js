// Phase 0 check #4 — the DPR crop, the likeliest silent bug.
//
// chrome.tabs.captureVisibleTab returns a PNG at the tab's DEVICE pixels:
// its dimensions are (cssWidth * dpr) x (cssHeight * dpr). So a region
// expressed in CSS pixels (as getBoundingClientRect gives in Phase 1) must
// have every coordinate multiplied by dpr before cropping, or you grab a
// region that's 1/dpr the intended size (half, on a 2x Mac display).
//
// NOTE for Phase 1: the robust scale factor is capturedImage.naturalWidth /
// tabViewportCssWidth, read from a content script. That handles page zoom too,
// which window.devicePixelRatio alone does not. This spike uses the panel's
// devicePixelRatio to make the bug visible without injecting a content script.

export function dataUrlToImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode captured image."));
    img.src = dataUrl;
  });
}

// rectCss: { x, y, w, h } in CSS pixels. When applyDpr is false we deliberately
// skip the scale, so the caller can show the wrong-size result side by side.
export async function cropToBlob(image, rectCss, dpr, applyDpr = true) {
  const s = applyDpr ? dpr : 1;
  const sx = Math.round(rectCss.x * s);
  const sy = Math.round(rectCss.y * s);
  const sw = Math.max(1, Math.round(rectCss.w * s));
  const sh = Math.max(1, Math.round(rectCss.h * s));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  return { blob, w: sw, h: sh };
}

// Phase 1 — crop a picked element. scale = capturedImage.naturalWidth /
// tabViewportCssWidth (robust: folds in DPR *and* page zoom, unlike devicePixelRatio
// alone). Coordinates clamped to the captured image so edge elements don't overflow.
export async function cropRegion(image, rectCss, scale) {
  const sx = Math.max(0, Math.round(rectCss.x * scale));
  const sy = Math.max(0, Math.round(rectCss.y * scale));
  let sw = Math.round(rectCss.w * scale);
  let sh = Math.round(rectCss.h * scale);
  sw = Math.max(1, Math.min(sw, image.naturalWidth - sx));
  sh = Math.max(1, Math.min(sh, image.naturalHeight - sy));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext("2d").drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  return { blob, w: sw, h: sh };
}

// Pure crop geometry (NO DOM) — the single tested helper. Intersects the picked
// CSS rect with the viewport (all four edges), then maps the visible part to the
// captured image's device pixels. Scale comes from the captured image / originating
// viewport (folds DPR + page zoom, no double scaling), NOT the panel's DPR.
// Returns null for invalid / non-finite / zero-size / fully-offscreen rects.
// `clipped` means only part of the element was on screen.
export function planCrop(rect, vw, vh, imageW, imageH) {
  const fin = (n) => Number.isFinite(n);
  if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(fin)) return null;
  if (!fin(vw) || !fin(vh) || vw <= 0 || vh <= 0 || !fin(imageW) || !fin(imageH) || imageW <= 0 || imageH <= 0) return null;
  if (rect.w <= 0 || rect.h <= 0) return null;
  const vx1 = Math.max(0, rect.x), vy1 = Math.max(0, rect.y);
  const vx2 = Math.min(vw, rect.x + rect.w), vy2 = Math.min(vh, rect.y + rect.h);
  const cw = vx2 - vx1, ch = vy2 - vy1;
  if (cw <= 0 || ch <= 0) return null; // fully offscreen
  const scaleX = imageW / vw, scaleY = imageH / vh;
  if (!fin(scaleX) || !fin(scaleY) || scaleX <= 0 || scaleY <= 0) return null;
  let sx = Math.round(vx1 * scaleX), sy = Math.round(vy1 * scaleY);
  let sw = Math.round(cw * scaleX), sh = Math.round(ch * scaleY);
  sx = Math.max(0, Math.min(sx, imageW - 1));
  sy = Math.max(0, Math.min(sy, imageH - 1));
  sw = Math.max(1, Math.min(sw, imageW - sx));
  sh = Math.max(1, Math.min(sh, imageH - sy));
  const clipped = vx1 > rect.x + 0.5 || vy1 > rect.y + 0.5 || vx2 < rect.x + rect.w - 0.5 || vy2 < rect.y + rect.h - 0.5;
  return { sx, sy, sw, sh, clipped, scaleX, scaleY };
}

export async function drawCrop(image, plan) {
  const canvas = document.createElement("canvas");
  canvas.width = plan.sw;
  canvas.height = plan.sh;
  canvas.getContext("2d").drawImage(image, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, plan.sw, plan.sh);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  return { blob, w: plan.sw, h: plan.sh, clipped: plan.clipped };
}
