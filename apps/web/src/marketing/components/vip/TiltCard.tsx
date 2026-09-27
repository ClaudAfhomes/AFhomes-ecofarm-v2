import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";

/**
 * Subtle desktop-only 3D tilt. Disabled for touch devices and users who
 * prefer reduced motion. Pure enhancement — no functionality depends on it.
 */
export function TiltCard({ children, max = 4, className }: 
  Omit<ComponentPropsWithoutRef<"div">, "className"> & {
    children: ReactNode;
    max?: number;
    className?: string;
  },
) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [enabled, setEnabled] = useState(false);

  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const springRotateX = useSpring(rotateX, { stiffness: 180, damping: 18 });
  const springRotateY = useSpring(rotateY, { stiffness: 180, damping: 18 });

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setEnabled(fine.matches && !reduce.matches);
    update();
    fine.addEventListener("change", update);
    reduce.addEventListener("change", update);
    return () => {
      fine.removeEventListener("change", update);
      reduce.removeEventListener("change", update);
    };
  }, []);

  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!enabled || reducedMotion) return;
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    rotateY.set(px * max * 2);
    rotateX.set(-py * max * 2);
  };

  const onMouseLeave = () => {
    rotateX.set(0);
    rotateY.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      style={{ rotateX: springRotateX, rotateY: springRotateY, transformStyle: "preserve-3d" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}