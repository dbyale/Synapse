export interface PipelineTagOption {
  id: string;
  label: string;
}

export const PIPELINE_TAGS: PipelineTagOption[] = [
  { id: 'text-generation', label: 'Text Generation' },
  { id: 'image-text-to-text', label: 'Image-Text-to-Text' },
  { id: 'text2text-generation', label: 'Text-to-Text Generation' },
  { id: 'text-classification', label: 'Text Classification' },
  { id: 'token-classification', label: 'Token Classification' },
  { id: 'question-answering', label: 'Question Answering' },
  { id: 'translation', label: 'Translation' },
  { id: 'summarization', label: 'Summarization' },
  { id: 'fill-mask', label: 'Fill Mask' },
  { id: 'sentence-similarity', label: 'Sentence Similarity' },
  { id: 'feature-extraction', label: 'Feature Extraction' },
  { id: 'automatic-speech-recognition', label: 'Speech Recognition' },
  { id: 'text-to-speech', label: 'Text-to-Speech' },
  { id: 'text-to-image', label: 'Text-to-Image' },
  { id: 'image-to-text', label: 'Image-to-Text' },
  { id: 'image-classification', label: 'Image Classification' },
  { id: 'object-detection', label: 'Object Detection' },
  { id: 'image-segmentation', label: 'Image Segmentation' },
  { id: 'zero-shot-classification', label: 'Zero-Shot Classification' },
  { id: 'visual-question-answering', label: 'Visual QA' },
  { id: 'reinforcement-learning', label: 'Reinforcement Learning' },
];
