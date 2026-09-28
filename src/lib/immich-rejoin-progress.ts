export type RejoinProgress = {
  running: boolean;
  percent: number;
  label: string;
  detail: string;
  indeterminate?: boolean;
};

const idle = (): RejoinProgress => ({
  running: false,
  percent: 0,
  label: "",
  detail: "",
});

type RejoinProgressStore = {
  state: RejoinProgress;
  locked: boolean;
};

function store(): RejoinProgressStore {
  const holder = globalThis as typeof globalThis & { __vdfImmichRejoin?: RejoinProgressStore };
  if (!holder.__vdfImmichRejoin) {
    holder.__vdfImmichRejoin = { state: idle(), locked: false };
  }
  return holder.__vdfImmichRejoin;
}

export function getRejoinProgress(): RejoinProgress {
  return store().state;
}

export function tryBeginRejoin(): boolean {
  const slot = store();
  if (slot.locked) return false;
  slot.locked = true;
  slot.state = {
    running: true,
    percent: 0,
    label: "Starting",
    detail: "Connecting to match job…",
    indeterminate: true,
  };
  return true;
}

export function endRejoin(): void {
  const slot = store();
  slot.locked = false;
  slot.state = idle();
}

export function isRejoinLocked(): boolean {
  return store().locked;
}

export function reportRejoin(progress: Omit<RejoinProgress, "running"> & { running?: boolean }): void {
  const slot = store();
  if (!slot.locked) return;
  slot.state = { running: true, indeterminate: false, ...progress };
}
