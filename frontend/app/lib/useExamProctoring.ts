"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ProctorEventType =
  | "EXAM_STARTED"
  | "HEARTBEAT"
  | "TAB_HIDDEN"
  | "TAB_VISIBLE"
  | "WINDOW_BLUR"
  | "WINDOW_FOCUS"
  | "FULLSCREEN_ENTER"
  | "FULLSCREEN_EXIT"
  | "PAGE_HIDE"
  | "COPY_ATTEMPT"
  | "PASTE_ATTEMPT"
  | "CONTEXT_MENU"
  | "DEVTOOLS_SHORTCUT"
  | "MULTI_MONITOR"
  | "AUTOMATION_SIGNAL"
  | "VM_SIGNAL"
  | "SECOND_SESSION"
  | "MOBILE_DEVICE"
  | "REDUCED_ASSURANCE"
  | "NETWORK_OFFLINE"
  | "NETWORK_ONLINE"
  | "SUBMIT";

type ProctorEvent = {
  id: string;
  type: ProctorEventType;
  at: string;
  meta: Record<string, unknown>;
};

export type LockReason = "tab" | "focus" | "fullscreen" | "manual" | null;

export type EnvironmentSignals = {
  score: number;
  signals: string[];
  renderer: string;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  webdriver: boolean;
  mobile: boolean;
  fullscreenSupported: boolean;
  screenWidth: number;
  screenHeight: number;
  isExtended: boolean;
};

type KeyboardApi = {
  lock?: (keys?: string[]) => Promise<void>;
  unlock?: () => Promise<void>;
};

const SERIOUS_EVENTS = new Set<ProctorEventType>([
  "TAB_HIDDEN",
  "FULLSCREEN_EXIT",
  "PASTE_ATTEMPT",
  "SECOND_SESSION",
]);

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) => {
    const value = Number(char);
    return (
      value ^
      (Math.floor(Math.random() * 256) & (15 >> (value / 4)))
    ).toString(16);
  });
}

function readToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token") ?? sessionStorage.getItem("token");
}

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua)) return true;
  return navigator.maxTouchPoints > 1 && window.matchMedia("(pointer: coarse)").matches;
}

function fullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  return (
    document.fullscreenElement ??
    (document as Document & { webkitFullscreenElement?: Element | null })
      .webkitFullscreenElement ??
    null
  );
}

function supportsFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const element = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  return Boolean(element.requestFullscreen || element.webkitRequestFullscreen);
}

async function requestFullscreen(): Promise<boolean> {
  if (typeof document === "undefined") return false;
  const element = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  try {
    if (element.requestFullscreen) {
      await element.requestFullscreen({ navigationUI: "hide" });
    } else if (element.webkitRequestFullscreen) {
      await element.webkitRequestFullscreen();
    } else {
      return false;
    }
  } catch {
    return false;
  }
  return Boolean(fullscreenElement());
}

function collectEnvironment(): EnvironmentSignals {
  const signals: string[] = [];
  let score = 0;
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const mobile = isMobileDevice();
  let renderer = "";

  if (typeof navigator !== "undefined" && navigator.webdriver) {
    signals.push("navigator.webdriver");
    score += 90;
  }
  if (/HeadlessChrome/i.test(ua)) {
    signals.push("headless-ua");
    score += 90;
  }

  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
    const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info") as
      | { UNMASKED_RENDERER_WEBGL: number }
      | null;
    if (gl && debugInfo) {
      renderer = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? "");
    }
    if (/vmware|virtualbox|parallels|qemu|virgl/i.test(renderer)) {
      signals.push(`renderer:${renderer}`);
      score += 70;
    } else if (/swiftshader|llvmpipe|software\s+render/i.test(renderer)) {
      // Software rendering is common on low-end Linux laptops, so it is a
      // weaker signal than a named hypervisor.
      signals.push(`software-renderer:${renderer}`);
      score += 30;
    }
  } catch {
    // WebGL can be blocked by privacy settings; absence is not evidence by itself.
  }

  const hardwareConcurrency =
    typeof navigator === "undefined" ? 0 : navigator.hardwareConcurrency || 0;
  if (hardwareConcurrency > 0 && hardwareConcurrency <= 2) {
    signals.push(`hardwareConcurrency:${hardwareConcurrency}`);
    score += 10;
  }

  const navigatorWithHints = navigator as Navigator & {
    deviceMemory?: number;
    gpu?: unknown;
  };
  const deviceMemory = navigatorWithHints.deviceMemory ?? null;
  if (deviceMemory !== null && deviceMemory <= 2) {
    signals.push(`deviceMemory:${deviceMemory}`);
    score += 10;
  }
  if (!navigatorWithHints.gpu) {
    signals.push("no-webgpu");
    score += 5;
  }

  let isExtended = false;
  if (typeof window !== "undefined") {
    isExtended = Boolean(
      (window.screen as Screen & { isExtended?: boolean }).isExtended,
    );
  }

  return {
    score: Math.min(100, score),
    signals,
    renderer,
    hardwareConcurrency,
    deviceMemory,
    webdriver: typeof navigator !== "undefined" && Boolean(navigator.webdriver),
    mobile,
    fullscreenSupported: supportsFullscreen(),
    screenWidth: typeof window === "undefined" ? 0 : window.screen.width,
    screenHeight: typeof window === "undefined" ? 0 : window.screen.height,
    isExtended,
  };
}

export function useExamProctoring(attemptId: string | null) {
  const [running, setRunning] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockReason, setLockReason] = useState<LockReason>(null);
  const [lockMessage, setLockMessage] = useState("");
  const [seriousCount, setSeriousCount] = useState(0);
  const [offline, setOffline] = useState(false);
  const [multiMonitor, setMultiMonitor] = useState(false);
  const [reducedAssurance, setReducedAssurance] = useState(false);
  const [environment, setEnvironment] = useState<EnvironmentSignals | null>(null);

  const runningRef = useRef(false);
  const lockReasonRef = useRef<LockReason>(null);
  const sessionIdRef = useRef("");
  const queueRef = useRef<ProctorEvent[]>([]);
  const flushingRef = useRef(false);
  const flushTimerRef = useRef<number | null>(null);
  const flushEventsRef = useRef<((keepalive?: boolean) => Promise<void>) | null>(null);
  const lastFocusedRef = useRef(true);
  const lastExtendedRef = useRef(false);
  const reducedRef = useRef(false);
  const seriousCountRef = useRef(0);
  const queueKey = attemptId ? `exam_proctor_queue_${attemptId}` : null;

  const ensureSession = useCallback(() => {
    if (!attemptId || typeof window === "undefined") return;
    const key = `exam_proctor_session_${attemptId}`;
    try {
      let sessionId = sessionStorage.getItem(key);
      if (!sessionId) {
        sessionId = uuid();
        sessionStorage.setItem(key, sessionId);
      }
      sessionIdRef.current = sessionId;
    } catch {
      // Storage can be unavailable in private/embedded modes; a per-load id is
      // still enough to correlate this tab's events.
      if (!sessionIdRef.current) sessionIdRef.current = uuid();
    }
  }, [attemptId]);

  const persistQueue = useCallback(() => {
    if (!queueKey || typeof window === "undefined") return;
    try {
      localStorage.setItem(queueKey, JSON.stringify(queueRef.current.slice(-200)));
    } catch {
      // Quota/private mode: keep the in-memory queue only.
    }
  }, [queueKey]);

  const flushEvents = useCallback(
    async (keepalive = false) => {
      if (!attemptId || flushingRef.current || queueRef.current.length === 0) {
        return;
      }
      flushingRef.current = true;
      const batch = queueRef.current.slice(0, 50);
      const batchIds = new Set(batch.map((event) => event.id));
      persistQueue();
      try {
        const token = readToken();
        const response = await fetch(
          `/api/student/attempts/${attemptId}/proctor-events`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              session_id: sessionIdRef.current,
              events: batch,
            }),
            keepalive,
          },
        );
        if (!response.ok) throw new Error(`proctor-events ${response.status}`);
        const data = (await response.json().catch(() => ({}))) as {
          serious_count?: number;
        };
        if (typeof data.serious_count === "number") {
          seriousCountRef.current = data.serious_count;
          setSeriousCount(data.serious_count);
        }
        queueRef.current = queueRef.current.filter(
          (event) => !batchIds.has(event.id),
        );
        persistQueue();
      } catch {
        // Keep the batch in the queue. The next flush retries the same event ids,
        // which the server deduplicates by (attempt_id, client_event_id).
        persistQueue();
      } finally {
        flushingRef.current = false;
        if (queueRef.current.length > 0) {
          if (flushTimerRef.current !== null) {
            window.clearTimeout(flushTimerRef.current);
          }
          flushTimerRef.current = window.setTimeout(() => {
            flushTimerRef.current = null;
            void flushEventsRef.current?.();
          }, 5000);
        }
      }
    },
    [attemptId, persistQueue],
  );

  useEffect(() => {
    flushEventsRef.current = flushEvents;
  }, [flushEvents]);

  const log = useCallback(
    (type: ProctorEventType, meta: Record<string, unknown> = {}) => {
      if (!attemptId || !sessionIdRef.current) return;
      queueRef.current.push({
        id: uuid(),
        type,
        at: new Date().toISOString(),
        meta,
      });
      if (queueRef.current.length > 200) {
        queueRef.current = queueRef.current.slice(-200);
      }
      persistQueue();
      if (SERIOUS_EVENTS.has(type)) {
        void flushEvents(true);
      } else {
        if (flushTimerRef.current !== null) {
          window.clearTimeout(flushTimerRef.current);
        }
        flushTimerRef.current = window.setTimeout(() => {
          flushTimerRef.current = null;
          void flushEvents();
        }, 750);
      }
    },
    [attemptId, flushEvents, persistQueue],
  );

  const lock = useCallback((reason: LockReason, message: string) => {
    lockReasonRef.current = reason;
    setLockReason(reason);
    setLockMessage(message);
    setLocked(true);
  }, []);

  const unlock = useCallback(() => {
    lockReasonRef.current = null;
    setLockReason(null);
    setLocked(false);
  }, []);

  useEffect(() => {
    if (!attemptId || typeof window === "undefined") return;
    ensureSession();
    if (queueKey) {
      try {
        const saved = localStorage.getItem(queueKey);
        if (saved) {
          const parsed = JSON.parse(saved) as ProctorEvent[];
          if (Array.isArray(parsed)) {
            queueRef.current = parsed.slice(-200);
          }
        }
      } catch {
        // Ignore a corrupt local queue.
      }
    }
    setOffline(!navigator.onLine);
    void flushEvents();
  }, [attemptId, ensureSession, queueKey, flushEvents]);

  const start = useCallback(async () => {
    if (!attemptId) return false;
    if (runningRef.current) return true;
    ensureSession();
    const mobile = isMobileDevice();
    const hasFullscreen = Boolean(fullscreenElement()) || (await requestFullscreen());
    if (!hasFullscreen && !mobile) return false;

    const signals = collectEnvironment();
    setEnvironment(signals);
    setMultiMonitor(signals.isExtended);
    lastExtendedRef.current = signals.isExtended;
    setReducedAssurance(!hasFullscreen);
    reducedRef.current = !hasFullscreen;
    runningRef.current = true;
    setRunning(true);

    const keyboard = (navigator as Navigator & { keyboard?: KeyboardApi }).keyboard;
    try {
      await keyboard?.lock?.(["Escape"]);
    } catch {
      // Keyboard Lock is a Chromium enhancement, not a requirement.
    }

    log("EXAM_STARTED", {
      ...signals,
      fullscreen: hasFullscreen,
      reduced_assurance: !hasFullscreen,
    });
    if (mobile) {
      log("MOBILE_DEVICE", { fullscreen_supported: signals.fullscreenSupported });
    }
    if (!hasFullscreen) {
      log("REDUCED_ASSURANCE", {
        reason: mobile ? "mobile" : "fullscreen-denied",
      });
    }
    if (signals.score >= 40) {
      log("VM_SIGNAL", { score: signals.score, signals: signals.signals });
    }
    if (signals.webdriver) {
      log("AUTOMATION_SIGNAL", { webdriver: true });
    }
    if (signals.isExtended) {
      log("MULTI_MONITOR", { source: "screen.isExtended" });
    }
    return true;
  }, [attemptId, ensureSession, log]);

  const stop = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    unlock();
    void flushEvents(true);
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardApi }).keyboard;
    void keyboard?.unlock?.().catch(() => undefined);
    if (fullscreenElement()) {
      void document.exitFullscreen?.().catch(() => undefined);
    }
  }, [flushEvents, unlock]);

  const resume = useCallback(async () => {
    const mobile = isMobileDevice();
    const hasFullscreen = Boolean(fullscreenElement()) || (await requestFullscreen());
    if (!hasFullscreen && !mobile) return false;
    unlock();
    log(hasFullscreen ? "FULLSCREEN_ENTER" : "WINDOW_FOCUS", {
      fullscreen: hasFullscreen,
      mobile,
    });
    return true;
  }, [log, unlock]);

  useEffect(() => {
    if (!running) return;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        log("TAB_HIDDEN", {
          visible: false,
          fullscreen: Boolean(fullscreenElement()),
        });
        lock("tab", "Ujian dijeda karena Anda berpindah tab atau aplikasi.");
        return;
      }
      log("TAB_VISIBLE", { visible: true });
      if (fullscreenElement()) {
        if (lockReasonRef.current === "tab") unlock();
      } else {
        lock("fullscreen", "Layar penuh diperlukan untuk melanjutkan ujian.");
      }
    };

    const onBlur = () => {
      if (document.visibilityState === "hidden") return;
      log("WINDOW_BLUR", { focused: false });
      lock("focus", "Ujian dijeda karena jendela ujian kehilangan fokus.");
    };

    const onFocus = () => {
      log("WINDOW_FOCUS", { focused: true });
      if (fullscreenElement() && lockReasonRef.current === "focus") {
        unlock();
      }
    };

    const onFullscreenChange = () => {
      if (fullscreenElement()) {
        log("FULLSCREEN_ENTER", { fullscreen: true });
        if (lockReasonRef.current === "fullscreen") unlock();
      } else {
        log("FULLSCREEN_EXIT", { fullscreen: false });
        lock("fullscreen", "Layar penuh keluar. Kembali ke layar penuh untuk melanjutkan.");
      }
    };

    const onPageHide = () => {
      log("PAGE_HIDE", { visible: document.visibilityState });
      void flushEvents(true);
    };

    const onOnline = () => {
      setOffline(false);
      log("NETWORK_ONLINE", {});
      void flushEvents();
    };

    const onOffline = () => {
      setOffline(true);
      log("NETWORK_OFFLINE", {});
      persistQueue();
    };

    const onCopy = (event: ClipboardEvent) => {
      event.preventDefault();
      log("COPY_ATTEMPT", {
        selection: window.getSelection()?.toString().slice(0, 80) ?? "",
      });
    };

    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      log("PASTE_ATTEMPT", {});
      lock("manual", "Menempel jawaban tidak diizinkan selama ujian.");
    };

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      log("CONTEXT_MENU", {});
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toUpperCase();
      const devtoolsCombo =
        event.key === "F12" ||
        (event.ctrlKey && event.shiftKey && ["I", "J", "C"].includes(key)) ||
        (event.ctrlKey && ["U", "S", "P"].includes(key));
      if (!devtoolsCombo) return;
      event.preventDefault();
      log("DEVTOOLS_SHORTCUT", {
        key: event.key,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
      });
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);

    const focusTimer = window.setInterval(() => {
      const focused = document.hasFocus();
      if (lastFocusedRef.current && !focused && !document.hidden) {
        log("WINDOW_BLUR", { source: "hasFocus-poll" });
        lock("focus", "Ujian dijeda karena jendela ujian kehilangan fokus.");
      }
      lastFocusedRef.current = focused;
    }, 1000);

    const heartbeatTimer = window.setInterval(() => {
      log("HEARTBEAT", {
        visible: document.visibilityState === "visible",
        focused: document.hasFocus(),
        fullscreen: Boolean(fullscreenElement()),
        extended: Boolean(
          (window.screen as Screen & { isExtended?: boolean }).isExtended,
        ),
        mobile: isMobileDevice(),
        reduced_assurance: reducedRef.current,
        online: navigator.onLine,
        serious_count: seriousCountRef.current,
      });
    }, 20000);

    const monitorTimer = window.setInterval(() => {
      const extended = Boolean(
        (window.screen as Screen & { isExtended?: boolean }).isExtended,
      );
      setMultiMonitor(extended);
      if (extended && !lastExtendedRef.current) {
        log("MULTI_MONITOR", { source: "screen.isExtended" });
      }
      lastExtendedRef.current = extended;
    }, 30000);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(`exam-proctor-${attemptId}`);
      channel.onmessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; sessionId?: string } | null;
        if (
          data?.type === "HELLO" &&
          data.sessionId &&
          data.sessionId !== sessionIdRef.current
        ) {
          log("SECOND_SESSION", { other_session: data.sessionId });
        }
      };
      channel.postMessage({ type: "HELLO", sessionId: sessionIdRef.current });
    } catch {
      // BroadcastChannel is unavailable in a few embedded browsers.
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      window.clearInterval(focusTimer);
      window.clearInterval(heartbeatTimer);
      window.clearInterval(monitorTimer);
      channel?.close();
    };
  }, [
    attemptId,
    flushEvents,
    lock,
    log,
    persistQueue,
    running,
    unlock,
  ]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
      runningRef.current = false;
      const keyboard = (navigator as Navigator & { keyboard?: KeyboardApi }).keyboard;
      void keyboard?.unlock?.().catch(() => undefined);
      if (fullscreenElement()) {
        void document.exitFullscreen?.().catch(() => undefined);
      }
    };
  }, []);

  return {
    running,
    locked,
    lockReason,
    lockMessage,
    seriousCount,
    offline,
    multiMonitor,
    reducedAssurance,
    environment,
    start,
    stop,
    resume,
    flushEvents,
    log,
  };
}
