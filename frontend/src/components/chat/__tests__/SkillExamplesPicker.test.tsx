import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SkillExamplesPicker } from "../SkillExamplesPicker";
import type { ExampleDocument } from "@/types/skill";

function makeExample(overrides: Partial<ExampleDocument> = {}): ExampleDocument {
  return {
    bucket: "examples-bucket",
    object: "ppa/contract-a.pdf",
    label: "Example PPA — Fixed price",
    summary: "10-year fixed-price, PaP, German offtaker",
    ...overrides,
  };
}

describe("SkillExamplesPicker", () => {
  it("renders nothing when examples list is empty", () => {
    const { container } = render(
      <SkillExamplesPicker examples={[]} onPickExample={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one card per example with label + summary", () => {
    const examples = [
      makeExample({ object: "a.pdf", label: "PPA A", summary: "Summary A" }),
      makeExample({ object: "b.pdf", label: "PPA B", summary: "Summary B" }),
    ];
    render(<SkillExamplesPicker examples={examples} onPickExample={() => {}} />);
    expect(screen.getByText("PPA A")).toBeInTheDocument();
    expect(screen.getByText("PPA B")).toBeInTheDocument();
    expect(screen.getByText("Summary A")).toBeInTheDocument();
    expect(screen.getByText("Summary B")).toBeInTheDocument();
  });

  it("calls onPickExample with the correct example on click", () => {
    const onPickExample = vi.fn();
    const example = makeExample({ label: "Clickable example" });
    render(
      <SkillExamplesPicker examples={[example]} onPickExample={onPickExample} />,
    );
    fireEvent.click(screen.getByText("Clickable example"));
    expect(onPickExample).toHaveBeenCalledWith(example);
  });

  it("falls back to generic doc icon when example.thumbnail is unset", () => {
    const { container } = render(
      <SkillExamplesPicker
        examples={[makeExample({ thumbnail: undefined })]}
        onPickExample={() => {}}
      />,
    );
    // No img element when thumbnail is unset — dashed-border fallback container.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg[aria-hidden]")).toBeTruthy();
  });

  it("renders an <img> thumbnail when example.thumbnail is set", () => {
    const { container } = render(
      <SkillExamplesPicker
        examples={[makeExample({ thumbnail: "/img/example.png" })]}
        onPickExample={() => {}}
      />,
    );
    // alt="" makes the img decorative — querySelector finds it directly.
    const img = container.querySelector("img");
    expect(img?.src).toContain("/img/example.png");
  });

  it("renders the 'Or upload your own' link only when onUploadOwn is provided", () => {
    const onUploadOwn = vi.fn();
    const { rerender } = render(
      <SkillExamplesPicker examples={[makeExample()]} onPickExample={() => {}} />,
    );
    expect(
      screen.queryByText(/Or upload your own/i),
    ).not.toBeInTheDocument();

    rerender(
      <SkillExamplesPicker
        examples={[makeExample()]}
        onPickExample={() => {}}
        onUploadOwn={onUploadOwn}
      />,
    );
    fireEvent.click(screen.getByText(/Or upload your own/i));
    expect(onUploadOwn).toHaveBeenCalledOnce();
  });

  it("omits summary in card when not provided", () => {
    render(
      <SkillExamplesPicker
        examples={[makeExample({ label: "Bare PPA", summary: undefined })]}
        onPickExample={() => {}}
      />,
    );
    expect(screen.getByText("Bare PPA")).toBeInTheDocument();
    // No summary text — just confirm only the label exists.
    expect(screen.queryByText(/10-year fixed/)).not.toBeInTheDocument();
  });
});
