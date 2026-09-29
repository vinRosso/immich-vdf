export type ImageView = { scale: number; x: number; y: number };

/** Zoom and pan relative to each image's fit-to-viewport scale (1 = fit, 2 = 200% of fit). */
export type RelativeImageView = {
  zoomRatio: number;
  focusX: number;
  focusY: number;
};

export const DEFAULT_RELATIVE_IMAGE_VIEW: RelativeImageView = { zoomRatio: 1, focusX: 0.5, focusY: 0.5 };

export type ImageBounds = {
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
};

export function fitImage(
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number,
): ImageView {
  if (viewportWidth <= 0 || viewportHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return { scale: 1, x: 0, y: 0 };
  }
  const scale = Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight);
  return {
    scale,
    x: (viewportWidth - imageWidth * scale) / 2,
    y: (viewportHeight - imageHeight * scale) / 2,
  };
}

/** Zoom around a viewport point so that point stays on the same image pixel. */
export function zoomImage(
  view: ImageView,
  cursorX: number,
  cursorY: number,
  factor: number,
  bounds?: ImageBounds,
  min = 0.02,
  max = 40,
): ImageView {
  const floor = bounds ? fitScale(bounds) : min;
  const scale = Math.min(max, Math.max(floor, view.scale * factor));
  const next =
    scale === view.scale
      ? view
      : {
          scale,
          x: cursorX - ((cursorX - view.x) * scale) / view.scale,
          y: cursorY - ((cursorY - view.y) * scale) / view.scale,
        };
  return bounds ? clampImageView(next, bounds) : next;
}

/** Keep every image edge against the canvas. A shorter axis stays centered. */
export function clampImageView(view: ImageView, bounds: ImageBounds): ImageView {
  const { viewportWidth, viewportHeight, imageWidth, imageHeight } = bounds;
  if (viewportWidth <= 0 || viewportHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) return view;
  const scale = Math.max(view.scale, fitScale(bounds));
  return {
    scale,
    x: clampAxis(view.x, viewportWidth, imageWidth * scale),
    y: clampAxis(view.y, viewportHeight, imageHeight * scale),
  };
}

export function fitScale(bounds: ImageBounds): number {
  return Math.min(bounds.viewportWidth / bounds.imageWidth, bounds.viewportHeight / bounds.imageHeight);
}

export function viewToRelative(view: ImageView, bounds: ImageBounds): RelativeImageView {
  const fit = fitScale(bounds);
  const cx = bounds.viewportWidth / 2;
  const cy = bounds.viewportHeight / 2;
  return {
    zoomRatio: fit > 0 ? view.scale / fit : 1,
    focusX: bounds.imageWidth > 0 ? (cx - view.x) / view.scale / bounds.imageWidth : 0.5,
    focusY: bounds.imageHeight > 0 ? (cy - view.y) / view.scale / bounds.imageHeight : 0.5,
  };
}

export function relativeToView(relative: RelativeImageView, bounds: ImageBounds): ImageView {
  const scale = relative.zoomRatio * fitScale(bounds);
  const cx = bounds.viewportWidth / 2;
  const cy = bounds.viewportHeight / 2;
  return clampImageView(
    {
      scale,
      x: cx - relative.focusX * bounds.imageWidth * scale,
      y: cy - relative.focusY * bounds.imageHeight * scale,
    },
    bounds,
  );
}

function clampAxis(offset: number, viewport: number, scaled: number): number {
  if (scaled <= viewport) return (viewport - scaled) / 2;
  return Math.min(0, Math.max(viewport - scaled, offset));
}
