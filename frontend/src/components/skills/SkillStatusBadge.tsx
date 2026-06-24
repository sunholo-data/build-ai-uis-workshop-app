"use client";

/**
 * SkillStatusBadge — small visual flag that surfaces categorical tags
 * declared on a skill's SKILL.md frontmatter (top-level `tags:` list).
 *
 * Today this is purely an admin affordance: tag-gated skills like
 * `code-assistant` and `workspace-demo` carry tags like `experimental`,
 * `dev-tool`, `a2ui-demo` so that an aitana-admin looking at the
 * marketplace doesn't get confused about which skills are ready for
 * customer eyes vs. which are work-in-progress.
 *
 * Unknown tags are silently ignored — anything not in KNOWN_TAGS is
 * skipped rather than rendered as a noisy default badge. Skill authors
 * who want a new status need to add the variant here too; that's
 * intentional, it keeps the badge palette under design control.
 *
 * For multi-tag skills (e.g. `data-extractor` has `experimental +
 * extraction + data`), only KNOWN_TAGS are rendered as badges; the
 * descriptive ones (`extraction`, `data`) stay in skill metadata as
 * search/category hints.
 */

interface SkillStatusBadgeProps {
  /** Top-level skill tags from SKILL.md frontmatter. */
  tags: string[] | undefined;
}

interface BadgeStyle {
  label: string;
  /** Tailwind classes for the badge surface. */
  className: string;
}

const KNOWN_TAGS: Record<string, BadgeStyle> = {
  experimental: {
    label: "Experimental",
    className: "border-amber-300 bg-amber-50 text-amber-900",
  },
  "dev-tool": {
    label: "Dev tool",
    className: "border-sky-300 bg-sky-50 text-sky-900",
  },
  "a2ui-demo": {
    label: "A2UI demo",
    className: "border-violet-300 bg-violet-50 text-violet-900",
  },
};

export function SkillStatusBadge({ tags }: SkillStatusBadgeProps) {
  if (!tags || tags.length === 0) return null;
  const styled = tags
    .map((t) => KNOWN_TAGS[t])
    .filter((s): s is BadgeStyle => Boolean(s));
  if (styled.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {styled.map((s) => (
        <span
          key={s.label}
          className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${s.className}`}
        >
          {s.label}
        </span>
      ))}
    </div>
  );
}
