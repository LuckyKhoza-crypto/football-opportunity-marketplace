"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { POSITION_LABELS } from "@/types";

/** Maximum number of position badges shown before the toggle appears. */
const MAX_VISIBLE = 2;

const DEFAULT_BADGE_CLASS =
  "inline-flex items-center rounded-md bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground shadow-sm";

const DEFAULT_TOGGLE_CLASS = "text-[#D1D5DB]";

interface PlayerPositionsProps {
  /** Raw position codes (e.g. "ST", "CB"). */
  positions: readonly string[];
  /** Class applied to each position badge. */
  badgeClassName?: string;
  /** Class applied to the expand/collapse toggle. */
  toggleClassName?: string;
}

/**
 * Renders a player's positions, showing at most {@link MAX_VISIBLE} badges.
 *
 * When more positions exist, a small toggle is rendered that reveals or
 * hides the remainder. The toggle stops event propagation so it works
 * safely inside cards wrapped in a `<Link>`.
 */
export function PlayerPositions({
  positions,
  badgeClassName = DEFAULT_BADGE_CLASS,
  toggleClassName = DEFAULT_TOGGLE_CLASS,
}: PlayerPositionsProps) {
  const [expanded, setExpanded] = useState(false);

  const items = (positions ?? []).filter(Boolean);
  if (items.length === 0) return null;

  const hasMore = items.length > MAX_VISIBLE;
  const visible = expanded ? items : items.slice(0, MAX_VISIBLE);
  const hiddenCount = items.length - MAX_VISIBLE;

  return (
    <>
      {visible.map((pos) => (
        <span key={pos} className={badgeClassName}>
          {POSITION_LABELS[pos] ?? pos}
        </span>
      ))}

      {hasMore && (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
          className={`inline-flex cursor-pointer items-center gap-0.5 text-xs font-medium transition-colors hover:text-primary ${toggleClassName}`}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? "Show fewer positions"
              : `Show ${hiddenCount} more position${hiddenCount === 1 ? "" : "s"}`
          }
        >
          {expanded ? (
            <>
              Show less
              <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              +{hiddenCount}
              <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      )}
    </>
  );
}