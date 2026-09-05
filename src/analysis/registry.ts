import { detekt } from "./detekt.js";
import { eslint } from "./eslint.js";
import { golangci } from "./golangci.js";
import { pmd } from "./pmd.js";
import { ruff } from "./ruff.js";
import { semgrep } from "./semgrep.js";
import type { Analyzer } from "./types.js";

/** Native analyzers, each one the standard of its ecosystem. */
export const NATIVE_ANALYZERS: Analyzer[] = [pmd, detekt, golangci, eslint, ruff];

/** Runs on top of the native ones, across every language. */
export const CROSS_LANGUAGE_ANALYZERS: Analyzer[] = [semgrep];

export const ALL_ANALYZERS: Analyzer[] = [...NATIVE_ANALYZERS, ...CROSS_LANGUAGE_ANALYZERS];

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");

  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

/**
 * Picks which analyzer looks at which files.
 * A native analyzer only gets the extensions it understands; a cross-language
 * one gets everything that at least one native analyzer claimed, to avoid
 * scanning lock files, images or generated assets.
 */
export function planAnalysis(files: string[]): Map<Analyzer, string[]> {
  const plan = new Map<Analyzer, string[]>();
  const claimed = new Set<string>();

  for (const analyzer of NATIVE_ANALYZERS) {
    const matching = files.filter((file) => analyzer.extensions.includes(extensionOf(file)));

    if (matching.length > 0) {
      plan.set(analyzer, matching);
      for (const file of matching) {
        claimed.add(file);
      }
    }
  }

  if (claimed.size > 0) {
    for (const analyzer of CROSS_LANGUAGE_ANALYZERS) {
      plan.set(analyzer, [...claimed]);
    }
  }

  return plan;
}
