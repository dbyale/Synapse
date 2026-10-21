import {
  Code2,
  Edit,
  Globe,
  Lightbulb,
  Search,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'everyday-assistant': Sparkles,
  translator: Globe,
  'business-assistant': Users,
  'writing-assistant': Edit,
  tutor: Lightbulb,
  'research-assistant': Search,
  'code-assistant': Code2,
};

export default function getCategoryIcon(categoryId: string): LucideIcon {
  return CATEGORY_ICONS[categoryId] ?? Sparkles;
}
