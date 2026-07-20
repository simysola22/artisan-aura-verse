import { Moon, Sun, Sparkles, Sunrise, Waves } from "lucide-react";
import { useTheme, type Theme } from "./theme-context";

const options: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "midnight", label: "Midnight", icon: Sparkles },
  { value: "sunrise", label: "Sunrise", icon: Sunrise },
  { value: "ocean", label: "Ocean", icon: Waves },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/40 p-0.5"
    >
      {options.map((o) => {
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            onClick={() => setTheme(o.value)}
            className={
              "grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors " +
              (active ? "bg-background text-foreground shadow-sm" : "hover:text-foreground")
            }
          >
            <o.icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
