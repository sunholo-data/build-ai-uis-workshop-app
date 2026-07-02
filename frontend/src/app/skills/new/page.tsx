import Link from "next/link";

export default function NewSkillPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Create something new</h1>
        <p className="text-muted-foreground">
          Skills and demos here are built by a local coding agent — not a
          wizard. Open this repo in Claude Code (or your agent of choice) and
          just ask.
        </p>
        <ul className="space-y-2 text-left text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">
              A new <code className="rounded bg-muted px-1 py-0.5">/dev</code>{" "}
              demo (A2UI / MCP Apps)?
            </span>{" "}
            the{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">
              workshop-demo-builder
            </code>{" "}
            skill walks you through it.
          </li>
          <li>
            <span className="font-medium text-foreground">
              A new platform skill?
            </span>{" "}
            run{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">
              aitana skill create
            </code>{" "}
            in the terminal.
          </li>
        </ul>
        <Link className="inline-block text-sm underline" href="/">
          ← Back to home
        </Link>
      </div>
    </main>
  );
}
