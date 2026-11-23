import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../../lib/cn";
import { Plus } from "../../components/ui/icons";
import { EASE } from "../../lib/motion";

export interface AccordionItemData {
  id: string;
  question: string;
  answer: string;
}

interface AccordionProps {
  items: AccordionItemData[];
  /* When false (default) only one item can be open at a time. */
  allowMultiple?: boolean;
  className?: string;
  tone?: "light" | "dark";
}

export function Accordion({
  items,
  allowMultiple = false,
  className,
  tone = "light",
}: AccordionProps) {
  const [open, setOpen] = useState<string[]>(() => {
    const first = items[0]?.id;
    return first ? [first] : [];
  });

  const toggle = (id: string) => {
    setOpen((current) => {
      const isOpen = current.includes(id);
      if (allowMultiple) {
        return isOpen ? current.filter((item) => item !== id) : [...current, id];
      }
      return isOpen ? [] : [id];
    });
  };

  return (
    <div
      className={cn(
        "divide-y",
        tone === "dark" ? "divide-white/15" : "divide-line",
        className,
      )}
    >
      {items.map((item) => {
        const isOpen = open.includes(item.id);
        const controlId = `accordion-trigger-${item.id}`;
        const panelId = `accordion-panel-${item.id}`;

        return (
          <div key={item.id}>
            <h3>
              <button
                type="button"
                id={controlId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
                className={cn(
                  "group flex w-full items-center justify-between gap-6 py-6 text-left transition-colors sm:py-7",
                  tone === "dark"
                    ? "text-cream-50 hover:text-leaf-300"
                    : "text-navy-900 hover:text-leaf-700",
                )}
              >
                <span className="font-display text-xl leading-snug font-medium text-balance sm:text-2xl">
                  {item.question}
                </span>
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-transform duration-300",
                    isOpen && "rotate-45",
                    tone === "dark"
                      ? "border-white/25 text-cream-100 group-hover:border-coral-300"
                      : "border-navy-800/30 text-navy-800 group-hover:border-leaf-500 group-hover:text-leaf-700",
                  )}
                >
                  <Plus className="h-4 w-4" />
                </span>
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  id={panelId}
                  role="region"
                  aria-labelledby={controlId}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.35, ease: EASE }}
                  className="overflow-hidden"
                >
                  <p
                    className={cn(
                      "max-w-3xl pb-7 leading-relaxed text-pretty sm:text-lg",
                      tone === "dark" ? "text-cream-200/80" : "text-ink-600",
                    )}
                  >
                    {item.answer}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}