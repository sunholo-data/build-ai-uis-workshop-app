import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SidebarSection } from "../SidebarSection";

describe("SidebarSection", () => {
  it("renders title and children inside a <details> element open by default", () => {
    render(
      <SidebarSection title="Sessions">
        <div data-testid="body">body content</div>
      </SidebarSection>,
    );
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByTestId("body")).toBeInTheDocument();
    // <details> defaults open
    const details = screen.getByText("Sessions").closest("details");
    expect(details).toHaveAttribute("open");
  });

  it("respects defaultOpen=false to render collapsed", () => {
    render(
      <SidebarSection title="History" defaultOpen={false}>
        <div data-testid="body">body</div>
      </SidebarSection>,
    );
    const details = screen.getByText("History").closest("details");
    expect(details).not.toHaveAttribute("open");
  });

  it("renders badge slot when provided", () => {
    render(
      <SidebarSection title="Sessions" badge={<span data-testid="badge">3</span>}>
        body
      </SidebarSection>,
    );
    expect(screen.getByTestId("badge")).toBeInTheDocument();
  });

  it("renders action slot when provided", () => {
    render(
      <SidebarSection title="Documents" action={<button data-testid="action">+</button>}>
        body
      </SidebarSection>,
    );
    expect(screen.getByTestId("action")).toBeInTheDocument();
  });

  it("applies bodyClassName override when provided", () => {
    const { container } = render(
      <SidebarSection title="Custom" bodyClassName="px-0 py-0">
        <div data-testid="body">body</div>
      </SidebarSection>,
    );
    const body = container.querySelector("details > div");
    expect(body?.className).toContain("px-0");
    expect(body?.className).toContain("py-0");
  });
});
