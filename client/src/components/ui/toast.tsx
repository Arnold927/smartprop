import * as React from "react"
import * as ToastPrimitives from "@radix-ui/react-toast"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const ToastProvider = ToastPrimitives.Provider

/**
 * ToastViewport
 * Standard viewport positioning — unchanged from original.
 */
const ToastViewport = React.forwardRef<
 React.ElementRef<typeof ToastPrimitives.Viewport>,
 React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
 <ToastPrimitives.Viewport
 ref={ref}
 className={cn(
 "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4",
 "sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
 className
 )}
 {...props}
 />
))
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

/**
 * toastVariants
 * Uses Tailwind semantic utilities (bg-background, text-foreground, border-border)
 * that resolve against the active theme's CSS custom properties.
 *
 * Replaces the former [data-radix-toast-root] !important global override.
 *
 * The `destructive` variant uses --status-error-* tokens (a soft tinted background
 * with a dark, legible foreground) instead of a harsh solid-red background.
 * A left accent border provides clear visual affordance that this is an error,
 * without assaulting the user's eyes.
 */
const toastVariants = cva(
 [
 // Layout
 "group pointer-events-auto relative flex w-full items-center",
 "justify-between space-x-4 overflow-hidden",
 // Appearance — resolves via theme tokens
 "rounded-md border border-border",
 "bg-[var(--surface)] text-[var(--surface-fg)]",
 "shadow-lg",
 "p-6 pr-8",
 // Swipe / animation
 "transition-all",
 "data-[swipe=cancel]:translate-x-0",
 "data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]",
 "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]",
 "data-[swipe=move]:transition-none",
 "data-[state=open]:animate-in data-[state=closed]:animate-out",
 "data-[swipe=end]:animate-out",
 "data-[state=closed]:fade-out-80",
 "data-[state=closed]:slide-out-to-right-full",
 "data-[state=open]:slide-in-from-top-full",
 "data-[state=open]:sm:slide-in-from-bottom-full",
 ].join(" "),
 {
 variants: {
 variant: {
 default: "",
 // Soft tinted error: readable dark-red text on a light-red background,
 // with a bold left border as the primary "danger" signal.
 destructive:
 "destructive group border-[var(--status-error-fg)]/30 border-l-4 border-l-[var(--status-error-fg)] bg-[var(--status-error-bg)] text-[var(--status-error-fg)]",
 },
 },
 defaultVariants: {
 variant: "default",
 },
 }
)

const Toast = React.forwardRef<
 React.ElementRef<typeof ToastPrimitives.Root>,
 React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
 VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
 return (
 <ToastPrimitives.Root
 ref={ref}
 className={cn(toastVariants({ variant }), className)}
 {...props}
 />
 )
})
Toast.displayName = ToastPrimitives.Root.displayName

const ToastAction = React.forwardRef<
 React.ElementRef<typeof ToastPrimitives.Action>,
 React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
 <ToastPrimitives.Action
 ref={ref}
 className={cn(
 "inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-border",
 "bg-transparent px-3 text-sm font-medium",
 "ring-offset-background transition-colors",
 "hover:bg-[var(--surface-hover)]",
 "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
 "disabled:pointer-events-none disabled:opacity-50",
 "group-[.destructive]:border-muted/40",
 "group-[.destructive]:hover:border-destructive/30",
 "group-[.destructive]:hover:bg-[var(--status-error-bg)]",
 "group-[.destructive]:hover:text-[var(--status-error-fg)]",
 "group-[.destructive]:focus:ring-destructive",
 className
 )}
 {...props}
 />
))
ToastAction.displayName = ToastPrimitives.Action.displayName

const ToastClose = React.forwardRef<
 React.ElementRef<typeof ToastPrimitives.Close>,
 React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
 <ToastPrimitives.Close
 ref={ref}
 className={cn(
 "absolute right-2 top-2 rounded-md p-1",
 "text-[var(--surface-fg)] opacity-50",
 "transition-opacity hover:opacity-100",
 "focus:opacity-100 focus:outline-none focus:ring-2",
 "group-hover:opacity-100",
 "group-[.destructive]:text-[var(--status-error-fg)]/60",
 "group-[.destructive]:hover:text-[var(--status-error-fg)]",
 "group-[.destructive]:focus:ring-[var(--status-error-fg)]",
 "group-[.destructive]:focus:ring-offset-[var(--status-error-bg)]",
 className
 )}
 toast-close=""
 {...props}
 >
 <X className="h-4 w-4" />
 </ToastPrimitives.Close>
))
ToastClose.displayName = ToastPrimitives.Close.displayName

/**
 * ToastTitle
 * Inherits colour from the parent toast so it works correctly for both the
 * default (--surface-fg) and destructive (--status-error-fg) variants.
 */
const ToastTitle = React.forwardRef<
 React.ElementRef<typeof ToastPrimitives.Title>,
 React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
 <ToastPrimitives.Title
 ref={ref}
 className={cn(
 "text-sm font-semibold",
 // Default: use surface token; destructive: inherit the error fg from parent
 "text-[var(--surface-fg)] group-[.destructive]:text-[var(--status-error-fg)]",
 className
 )}
 {...props}
 />
))
ToastTitle.displayName = ToastPrimitives.Title.displayName

/**
 * ToastDescription
 * Inherits colour from the parent toast — muted for default, error fg for destructive.
 */
const ToastDescription = React.forwardRef<
 React.ElementRef<typeof ToastPrimitives.Description>,
 React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
 <ToastPrimitives.Description
 ref={ref}
 className={cn(
 "text-sm leading-5",
 "text-[var(--surface-fg-muted)] group-[.destructive]:text-[var(--status-error-fg)]/80",
 className
 )}
 {...props}
 />
))
ToastDescription.displayName = ToastPrimitives.Description.displayName

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>
type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
 type ToastProps,
 type ToastActionElement,
 ToastProvider,
 ToastViewport,
 Toast,
 ToastTitle,
 ToastDescription,
 ToastClose,
 ToastAction,
}