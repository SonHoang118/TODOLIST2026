interface TaskAvatarProps {
  name: string | null;
  avatar: string | null;
  fallbackSeed?: number | null;
  size?: "xs" | "sm" | "md";
}

export function TaskAvatar({ name, avatar, fallbackSeed, size = "sm" }: TaskAvatarProps) {
  const label = (name?.trim().charAt(0) || (fallbackSeed ? String(fallbackSeed).charAt(0) : "?")).toUpperCase();
  const sizeClass = size === "xs"
    ? "h-3.5 w-3.5 text-[7px]"
    : size === "md"
      ? "h-5 w-5 text-[9px]"
      : "h-4 w-4 text-[8px]";

  if (avatar) {
    return <img src={avatar} alt={name ?? "avatar"} draggable={false} onDragStart={(event) => event.preventDefault()} className={`${sizeClass} rounded-full object-cover border border-white/40 shrink-0 pointer-events-none select-none`} style={{ WebkitTouchCallout: "none" }} />;
  }

  return <div className={`${sizeClass} rounded-full bg-zinc-700 text-white font-semibold flex items-center justify-center border border-white/40 shrink-0 pointer-events-none select-none`} style={{ WebkitTouchCallout: "none" }}>{label}</div>;
}
