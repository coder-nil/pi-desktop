"use client";

import { useEffect, useState } from "react";

const EXIT_DURATION_MS = 720;
const READY_FALLBACK_MS = 10_000;
const APP_READY_EVENT = "pi-app-ready";

export function DesktopStartupSkeleton() {
  const [visible, setVisible] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!document.documentElement.classList.contains("pi-desktop")) {
      setVisible(false);
      return;
    }

    let exitTimer: number | undefined;
    let hasStartedLeaving = false;
    const startLeaving = () => {
      if (hasStartedLeaving) return;
      hasStartedLeaving = true;
      setLeaving(true);
      exitTimer = window.setTimeout(() => setVisible(false), EXIT_DURATION_MS);
    };

    window.addEventListener(APP_READY_EVENT, startLeaving);
    if (document.documentElement.dataset.piAppReady === "true") {
      startLeaving();
    }
    const fallbackTimer = window.setTimeout(startLeaving, READY_FALLBACK_MS);

    return () => {
      window.removeEventListener(APP_READY_EVENT, startLeaving);
      window.clearTimeout(fallbackTimer);
      if (exitTimer !== undefined) window.clearTimeout(exitTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`desktop-startup-overlay${leaving ? " is-liquefying" : ""}`}
      aria-hidden="true"
    >
      <svg className="desktop-startup-filter" width="0" height="0">
        <filter id="desktop-startup-liquid-filter" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.009 0.026"
            numOctaves="2"
            seed="8"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="18"
            xChannelSelector="R"
            yChannelSelector="B"
          />
        </filter>
      </svg>

      <aside className="desktop-startup-sidebar">
        <div className="desktop-startup-sidebar-head">
          <i className="desktop-startup-dot desktop-startup-placeholder" />
          <i className="desktop-startup-line is-medium desktop-startup-placeholder" />
        </div>
        <div className="desktop-startup-sidebar-body">
          <div className="desktop-startup-group">
            <i className="desktop-startup-label desktop-startup-placeholder" />
            <div className="desktop-startup-row is-active">
              <i className="desktop-startup-dot desktop-startup-placeholder" />
              <i className="desktop-startup-line is-long desktop-startup-placeholder" />
            </div>
            <div className="desktop-startup-row">
              <i className="desktop-startup-dot desktop-startup-placeholder" />
              <i className="desktop-startup-line is-medium desktop-startup-placeholder" />
            </div>
            <div className="desktop-startup-row">
              <i className="desktop-startup-dot desktop-startup-placeholder" />
              <i className="desktop-startup-line is-long desktop-startup-placeholder" />
            </div>
          </div>
          <div className="desktop-startup-group">
            <i className="desktop-startup-label desktop-startup-placeholder" />
            <div className="desktop-startup-row">
              <i className="desktop-startup-dot desktop-startup-placeholder" />
              <i className="desktop-startup-line is-medium desktop-startup-placeholder" />
            </div>
            <div className="desktop-startup-row">
              <i className="desktop-startup-dot desktop-startup-placeholder" />
              <i className="desktop-startup-line is-short desktop-startup-placeholder" />
            </div>
          </div>
        </div>
        <div className="desktop-startup-sidebar-foot">
          <i className="desktop-startup-dot desktop-startup-placeholder" />
          <i className="desktop-startup-line is-medium desktop-startup-placeholder" />
        </div>
      </aside>

      <section className="desktop-startup-workspace">
        <header className="desktop-startup-topbar">
          <div className="desktop-startup-tab">
            <i className="desktop-startup-dot desktop-startup-placeholder" />
            <i className="desktop-startup-line is-medium desktop-startup-placeholder" />
          </div>
        </header>
        <div className="desktop-startup-content">
          <div className="desktop-startup-conversation">
            <div className="desktop-startup-message is-offset">
              <i className="desktop-startup-line is-long desktop-startup-placeholder" />
              <i className="desktop-startup-line is-medium desktop-startup-placeholder" />
            </div>
            <div className="desktop-startup-message">
              <i className="desktop-startup-line is-long desktop-startup-placeholder" />
              <i className="desktop-startup-line is-long desktop-startup-placeholder" />
              <i className="desktop-startup-line is-medium desktop-startup-placeholder" />
            </div>
            <div className="desktop-startup-composer" />
          </div>
        </div>
        <div className="desktop-startup-statusbar">
          <i className="desktop-startup-status-indicator" />
          <span>Starting local service</span>
        </div>
      </section>
    </div>
  );
}
