"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ToastDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => toast("Session logged.")}>
        Default
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.success("Synced.")}
      >
        Success
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.error("Couldn't reach the server — queued.")}
      >
        Error
      </Button>
    </div>
  );
}
