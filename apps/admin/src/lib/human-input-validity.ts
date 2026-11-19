import { createContext } from 'react';
export const HumanInputValidity = createContext<((id: string, invalid: boolean) => void) | null>(
  null,
);
