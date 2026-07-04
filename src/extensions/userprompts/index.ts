import type { ExtensionToolDef } from '../types';
import manifest from './manifest.json';

export const tools: Record<string, ExtensionToolDef> = {
  ask_question: {
    meta: {
      name: 'ask_question',
      label: 'Ask Question',
      description: 'Ask the user a clarifying question with optional predefined choices.',
      descriptionForModel:
        'Present a question to the user with optional multiple-choice options. ' +
        'Use this tool when you need clarification, additional information, or a decision from the user. ' +
        '\n' +
        'When to use:\n' +
        '  • You need the user to choose between multiple approaches or options\n' +
        '  • The user\'s request is ambiguous and you need clarification\n' +
        '  • You need specific information that the user hasn\'t provided\n' +
        '  • You want to confirm a course of action before proceeding\n' +
        '\n' +
        'How to use:\n' +
        '  • Write a clear, specific question in the `question` field\n' +
        '  • Provide 2-6 concise options in the `options` array\n' +
        '  • Set `allowOther` to true if the user might have an answer not in your list\n' +
        '  • Keep questions focused — ask one thing at a time\n' +
        '  • Wait for the user\'s response before continuing your reasoning\n' +
        '\n' +
        'The user will see the question and options in a popup dialog. Their selection ' +
        'or typed response will be returned as the tool result.',
      icon: 'HelpCircle',
    },
    params: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The clarifying question to ask the user.',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Predefined answer choices for the user to pick from (optional).',
        },
        allowOther: {
          type: 'boolean',
          description: 'Allow the user to type a custom answer not in the options list (default: false).',
        },
      },
      required: ['question'],
    },
    async handler(params: { question: string; options?: string[]; allowOther?: boolean }) {
      return {
        _userInput: {
          type: 'select',
          prompt: params.question,
          options: params.options || [],
          allowOther: params.allowOther === true,
        },
      };
    },
  },
};

export { manifest };
