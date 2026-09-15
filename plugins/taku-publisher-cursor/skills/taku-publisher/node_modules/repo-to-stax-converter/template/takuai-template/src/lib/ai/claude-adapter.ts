import type { AiCompletionRequest, AiContentPart, AiMessage } from './types';

export const CLAUDE_FIXED_MODEL = 'claude-sonnet-4-5-20250929';

const DEFAULT_MAX_TOKENS = 2048;

type ClaudeTextBlock = {
  type: 'text';
  text: string;
};

type ClaudeImageUrlBlock = {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
};

type ClaudeToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
};

type ClaudeToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ClaudeTextBlock[];
};

type ClaudeContentBlock =
  | ClaudeTextBlock
  | ClaudeImageUrlBlock
  | ClaudeToolUseBlock
  | ClaudeToolResultBlock;

type ClaudeMessage = {
  role: 'user' | 'assistant';
  content: string | ClaudeContentBlock[];
};

type ClaudeTool = {
  name: string;
  description?: string;
  input_schema: unknown;
};

export type ClaudeMessagesRequest = {
  model: string;
  max_tokens: number;
  messages: ClaudeMessage[];
  stream?: boolean;
  system?: string;
  temperature?: number;
  top_p?: number;
  tools?: ClaudeTool[];
};

export function buildClaudeMessagesRequest(input: AiCompletionRequest): ClaudeMessagesRequest {
  const sourceMessages = Array.isArray(input.messages) ? input.messages : [];

  const systemLines: string[] = [];
  const messages: ClaudeMessage[] = [];

  sourceMessages.forEach((message, messageIndex) => {
    const role = String(message.role ?? '').trim() as AiMessage['role'];

    if (role === 'system') {
      const systemText = extractMessageText(message).trim();
      if (systemText) systemLines.push(systemText);
      return;
    }

    if (role === 'tool') {
      const toolResultMessage = toToolResultMessage(message);
      if (toolResultMessage) messages.push(toolResultMessage);
      return;
    }

    if (role === 'assistant') {
      const assistantMessage = toAssistantMessage(message, messageIndex);
      if (assistantMessage) messages.push(assistantMessage);
      return;
    }

    const userMessage = toUserMessage(message);
    if (userMessage) messages.push(userMessage);
  });

  const maxTokens = resolveMaxTokens(input);
  const tools = toClaudeTools(input);
  const request: ClaudeMessagesRequest = {
    model: CLAUDE_FIXED_MODEL,
    max_tokens: maxTokens,
    messages,
    stream: Boolean(input.stream),
  };

  if (typeof input.temperature === 'number' && Number.isFinite(input.temperature)) {
    request.temperature = input.temperature;
  }
  if (typeof input.top_p === 'number' && Number.isFinite(input.top_p)) {
    request.top_p = input.top_p;
  }
  if (systemLines.length > 0) {
    request.system = systemLines.join('\n\n');
  }
  if (tools.length > 0) {
    request.tools = tools;
  }

  return request;
}

function resolveMaxTokens(input: AiCompletionRequest): number {
  if (
    typeof input.max_tokens === 'number' &&
    Number.isFinite(input.max_tokens) &&
    input.max_tokens > 0
  ) {
    return Math.trunc(input.max_tokens);
  }
  if (
    typeof input.reasoning?.max_tokens === 'number' &&
    Number.isFinite(input.reasoning.max_tokens) &&
    input.reasoning.max_tokens > 0
  ) {
    return Math.trunc(input.reasoning.max_tokens);
  }
  return DEFAULT_MAX_TOKENS;
}

function toClaudeTools(input: AiCompletionRequest): ClaudeTool[] {
  const sourceTools = Array.isArray(input.tools) ? input.tools : [];
  const tools: ClaudeTool[] = [];

  for (const item of sourceTools) {
    if (!item || item.type !== 'function' || !item.function) continue;
    const name = String(item.function.name ?? '').trim();
    if (!name) continue;
    const description = String(item.function.description ?? '').trim();
    tools.push({
      name,
      description: description || undefined,
      input_schema: item.function.parameters ?? { type: 'object', properties: {} },
    });
  }

  return tools;
}

function toUserMessage(message: AiMessage): ClaudeMessage | null {
  const content = toClaudeContent(message.content);
  if (content == null) return null;
  return { role: 'user', content };
}

function toAssistantMessage(message: AiMessage, messageIndex: number): ClaudeMessage | null {
  const blocks: ClaudeContentBlock[] = [];
  const messageContent = toClaudeContent(message.content);

  if (typeof messageContent === 'string') {
    const text = messageContent.trim();
    if (text) blocks.push({ type: 'text', text });
  } else if (Array.isArray(messageContent)) {
    for (const block of messageContent) {
      if (block.type === 'tool_result') continue;
      blocks.push(block);
    }
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  toolCalls.forEach((toolCall, toolCallIndex) => {
    const name = String(toolCall?.function?.name ?? '').trim();
    if (!name) return;
    const id = String(toolCall?.id ?? '').trim() || `tool_${messageIndex + 1}_${toolCallIndex + 1}`;
    const args = parseToolInput(toolCall?.function?.arguments);
    blocks.push({
      type: 'tool_use',
      id,
      name,
      input: args,
    });
  });

  if (blocks.length === 0) return null;
  if (blocks.length === 1 && blocks[0].type === 'text') {
    return { role: 'assistant', content: blocks[0].text };
  }
  return { role: 'assistant', content: blocks };
}

function toToolResultMessage(message: AiMessage): ClaudeMessage | null {
  const toolUseId = String(message.tool_call_id ?? '').trim();
  if (!toolUseId) {
    const fallbackText = extractMessageText(message).trim();
    if (!fallbackText) return null;
    return { role: 'user', content: fallbackText };
  }

  const content = toToolResultContent(message.content);
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content,
      },
    ],
  };
}

function toToolResultContent(content: AiMessage['content']): string | ClaudeTextBlock[] {
  if (typeof content === 'string') {
    return content.trim() || '{}';
  }
  if (!Array.isArray(content)) return '{}';

  const textBlocks: ClaudeTextBlock[] = [];
  content.forEach((part) => {
    if (!part || typeof part !== 'object') return;
    const item = part as AiContentPart;
    if (item.type !== 'text') return;
    const text = String(item.text ?? '').trim();
    if (!text) return;
    textBlocks.push({ type: 'text', text });
  });

  if (textBlocks.length === 0) return '{}';
  if (textBlocks.length === 1) return textBlocks[0].text;
  return textBlocks;
}

function toClaudeContent(content: AiMessage['content']): string | ClaudeContentBlock[] | null {
  if (typeof content === 'string') {
    const text = content.trim();
    return text || null;
  }
  if (!Array.isArray(content)) return null;

  const blocks: ClaudeContentBlock[] = [];
  content.forEach((part) => {
    if (!part || typeof part !== 'object') return;
    const item = part as AiContentPart;
    if (item.type === 'text') {
      const text = String(item.text ?? '').trim();
      if (text) blocks.push({ type: 'text', text });
      return;
    }
    if (item.type === 'image_url') {
      const url = String(item.image_url?.url ?? '').trim();
      if (!url) return;
      blocks.push({
        type: 'image_url',
        image_url: {
          url,
          detail: item.image_url?.detail,
        },
      });
    }
  });

  if (blocks.length === 0) return null;
  if (blocks.every((block) => block.type === 'text')) {
    return blocks.map((block) => (block as ClaudeTextBlock).text).join('\n');
  }
  return blocks;
}

function parseToolInput(raw: unknown): unknown {
  const text = String(raw ?? '').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw_arguments: text };
  }
}

function extractMessageText(message: AiMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .map((part) => {
      if (!part || part.type !== 'text') return '';
      return typeof part.text === 'string' ? part.text : '';
    })
    .filter(Boolean)
    .join('\n');
}
