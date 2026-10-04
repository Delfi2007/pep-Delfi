"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "acpia-theme";

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/** Applied here and by the inline script in layout.tsx — both must agree,
 * or the pre-hydration paint and the React state disagree and the page
 * flickers on load. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/*
 * localStorage is an external store with a different server value, which
 * is precisely what useSyncExternalStore exists for. Using it instead of
 * read-storage-in-an-effect keeps the hydration contract explicit and
 * gets cross-tab sync for free: change the theme in one tab and every
 * other tab follows.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // `storage` fires only in *other* tabs, so same-tab writes notify
  // through the listener set. Together they cover both directions.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Private mode or blocked storage — fall through to the default.
  }
  return "system";
}

// Snapshots must be referentially stable across calls; these return
// primitives, so they are.
const readServerTheme = (): Theme => "system";

// False during SSR and the hydration pass, true from the first client
// render onward — the same job the old `mounted` flag did, without an
// effect that writes state.
const neverChanges = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * Pill-shaped segmented control, matching the Timeline/Graph/Triage
 * switcher — a console should only have one idiom for "pick one of
 * these".
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, readServerTheme);
  const hydrated = useSyncExternalStore(neverChanges, onClient, onServer);

  // Push the current theme at the DOM whenever it changes — including
  // when the change came from another tab, which the old version missed.
  // Writes no state, so it's an effect doing what effects are for.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function choose(next: Theme) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Can't persist, but still honour the choice for this session.
    }
    for (const notify of listeners) notify();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex items-center gap-0.5 rounded-full bg-canvas p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        // Before hydration nothing is marked active — otherwise "system"
        // would flash as selected for a frame on a machine set to dark.
        const active = hydrated && theme === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => choose(value)}
            className={`inline-flex size-7 items-center justify-center rounded-full transition-colors ${
              active
                ? "bg-surface text-label-primary shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                : "text-label-tertiary hover:text-label-secondary"
            }`}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
