import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Card
 * Styled via CSS custom-property tokens (--card-shadow, --card-border)
 * defined in index.css for each theme (light / gray / dark).
 *
 * This replaces the former:
 * .card, .rounded-lg.border.bg-card { border: none !important; box-shadow: ... !important; }
 * .dark .card { border: 1px solid ... !important; }
 * .gray .card { border: 1px solid ... !important; }
 */
const Card = React.forwardRef<
 HTMLDivElement,
 React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
 <div
 ref={ref}
 className={cn(
 "rounded-lg bg-card text-card-foreground",
 // Token-driven border & shadow — automatically adapts to active theme
 "border border-[var(--card-border)]",
 "[box-shadow:var(--card-shadow)]",
 className
 )}
 {...props}
 />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef<
 HTMLDivElement,
 React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
 <div
 ref={ref}
 className={cn("flex flex-col space-y-1.5 p-6", className)}
 {...props}
 />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
 HTMLDivElement,
 React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
 <div
 ref={ref}
 className={cn(
 "text-2xl font-semibold leading-none tracking-tight",
 className
 )}
 {...props}
 />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
 HTMLDivElement,
 React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
 <div
 ref={ref}
 className={cn("text-sm text-muted-foreground", className)}
 {...props}
 />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
 HTMLDivElement,
 React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
 <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
 HTMLDivElement,
 React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
 <div
 ref={ref}
 className={cn("flex items-center p-6 pt-0", className)}
 {...props}
 />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
