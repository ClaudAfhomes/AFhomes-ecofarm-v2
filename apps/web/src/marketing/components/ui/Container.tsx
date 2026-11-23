import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/cn";

type ContainerSize = "site" | "narrow" | "tight";

const widthBySize: Record<ContainerSize, string> = {
  site: "max-w-[var(--container-site)]",
  narrow: "max-w-[var(--container-narrow)]",
  tight: "max-w-[var(--container-tight)]",
};

interface ContainerProps extends ComponentPropsWithoutRef<"div"> {
  size?: ContainerSize;
}

export function Container({ size = "site", className, ...props }: ContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full px-5 sm:px-8 lg:px-12", widthBySize[size], className)}
      {...props}
    />
  );
}