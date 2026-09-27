export interface FaqItem {
  question: string;
  answer: string;
  archived?: boolean;
}

export interface FaqCategory {
  id: string;
  label: string;
  items: FaqItem[];
  archived?: boolean;
}