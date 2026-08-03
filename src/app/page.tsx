import Link from "next/link";

export default function HomePage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-14 px-5 py-16">
      <section className="max-w-3xl">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
          Prototype · M1/M2 slice
        </p>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
          Insurance Co-Pilot
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--muted)]">
          Voice intake for stranded drivers, automated coverage check with
          cited clauses, dispatch recommendation, and a human approval
          dashboard. Nothing reaches the customer without sign-off.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/voice"
            className="rounded-md bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[#042f2e] hover:brightness-110"
          >
            Start voice intake
          </Link>
          <Link
            href="/dashboard"
            className="rounded-md border border-[var(--border)] bg-[var(--bg-panel)] px-5 py-2.5 text-sm font-medium hover:border-[var(--accent-dim)]"
          >
            Open agent dashboard
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: "F1 Voice intake",
            body: "Browser voice (OpenAI Realtime) collects name, DOB, vehicle, location, and damage. Read-back before close.",
          },
          {
            title: "F2 + F3 Coverage & NBA",
            body: "Post-call reasoning over synthetic policies. Returns covered / not covered / uncertain with clause citation, plus tow vs repair truck.",
          },
          {
            title: "F4 + F5 Human gate",
            body: "Agents approve, override, or edit. Simulated SMS goes out only after approval. Full audit trail.",
          },
        ].map((item) => (
          <div
            key={item.title}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-5"
          >
            <h2 className="text-sm font-semibold text-[var(--accent)]">
              {item.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              {item.body}
            </p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-5">
        <h2 className="text-sm font-semibold">Demo identities</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Use these when the voice agent asks for name and date of birth.
        </p>
        <ul className="mt-3 grid gap-2 font-mono text-sm md:grid-cols-2">
          <li>Jordan Lee · 1988-04-12 · Standard</li>
          <li>Sam Rivera · 1992-11-03 · Plus</li>
          <li>Alex Chen · 1975-07-22 · Standard</li>
          <li>Morgan Patel · 1990-01-15 · Plus</li>
        </ul>
      </section>
    </div>
  );
}
