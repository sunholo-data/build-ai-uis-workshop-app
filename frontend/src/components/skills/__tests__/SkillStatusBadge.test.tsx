import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { SkillStatusBadge } from "../SkillStatusBadge";

describe("SkillStatusBadge", () => {
  it("renders nothing when tags is undefined", () => {
    const { container } = render(<SkillStatusBadge tags={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when tags is empty", () => {
    const { container } = render(<SkillStatusBadge tags={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders an 'Experimental' badge for the experimental tag", () => {
    render(<SkillStatusBadge tags={["experimental"]} />);
    expect(screen.getByText("Experimental")).toBeInTheDocument();
  });

  it("renders a 'Dev tool' badge for dev-tool", () => {
    render(<SkillStatusBadge tags={["dev-tool"]} />);
    expect(screen.getByText("Dev tool")).toBeInTheDocument();
  });

  it("renders an 'A2UI demo' badge for a2ui-demo", () => {
    render(<SkillStatusBadge tags={["a2ui-demo"]} />);
    expect(screen.getByText("A2UI demo")).toBeInTheDocument();
  });

  it("renders multiple badges when multiple known tags are present", () => {
    render(<SkillStatusBadge tags={["experimental", "a2ui-demo"]} />);
    expect(screen.getByText("Experimental")).toBeInTheDocument();
    expect(screen.getByText("A2UI demo")).toBeInTheDocument();
  });

  it("silently ignores unknown tags — only KNOWN_TAGS are surfaced", () => {
    render(<SkillStatusBadge tags={["extraction", "data"]} />);
    expect(screen.queryByText("Experimental")).toBeNull();
    expect(screen.queryByText(/extraction/i)).toBeNull();
    expect(screen.queryByText(/data/i)).toBeNull();
  });

  it("mixes known + unknown tags: shows only the known ones", () => {
    render(<SkillStatusBadge tags={["experimental", "extraction", "data"]} />);
    expect(screen.getByText("Experimental")).toBeInTheDocument();
    expect(screen.queryByText(/extraction/i)).toBeNull();
    // No false-positive badges
    expect(screen.queryByText("Dev tool")).toBeNull();
  });
});
