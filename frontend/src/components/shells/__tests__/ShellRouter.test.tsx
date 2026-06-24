import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Mock the three shells to lightweight markers so the dispatch is tested in
// isolation (ChatShell pulls the full chat dependency graph otherwise).
vi.mock("@/components/chat/ChatShell", () => ({
  ChatShell: () => <div data-testid="chat-shell" />,
}));
vi.mock("@/components/shells/DocCompareShell", () => ({
  DocCompareShell: () => <div data-testid="doc-compare-shell" />,
}));
vi.mock("@/components/shells/WorkbenchShell", () => ({
  WorkbenchShell: () => <div data-testid="workbench-shell" />,
}));

import { ShellRouter } from "@/components/shells/ShellRouter";
import type { SkillShell } from "@/types/skill";

const baseProps = {
  skillId: "skill-1",
  pathPrefix: "/chat/@owner/slug",
  user: {} as never,
};

function renderWith(shell: SkillShell | null) {
  return render(<ShellRouter {...baseProps} shell={shell} />);
}

describe("ShellRouter dispatch", () => {
  it("renders ChatShell for chat-primary", () => {
    renderWith({ mode: "chat-primary" });
    expect(screen.queryByTestId("chat-shell")).not.toBeNull();
    expect(screen.queryByTestId("doc-compare-shell")).toBeNull();
  });

  it("renders DocCompareShell for doc-compare", () => {
    renderWith({ mode: "doc-compare" });
    expect(screen.queryByTestId("doc-compare-shell")).not.toBeNull();
    expect(screen.queryByTestId("chat-shell")).toBeNull();
  });

  it("renders WorkbenchShell for workbench-primary", () => {
    renderWith({ mode: "workbench-primary" });
    expect(screen.queryByTestId("workbench-shell")).not.toBeNull();
    expect(screen.queryByTestId("chat-shell")).toBeNull();
  });

  it("falls back to ChatShell for a null shell (legacy skill)", () => {
    renderWith(null);
    expect(screen.queryByTestId("chat-shell")).not.toBeNull();
  });

  it("falls back to ChatShell for custom mode (v1 resolves custom to ChatShell)", () => {
    renderWith({ mode: "custom" });
    expect(screen.queryByTestId("chat-shell")).not.toBeNull();
  });

  it("falls back to ChatShell for an unknown/forward-compat mode", () => {
    renderWith({ mode: "holographic" as unknown as SkillShell["mode"] });
    expect(screen.queryByTestId("chat-shell")).not.toBeNull();
  });
});
