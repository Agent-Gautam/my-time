import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { ColorSwatch } from "./color-swatch";
import { ToastDemo } from "./toast-demo";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-border py-8 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-title font-semibold text-ink">{title}</h2>
        {description ? (
          <p className="text-body text-text-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

const SPACING_STEPS = [4, 8, 12, 16, 24, 32, 48];

export default function StyleguidePage() {
  return (
    <main className="mx-auto flex w-full max-w-[68ch] flex-col gap-2 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6">
        <div>
          <h1 className="text-display font-semibold text-ink">Styleguide</h1>
          <p className="text-body text-text-muted">
            Every token, type step, spacing step, status colour and component —
            in both themes.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <Section
        title="Colour tokens"
        description="Themes are data (D52) — every value here comes from src/app/theme.css. Toggle the theme above; nothing else on this page changes."
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ColorSwatch token="bg" use="Page ground" />
          <ColorSwatch token="surface" use="Cards, sheets" />
          <ColorSwatch token="surface-2" use="Recessed areas, subtle fills" />
          <ColorSwatch token="border" use="Hairlines, dividers" />
          <ColorSwatch token="text" use="Body copy" />
          <ColorSwatch token="text-muted" use="Secondary text, labels" />
          <ColorSwatch
            token="text-subtle"
            use="Tertiary — large text only"
          />
          <ColorSwatch token="ink" use="Headings, strong structure" />
          <ColorSwatch token="accent-text" use="Amber as text — 4.9:1" />
          <ColorSwatch token="accent-fill" use="Amber as background only" />
          <ColorSwatch token="accent-fg" use="Text on accent-fill" />
          <ColorSwatch token="scrim" use="Dialog / sheet backdrop" />
        </div>
        <p className="text-label text-text-subtle">
          §2.2 — <code>accent-text</code> and <code>accent-fill</code> are not
          interchangeable. The fill amber is ~2:1 contrast (background only);
          the text amber is ~4.9:1 (safe for body copy). Never swap them.
        </p>
      </Section>

      <Section
        title="Status colours"
        description="D15 — a miss is neutral, never a failure. No red anywhere in the app."
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ColorSwatch token="on-track" use="Meeting cadence, ahead of the line" />
          <ColorSwatch token="attention" use="Behind, rate has moved" />
          <ColorSwatch token="blocked" use="Target no longer reachable — muted clay, not red" />
          <ColorSwatch token="neutral" use="Missed sessions — deliberately neutral" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-label text-on-track">
            <span className="size-2 rounded-full bg-on-track" /> On track
          </span>
          <span className="flex items-center gap-1.5 text-label text-attention">
            <span className="size-2 rounded-full bg-attention" /> Attention
          </span>
          <span className="flex items-center gap-1.5 text-label text-blocked">
            <span className="size-2 rounded-full bg-blocked" /> Blocked
          </span>
          <span className="flex items-center gap-1.5 text-label text-neutral">
            <span className="size-2 rounded-full bg-neutral" /> Missed
          </span>
        </div>
      </Section>

      <Section
        title="Type"
        description="Inter, self-hosted via next/font. Tabular numerals (.numeric) are mandatory on every numeric display — §4.1."
      >
        <div className="flex flex-col gap-3">
          <p className="text-display font-semibold text-ink">Display 32/600</p>
          <p className="text-title font-semibold text-ink">Title 22/600</p>
          <p className="text-section font-semibold text-text">Section 16/600</p>
          <p className="text-body text-text">
            Body 15/400 — the default reading size, slightly larger than 14
            for comfort. Max measure ~68 characters on desktop.
          </p>
          <p className="text-label font-medium text-text-muted">
            Label 13/500 — metadata, reasons
          </p>
          <p className="text-caption text-text-subtle">
            Caption 12/400 — never critical information
          </p>
          <div className="flex items-center gap-4 rounded-lg border border-border bg-surface p-3">
            <span className="numeric text-display text-ink">42</span>
            <span className="text-label text-text-muted">
              .numeric — tabular figures, so this number does not jitter as
              it changes
            </span>
          </div>
        </div>
      </Section>

      <Section
        title="Spacing"
        description="4px base scale — Tailwind's default spacing already matches design.md §5, no override needed."
      >
        <div className="flex flex-col gap-2">
          {SPACING_STEPS.map((step) => (
            <div key={step} className="flex items-center gap-3">
              <span className="numeric w-10 text-label text-text-muted">
                {step}px
              </span>
              <span
                className="h-3 rounded-sm bg-accent-fill"
                style={{ width: `${step * 2}px` }}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-2">
          <Button>Default</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="ghost">Ghost</Badge>
        </div>
      </Section>

      <Section title="Card">
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Gym — Push day</CardTitle>
            <CardDescription>45 min · evening</CardDescription>
          </CardHeader>
          <CardContent className="text-body text-text-muted">
            Scheduled from your cadence — 3 sessions this week.
          </CardContent>
        </Card>
      </Section>

      <Section title="Form controls">
        <div className="flex max-w-sm flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sg-input">Goal name</Label>
            <Input id="sg-input" placeholder="e.g. Read 30 min" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sg-textarea">Purpose</Label>
            <Textarea id="sg-textarea" placeholder="Why this goal matters" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sg-select">Daypart</Label>
            <Select defaultValue="evening">
              <SelectTrigger id="sg-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="morning">Morning</SelectItem>
                <SelectItem value="afternoon">Afternoon</SelectItem>
                <SelectItem value="evening">Evening</SelectItem>
                <SelectItem value="night">Night</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="sg-checkbox" defaultChecked />
            <Label htmlFor="sg-checkbox">Eligible for morning daypart</Label>
          </div>
          <RadioGroup defaultValue="frequency">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="frequency" id="sg-radio-1" />
              <Label htmlFor="sg-radio-1">Frequency cadence</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="fixed_days" id="sg-radio-2" />
              <Label htmlFor="sg-radio-2">Fixed days</Label>
            </div>
          </RadioGroup>
          <div className="flex items-center gap-2">
            <Switch id="sg-switch" />
            <Label htmlFor="sg-switch">Push reminders</Label>
          </div>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="today">
          <TabsList>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="missed">Missed</TabsTrigger>
          </TabsList>
          <TabsContent value="today" className="text-body text-text-muted">
            Check in to see what fits.
          </TabsContent>
          <TabsContent value="week" className="text-body text-text-muted">
            The week&apos;s plan.
          </TabsContent>
          <TabsContent value="missed" className="text-body text-text-muted">
            Missed sessions — grey, never red.
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Dialog and sheet">
        <div className="flex flex-wrap gap-2">
          <Dialog>
            <DialogTrigger render={<Button variant="outline">Open dialog</Button>} />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Drop this goal?</DialogTitle>
                <DialogDescription>
                  It stays in history. You can start a new cycle any time.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter showCloseButton>
                <Button>Confirm</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger render={<Button variant="outline">Open sheet</Button>} />
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Check in</SheetTitle>
                <SheetDescription>
                  How many minutes do you have right now?
                </SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
        </div>
      </Section>

      <Section title="Tooltip and dropdown menu">
        <div className="flex flex-wrap gap-2">
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline">Hover me</Button>} />
            <TooltipContent>Cadence debt: required ÷ days left</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline">Menu</Button>} />
            <DropdownMenuContent>
              <DropdownMenuLabel>Cycle</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Renew</DropdownMenuItem>
              <DropdownMenuItem>Continue</DropdownMenuItem>
              <DropdownMenuItem variant="destructive">Drop</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Section>

      <Section title="Toast">
        <ToastDemo />
      </Section>

      <Section title="Skeleton">
        <div className="flex max-w-sm flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Section>
    </main>
  );
}
