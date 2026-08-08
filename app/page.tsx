export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-950 font-sans">
      <main className="flex flex-col items-center gap-4 p-8">
        <h1 className="text-2xl font-bold text-white">TodoList 2026</h1>
        <a
          href="/schedule"
          className="flex h-14 w-64 items-center justify-center gap-2 rounded-2xl bg-violet-600 text-white font-semibold text-base"
        >
          📅 Lịch tuần
        </a>
        <a
          href="/grid"
          className="flex h-14 w-64 items-center justify-center gap-2 rounded-2xl bg-zinc-800 text-zinc-300 font-semibold text-base"
        >
          🟪 Grid debug
        </a>
        <a
          href="/debug"
          className="flex h-14 w-64 items-center justify-center gap-2 rounded-2xl bg-zinc-800 text-zinc-400 font-medium text-sm"
        >
          🛠 Gesture debug
        </a>
      </main>
    </div>
  );
}
