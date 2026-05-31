import React from 'react';
import {
  MessageSquare,
  Image,
  FileText,
  Tags,
  HelpCircle,
  Languages,
  AlignLeft,
  FileSearch,
  ListOrdered,
  Braces,
  GitCompare,
  Sparkles,
  Eye,
} from 'lucide-react';

export interface PipelineTagOption {
  id: string;
  label: string;
  icon: React.FC<{ size?: number; className?: string }>;
}

export const PIPELINE_TAGS: PipelineTagOption[] = [
  { id: 'text-generation', label: 'Text Generation', icon: MessageSquare },
  { id: 'image-text-to-text', label: 'Image-Text-to-Text', icon: Image },
  {
    id: 'text2text-generation',
    label: 'Text-to-Text Generation',
    icon: FileText,
  },
  { id: 'summarization', label: 'Summarization', icon: AlignLeft },
  { id: 'translation', label: 'Translation', icon: Languages },
  { id: 'question-answering', label: 'Question Answering', icon: HelpCircle },
  {
    id: 'document-question-answering',
    label: 'Document Question Answering',
    icon: FileSearch,
  },
  { id: 'text-ranking', label: 'Text Ranking', icon: ListOrdered },
  {
    id: 'feature-extraction',
    label: 'Feature Extraction (Embeddings)',
    icon: Braces,
  },
  {
    id: 'visual-question-answering',
    label: 'Visual Question Answering',
    icon: Eye,
  },
  { id: 'sentence-similarity', label: 'Sentence Similarity', icon: GitCompare },
  { id: 'text-classification', label: 'Text Classification', icon: Tags },
  {
    id: 'zero-shot-classification',
    label: 'Zero-Shot Classification',
    icon: Sparkles,
  },
];

export const PIPELINE_TAG_MAP: Record<string, PipelineTagOption> =
  Object.fromEntries(PIPELINE_TAGS.map((pt) => [pt.id, pt]));
