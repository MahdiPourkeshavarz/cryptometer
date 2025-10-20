/* eslint-disable prettier/prettier */
import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions';

export const LLM_OPTIONS = {
  tools: [
    {
      type: 'function',
      function: {
        name: 'hype_fud_output',
        description: 'Formats the Hype and FUD analysis.',
        parameters: {
          type: 'object',
          properties: {
            hype: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  score: { type: 'number' },
                  reasoning: {
                    type: 'string',
                    description:
                      'Insightful one-sentence reason for the score.',
                  },
                },
                required: ['name', 'score', 'reasoning'],
              },
            },
            fud: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  score: { type: 'number' },
                  reasoning: {
                    type: 'string',
                    description:
                      'Insightful one-sentence reason for the score.',
                  },
                },
                required: ['name', 'score', 'reasoning'],
              },
            },
          },
          required: ['hype', 'fud'],
        },
      },
    },
  ],
  // This forces the model to use our defined tool
  tool_choice: {
    type: 'function',
    function: { name: 'hype_fud_output' },
  },
} satisfies Partial<ChatCompletionCreateParams>;
