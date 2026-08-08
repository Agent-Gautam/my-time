"use client"

// AlertDialog — a confirmation dialog that requires an explicit user action.
// Built on top of the project's Dialog primitives (which use @base-ui/react/dialog)
// so it inherits the same animation, overlay, and focus-trap behaviour.
//
// API mirrors the shadcn/ui AlertDialog shape so call-sites are familiar:
//   <AlertDialog>
//     <AlertDialogTrigger asChild>...</AlertDialogTrigger>
//     <AlertDialogContent>
//       <AlertDialogHeader>
//         <AlertDialogTitle>...</AlertDialogTitle>
//         <AlertDialogDescription>...</AlertDialogDescription>
//       </AlertDialogHeader>
//       <AlertDialogFooter>
//         <AlertDialogCancel>Cancel</AlertDialogCancel>
//         <AlertDialogAction onClick={...}>Confirm</AlertDialogAction>
//       </AlertDialogFooter>
//     </AlertDialogContent>
//   </AlertDialog>

import * as React from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

// ---------------------------------------------------------------------------
// Root + Trigger — thin re-exports so callers use the AlertDialog namespace
// ---------------------------------------------------------------------------

const AlertDialog = Dialog
const AlertDialogTrigger = DialogTrigger

// ---------------------------------------------------------------------------
// Content — no close-button in the corner (you must use Cancel / Action)
// ---------------------------------------------------------------------------

function AlertDialogContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogContent>) {
  return (
    <DialogContent
      showCloseButton={false}
      className={cn("sm:max-w-md", className)}
      {...props}
    />
  )
}

// ---------------------------------------------------------------------------
// Header / Title / Description — straight re-exports
// ---------------------------------------------------------------------------

const AlertDialogHeader = DialogHeader
const AlertDialogTitle = DialogTitle
const AlertDialogDescription = DialogDescription

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <DialogFooter
      className={cn("sm:flex-row-reverse", className)}
      {...props}
    />
  )
}

// ---------------------------------------------------------------------------
// Cancel — closes the dialog, no side-effect
// ---------------------------------------------------------------------------

function AlertDialogCancel({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Button>) {
  return (
    <DialogClose
      render={
        <Button variant="outline" className={cn("mt-2 sm:mt-0", className)} {...props} />
      }
    >
      {children}
    </DialogClose>
  )
}

// ---------------------------------------------------------------------------
// Action — the confirming button; caller supplies onClick
// ---------------------------------------------------------------------------

function AlertDialogAction({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Button>) {
  return <Button className={cn(className)} {...props} />
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
}
