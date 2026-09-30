"use client";

import { useRef, useState, type DragEvent as ReactDragEvent } from "react";

export type GroupDragBind = {
  "data-group-id": string;
  draggable: true;
  onDragStart: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDragEnd: (event: ReactDragEvent<HTMLDivElement>) => void;
};

export function useGroupMergeDrag({
  enabled,
  onMerge,
}: {
  enabled: boolean;
  onMerge: (sourceId: string, targetId: string) => void;
}) {
  const sourceRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const onMergeRef = useRef(onMerge);
  onMergeRef.current = onMerge;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  function clearDrag() {
    sourceRef.current = null;
    setDraggingId(null);
    setDropTargetId(null);
  }

  function bind(groupId: string): GroupDragBind {
    return {
      "data-group-id": groupId,
      draggable: true,
      onDragStart: (event) => {
        if (!enabledRef.current || (event.target instanceof Element && event.target.closest("[data-no-drag]"))) {
          event.preventDefault();
          return;
        }
        sourceRef.current = groupId;
        event.dataTransfer.setData("text/plain", groupId);
        event.dataTransfer.effectAllowed = "move";
        setDraggingId(groupId);
      },
      onDragOver: (event) => {
        const source = sourceRef.current;
        if (!source || source === groupId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        scrollAtEdge(event.clientY, event.currentTarget);
        setDropTargetId((current) => (current === groupId ? current : groupId));
      },
      onDrop: (event) => {
        event.preventDefault();
        event.stopPropagation();
        const source = event.dataTransfer.getData("text/plain") || sourceRef.current;
        clearDrag();
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
        if (source && source !== groupId) onMergeRef.current(source, groupId);
      },
      onDragEnd: () => {
        clearDrag();
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      },
    };
  }

  function consumeSuppressedClick(): boolean {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }

  return { draggingId, dropTargetId, consumeSuppressedClick, bind };
}

function scrollAtEdge(clientY: number, origin: HTMLElement) {
  const parent = scrollParent(origin);
  const rect = parent.getBoundingClientRect();
  const edge = 72;
  if (clientY < rect.top + edge) parent.scrollTop -= 18;
  else if (clientY > rect.bottom - edge) parent.scrollTop += 18;
}

function scrollParent(node: HTMLElement): HTMLElement {
  let current = node.parentElement;
  while (current) {
    const overflow = getComputedStyle(current).overflowY;
    if (overflow === "auto" || overflow === "scroll") return current;
    current = current.parentElement;
  }
  return document.documentElement;
}
