export interface RemotePoint {
  x: number;
  y: number;
}

interface PointerEventLike {
  nativeEvent: {
    locationX?: number;
    locationY?: number;
    offsetX?: number;
    offsetY?: number;
  };
}

function getPointerPosition(event: PointerEventLike): RemotePoint | null {
  const x = event.nativeEvent.locationX ?? event.nativeEvent.offsetX;
  const y = event.nativeEvent.locationY ?? event.nativeEvent.offsetY;
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

/** Maps a pointer in the viewport to a point in the remote page frame. */
export function getRemotePoint(
  event: PointerEventLike,
  frame: { width: number; height: number } | null,
  viewportSize: { width: number; height: number },
): RemotePoint | null {
  const position = getPointerPosition(event);
  if (!position || !frame || !viewportSize.width || !viewportSize.height) return null;
  // The frame is letterboxed ("contain"), so map through the drawn rect, not the whole viewport.
  const scale = Math.min(viewportSize.width / frame.width, viewportSize.height / frame.height);
  const offsetX = (viewportSize.width - frame.width * scale) / 2;
  const offsetY = (viewportSize.height - frame.height * scale) / 2;
  return {
    x: Math.max(0, Math.min(frame.width, (position.x - offsetX) / scale)),
    y: Math.max(0, Math.min(frame.height, (position.y - offsetY) / scale)),
  };
}
