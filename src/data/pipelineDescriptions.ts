export const PIPELINE_DESCRIPTIONS: Record<string, string> = {
  'text-generation':
    'Generates text from a prompt. Ideal for chat, creative writing, and coding.',
  'image-text-to-text':
    'Processes both images and text to generate a text response (Vision models).',
  'text2text-generation':
    'Converts one text sequence into another, such as translation, summarizing, or rephrasing.',
  summarization:
    'Condenses long documents into shorter summaries while retaining the key information.',
  translation: 'Translates text from one language to another.',
  'question-answering':
    'Answers questions based on a provided context or general knowledge.',
  'document-question-answering':
    'Analyzes visually formatted documents (like PDFs or receipts) to answer questions about them.',
  'text-ranking':
    'Scores and ranks documents based on their relevance to a specific query.',
  'feature-extraction':
    'Transforms text into mathematical representations (embeddings) used for semantic search and AI memory.',
  'visual-question-answering':
    'Answers questions about the contents of a provided image.',
  'sentence-similarity':
    'Evaluates how similar two pieces of text are in meaning (used for vector search).',
  'text-classification':
    'Categorizes text into predefined labels (e.g., sentiment analysis, spam detection).',
  'zero-shot-classification':
    'Classifies text into categories without needing specific training examples for those categories.',
};

export const FALLBACK_PIPELINE_DESCRIPTION =
  'The pipeline tag defines the primary capability of this model. It dictates what tasks it is best suited for.';
