import type { Selector } from '@oas/flow-graph';

/**
 * Exploration policy — the "where to tap next" intelligence.
 *
 * Strategy (see memory: app-exploration-heuristics): BFS the skeleton, then
 * DFS the money paths. We approximate that on a real device (no teleporting to
 * arbitrary frontier nodes) with a priority score per candidate:
 *
 *   score = domainPriority(hint)        // core commerce/auth flows win
 *         + noveltyBonus                // unseen destinations win (→ breadth)
 *         − revisitPenalty              // signatures leading to seen nodes lose
 *
 * This fixes two real problems seen on iHerb:
 *   1. utility buttons (scanner/share/notifications) were tapped before core
 *      content because selection was purely top-to-bottom;
 *   2. the same top-bar scanner button reopened the scanner from every screen
 *      because frontier is per-(screen,selector) — now suppressed globally once
 *      its destination is known to be already-visited.
 */

// Canonical money-path & entry keywords — the flows that define an app.
// `(?<![a-z])` = start at a word/segment boundary incl. underscore/slash in
// resource ids (btn_checkout matches; "display" won't match "pay").
const CORE = /(?<![a-z])(cart|bag|checkout|buy|pay|order|product|item|categor|browse|explore|shop|store|search|sign\s?up|signup|register|create\s?account|log\s?in|login|sign\s?in|signin|continue|next|address|subscrib|deal|sale|wishlist|favorit|home)/i;

// Utility / dead-end surfaces — useful to know exist, costly to dwell in.
// (`survey/rate/newsletter` are the "engage" buttons on promo interstitials.)
const UTILITY = /(?<![a-z])(scan|barcode|qr|camera|flash|share|refer|invite|notif|setting|language|region|country|help|feedback|survey|rate\s?us|rate\s?this|review\s?us|newsletter|follow|social|about|terms|privacy|legal|version|theme)/i;

// Promo-dismiss affordances — the clean way OUT of an interstitial (survey,
// rate-us, newsletter, "get the app"). Prefer these so a promo overlay is
// closed and exploration returns to the real content underneath.
const PROMO_DISMISS = /(?<![a-z])(don'?t\s?show\s?again|no\s?,?\s?thanks|no\s?thank\s?you|maybe\s?later|not\s?now|remind\s?me\s?later|skip|got\s?it|dismiss)/i;

// Generic close/cancel — ambiguous; let back() or other candidates lead.
const DISMISS = /(?<![a-z])(close|cancel)/i;

export function domainPriority(hint: string): number {
  if (PROMO_DISMISS.test(hint)) return 2;
  if (UTILITY.test(hint)) return -3;
  if (DISMISS.test(hint)) return -2;
  if (CORE.test(hint)) return 3;
  return 0;
}

/** Stable signature for cross-screen dedup: a recurring button has the same one everywhere. */
export function signatureOf(selector: Selector): string {
  return (
    selector.resourceId ??
    selector.accessibilityId ??
    selector.text ??
    selector.xpath ??
    JSON.stringify(selector)
  );
}

export interface ScoreContext {
  hint: string;
  signature: string;
  /** Center y as a fraction of screen height (0=top,1=bottom) — for tab-bar bias. */
  yFraction: number;
  /** Destination node id this signature is known to lead to (from a prior tap), if any. */
  knownDestination?: string;
  /** Visit count of that known destination. */
  destinationVisits: number;
  /** Is the launch/home screen? (bottom-nav breadth matters most here.) */
  onHome: boolean;
}

export function scoreCandidate(ctx: ScoreContext): number {
  let score = domainPriority(ctx.hint);

  if (ctx.knownDestination === undefined) {
    score += 1; // unexplored signature — likely a new destination (breadth)
  } else {
    // Leads somewhere we've already seen: the more we've been there, the worse.
    score -= 2 + Math.min(ctx.destinationVisits, 4);
  }

  // BFS bias: on the home screen, bottom-nav items (primary sections) go first.
  if (ctx.onHome && ctx.yFraction >= 0.85) score += 2;

  return score;
}
