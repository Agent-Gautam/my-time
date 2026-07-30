const TOKEN_BG_CLASS: Record<string, string> = {
  bg: "bg-bg",
  surface: "bg-surface",
  "surface-2": "bg-surface-2",
  border: "bg-border",
  text: "bg-text",
  "text-muted": "bg-text-muted",
  "text-subtle": "bg-text-subtle",
  ink: "bg-ink",
  "accent-text": "bg-accent-text",
  "accent-fill": "bg-accent-fill",
  "accent-fg": "bg-accent-fg",
  "on-track": "bg-on-track",
  attention: "bg-attention",
  blocked: "bg-blocked",
  neutral: "bg-neutral",
  scrim: "bg-scrim",
};

export function ColorSwatch({ token, use }: { token: string; use: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
      <div
        className={`size-10 shrink-0 rounded-md border border-border ${TOKEN_BG_CLASS[token] ?? ""}`}
      />
      <div className="min-w-0">
        <p className="text-label font-medium text-text">{token}</p>
        <p className="text-caption text-text-subtle">{use}</p>
      </div>
    </div>
  );
}
