import { useEffect, useState } from "react";

export function useCmsRevision() {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("afhomes-cms-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("afhomes-cms-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return revision;
}
