import { Sparkles, type LucideIcon } from 'lucide-react';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'general-chatbot': Sparkles,
};

export default function getCategoryIcon(categoryId: string): LucideIcon {
  return CATEGORY_ICONS[categoryId] ?? Sparkles;
}
