import * as React from "react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { LucideIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ActionItem {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  className?: string;
  disabled?: boolean;
}

interface MobileActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  actions: ActionItem[];
}

export function MobileActionSheet({
  open,
  onOpenChange,
  title,
  description,
  actions,
}: MobileActionSheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-sm">
          <DrawerHeader className="text-left">
            {title && <DrawerTitle>{title}</DrawerTitle>}
            {description && <DrawerDescription>{description}</DrawerDescription>}
          </DrawerHeader>
          <div className="p-4 space-y-2">
            {actions.map((action, index) => (
              <Button
                key={index}
                variant={action.variant || "outline"}
                disabled={action.disabled}
                className={cn(
                  "w-full justify-start h-12 text-base font-medium gap-3 px-4 rounded-xl",
                  action.disabled && "opacity-60 cursor-not-allowed",
                  action.className
                )}
                onClick={() => {
                  if (!action.disabled) action.onClick();
                }}
              >
                <action.icon className="h-5 w-5" />
                {action.label}
              </Button>
            ))}
          </div>
          <DrawerFooter className="pt-2">
            <DrawerClose asChild>
              <Button variant="ghost" className="h-12 text-base font-medium rounded-xl">
                Cancel
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}