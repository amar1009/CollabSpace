import { Layers2 } from "lucide-react";
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "brand-small" : ""}`}>
      <span className="brand-symbol">
        <Layers2 size={20} />
      </span>
      <span>
        collabspace<span className="brand-dot">.</span>
      </span>
    </span>
  );
}
export function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}
