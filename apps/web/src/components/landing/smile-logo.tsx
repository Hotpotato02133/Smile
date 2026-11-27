import { cn } from "cn";

interface SmileLogoProps {
  className?: string;
  markClassName?: string;
  textClassName?: string;
  inverted?: boolean;
}

export function SmileLogo({
  className,
  markClassName,
  textClassName,
  inverted = false,
}: SmileLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <span
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-full",
          inverted ? "bg-white text-[#6C5CE7]" : "bg-[#6C5CE7] text-white",
          markClassName
        )}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="size-4.5"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M12 3.75L13.45 7.55L17.25 9L13.45 10.45L12 14.25L10.55 10.45L6.75 9L10.55 7.55L12 3.75Z"
            fill="currentColor"
          />
          <path
            d="M6.5 15.25C7.9 17.55 9.85 18.75 12 18.75C14.15 18.75 16.1 17.55 17.5 15.25"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span
        className={cn(
          "font-heading text-sm font-bold tracking-[0.14em] uppercase",
          inverted ? "text-white" : "text-slate-950",
          textClassName
        )}
      >
        SMILE
      </span>
    </span>
  );
}
