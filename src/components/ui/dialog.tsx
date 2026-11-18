"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useVisualViewportDialog } from "@/hooks/use-visual-viewport-dialog";
import {
  computeOriginTransformOffsets,
  installModalOriginListeners,
  resolveActiveOrigin,
} from "@/lib/kani-modal-origin";
import {
  computeContainerTransformParams,
  parseOriginBorderRadius,
} from "@/lib/kani-container-transform";
import "@/components/kani/kani-unified-modals.css";

if (typeof window !== "undefined") {
  installModalOriginListeners();
}

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-slot="dialog-overlay"
    className={cn(
      "fixed inset-0 z-[190] bg-overlay/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    overlayClassName?: string;
    closeLabel?: string;
    showCloseButton?: boolean;
    transitionMode?: "origin" | "container-transform";
  }
>(({ className, overlayClassName, closeLabel = "Close", showCloseButton = true, transitionMode = "origin", onOpenAutoFocus, children, ...props }, ref) => {
  const localRef = React.useRef<HTMLDivElement | null>(null);
  const [contentNode, setContentNode] = React.useState<HTMLDivElement | null>(null);
  const originElRef = React.useRef<Element | null>(null);
  const combinedRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      localRef.current = node;
      setContentNode(node);
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [ref],
  );
  const mergedRef = useVisualViewportDialog(combinedRef);

  React.useLayoutEffect(() => {
    installModalOriginListeners();
    const node = contentNode;
    if (!node || typeof window === "undefined") return;
    if (node.classList.contains("payway-checkout")) return;

    const isContainerTransform = transitionMode === "container-transform";

    const applyCenteredFallback = () => {
      node.style.setProperty("--kani-origin-x", "0px");
      node.style.setProperty("--kani-origin-y", "0px");
      node.style.setProperty("--kani-origin-scale", isContainerTransform ? "0.88" : "0.92");
      node.style.setProperty("--kani-exit-scale", isContainerTransform ? "0.9" : "0.94");
      if (isContainerTransform) {
        node.style.setProperty("--kani-ct-inset-x", "0px");
        node.style.setProperty("--kani-ct-inset-y", "0px");
        node.style.setProperty("--kani-ct-origin-radius", "24px");
      }
    };

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    if (reducedMotion) {
      node.style.setProperty("--kani-origin-x", "0px");
      node.style.setProperty("--kani-origin-y", "0px");
      node.style.setProperty("--kani-origin-scale", "1");
      node.style.setProperty("--kani-exit-scale", "1");
      if (isContainerTransform) {
        node.style.setProperty("--kani-ct-inset-x", "0px");
        node.style.setProperty("--kani-ct-inset-y", "0px");
        node.style.setProperty("--kani-ct-origin-radius", "24px");
      }
      return;
    }

    const origin = resolveActiveOrigin();
    originElRef.current = origin?.element ?? null;
    const modalRect = node.getBoundingClientRect();

    if (isContainerTransform) {
      const originRadius = parseOriginBorderRadius(origin?.element ?? null);
      const ct = computeContainerTransformParams(
        origin?.rect ?? null,
        modalRect,
        undefined,
        originRadius,
        origin?.inputType ?? "pointer",
      );
      node.style.setProperty("--kani-origin-x", `${ct.dx}px`);
      node.style.setProperty("--kani-origin-y", `${ct.dy}px`);
      node.style.setProperty("--kani-origin-scale", String(ct.enterScale));
      node.style.setProperty("--kani-exit-scale", String(ct.exitScale));
      node.style.setProperty("--kani-ct-inset-x", `${ct.insetX}px`);
      node.style.setProperty("--kani-ct-inset-y", `${ct.insetY}px`);
      node.style.setProperty("--kani-ct-origin-radius", `${ct.originRadius}px`);
    } else {
      const { dx, dy, enterScale, exitScale } = computeOriginTransformOffsets(
        origin?.rect ?? null,
        modalRect,
      );
      node.style.setProperty("--kani-origin-x", `${dx}px`);
      node.style.setProperty("--kani-origin-y", `${dy}px`);
      node.style.setProperty("--kani-origin-scale", String(enterScale));
      node.style.setProperty("--kani-exit-scale", String(exitScale));
    }

    const observer = new MutationObserver(() => {
      if (node.getAttribute("data-state") !== "closed") return;
      const triggerEl = originElRef.current;
      if (!triggerEl || !triggerEl.isConnected) {
        applyCenteredFallback();
        return;
      }
      const liveOriginRect = triggerEl.getBoundingClientRect();
      const liveModalRect = node.getBoundingClientRect();
      if (isContainerTransform) {
        const nextCt = computeContainerTransformParams(
          liveOriginRect,
          liveModalRect,
          undefined,
          parseOriginBorderRadius(triggerEl),
          origin?.inputType ?? "pointer",
        );
        node.style.setProperty("--kani-origin-x", `${nextCt.dx}px`);
        node.style.setProperty("--kani-origin-y", `${nextCt.dy}px`);
        node.style.setProperty("--kani-exit-scale", String(nextCt.exitScale));
        node.style.setProperty("--kani-ct-inset-x", `${nextCt.insetX}px`);
        node.style.setProperty("--kani-ct-inset-y", `${nextCt.insetY}px`);
        node.style.setProperty("--kani-ct-origin-radius", `${nextCt.originRadius}px`);
      } else {
        const nextOffsets = computeOriginTransformOffsets(liveOriginRect, liveModalRect);
        node.style.setProperty("--kani-origin-x", `${nextOffsets.dx}px`);
        node.style.setProperty("--kani-origin-y", `${nextOffsets.dy}px`);
        node.style.setProperty("--kani-exit-scale", String(nextOffsets.exitScale));
      }
    });
    observer.observe(node, { attributes: true, attributeFilter: ["data-state"] });

    return () => observer.disconnect();
  }, [contentNode, transitionMode]);

  const handleOpenAutoFocus = React.useCallback(
    (event: Event) => {
      onOpenAutoFocus?.(event);
      if (event.defaultPrevented) return;
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) return;
      const firstFocusable = target.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (
        firstFocusable &&
        (firstFocusable.tagName === "SELECT" ||
          firstFocusable.getAttribute("role") === "combobox")
      ) {
        event.preventDefault();
        target.focus({ preventScroll: true });
      }
    },
    [onOpenAutoFocus],
  );

  return (
    <DialogPortal>
      <DialogOverlay
        className={overlayClassName}
        data-kani-transition={transitionMode === "container-transform" ? "container-transform" : undefined}
      />
      <DialogPrimitive.Content
        ref={mergedRef}
        data-slot="dialog-content"
        data-kani-transition={transitionMode === "container-transform" ? "container-transform" : undefined}
        className={cn(
          "fixed left-[calc(var(--kani-vv-left,0px)+var(--kani-vv-width,100vw)/2)] top-[calc(var(--kani-vv-top,0px)+var(--kani-vv-height,100dvh)/2)] z-[200] grid w-[calc(100%-24px)] max-w-[min(32rem,calc(var(--kani-vv-width,100vw)-max(24px,env(safe-area-inset-left,0px)+env(safe-area-inset-right,0px))))] max-h-[calc(var(--kani-vv-height,100dvh)-max(24px,env(safe-area-inset-top,0px)+env(safe-area-inset-bottom,0px)))] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto overflow-x-hidden overscroll-contain rounded-2xl border bg-background p-5 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:w-full sm:rounded-lg sm:p-6",
          className,
        )}
        onOpenAutoFocus={handleOpenAutoFocus}
        {...props}
      >
        {children}
        {showCloseButton && <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background cursor-pointer transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">{closeLabel}</span>
        </DialogPrimitive.Close>}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

const KaniModalClose = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close> & { label?: string }
>(({ className, label = "Cerrar", ...props }, ref) => (
  <DialogPrimitive.Close
    ref={ref}
    aria-label={label}
    className={cn("kani-modal-close", className)}
    {...props}
  >
    <X size={18} aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </DialogPrimitive.Close>
));
KaniModalClose.displayName = "KaniModalClose";

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  KaniModalClose,
};
