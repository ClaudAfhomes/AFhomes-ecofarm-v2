import { motion } from "motion/react";

export function ScrollIndicator({ label = "Explore" }: { label?: string }) {
  return (
    <motion.div
      className="pointer-events-none absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 text-cream-100"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1.4, duration: 0.8 }}
      aria-hidden="true"
    >
      <span className="label-caps opacity-60">{label}</span>
      <span className="relative h-9 w-5 rounded-full border border-cream-100/40">
        <motion.span
          className="absolute top-1.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-leaf-300"
          animate={{ y: [0, 12, 0], opacity: [1, 0.25, 1] }}
          transition={{ duration: 1.9, repeat: Infinity, ease: "easeInOut" }}
        />
      </span>
    </motion.div>
  );
}