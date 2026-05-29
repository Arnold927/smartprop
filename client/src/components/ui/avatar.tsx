// src/components/ui/avatar.tsx
import * as React from "react"
import { cn } from "@/lib/utils"

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
 children?: React.ReactNode
}

interface AvatarImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
 alt?: string
}

interface AvatarFallbackProps extends React.HTMLAttributes<HTMLDivElement> {
 children?: React.ReactNode
}

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
 ({ className, children, ...props }, ref) => (
 <div
 ref={ref}
 className={cn(
 "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
 className
 )}
 {...props}
 >
 {children}
 </div>
 )
)
Avatar.displayName = "Avatar"

const AvatarImage = React.forwardRef<HTMLImageElement, AvatarImageProps>(
 ({ className, alt = "Avatar", ...props }, ref) => (
 <img
 ref={ref}
 alt={alt}
 className={cn("aspect-square h-full w-full object-cover", className)}
 {...props}
 />
 )
)
AvatarImage.displayName = "AvatarImage"

const AvatarFallback = React.forwardRef<HTMLDivElement, AvatarFallbackProps>(
 ({ className, children, ...props }, ref) => (
 <div
 ref={ref}
 className={cn(
 "flex h-full w-full items-center justify-center rounded-full bg-muted",
 className
 )}
 {...props}
 >
 {children}
 </div>
 )
)
AvatarFallback.displayName = "AvatarFallback"

export { Avatar, AvatarImage, AvatarFallback }