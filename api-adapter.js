/**
 * API Adapter
 *
 * Keeps the stock Claude extension flow intact while translating its
 * Anthropic Messages traffic to an OpenAI-compatible chat completions API.
 * Darkbrowser routes every request to the Dark LLM gateway, and refuses to run
 * until the user has signed in (see the sign-in gate in proxyAnthropicMessages).
 */

(function() {
  'use strict';

  const SYSTEM_PROMPT = 'You are Darkbrowser, an AI browser agent running inside a Chrome extension. You can see and interact with web pages through browser automation tools.\n\nYour capabilities:\n- Take screenshots of the current page\n- Click, type, scroll, and navigate web pages\n- Read page content and extract information\n- Execute JavaScript on pages\n- Open new tabs and switch between them\n- Help users with tasks that involve web browsing\n\nGuidelines:\n- Be helpful, harmless, and honest\n- When asked to interact with a page, take a screenshot first to understand the current state\n- Describe what you see and what you plan to do before taking actions\n- If a task requires multiple steps, explain your approach\n- Be careful with sensitive information - never enter passwords or personal data unless the user explicitly provides them\n- Respect website terms of service and robots.txt\n- If you encounter an error, explain what happened and suggest alternatives\n- Use {{currentDateTime}} as the current date/time reference\n- The current model is {{modelName}}';

  const SKIP_PERMS_PROMPT = SYSTEM_PROMPT + '\n\nYou have been granted permission to act without asking for confirmation on each action. Proceed efficiently with the task.';

  const DEFAULT_PROVIDER_CONFIG = {
    provider: 'darkllm',
    darkllm: {
      baseUrl: 'https://dark-llm.cropbinary.com/v1',
      apiKey: '',
      model: 'president'
    }
  };

  // Placeholder values written by the registry / auth-bypass so the stock Claude extension
  // does not show its own login. None of these is a usable Dark LLM key, so the sign-in gate
  // treats them as "signed out".
  const PLACEHOLDER_KEYS = new Set([
    'darkbrowser-signed-out',
    'browserking-key',
    'custom-provider-key',
    'browserking-access-token',
    'custom-provider-access-token'
  ]);

  function isSignedIn(provider) {
    const key = String(provider?.apiKey || '').trim();
    return Boolean(key) && !PLACEHOLDER_KEYS.has(key);
  }

  const MOCK_ORG = {
    uuid: 'custom-provider-org-00000000',
    name: 'Custom Provider',
    billing_type: 'free',
    organization_type: 'personal',
    settings: {}
  };

  const MOCK_ACCOUNT = {
    uuid: 'custom-provider-user-00000000',
    email: 'user@custom-provider.local',
    name: 'Custom Provider User',
    display_name: 'Custom Provider User',
    has_claude_pro: true,
    has_claude_max: false,
    created_at: new Date().toISOString(),
    memberships: [{ organization: MOCK_ORG, role: 'admin' }]
  };

  const MOCK_PROFILE = {
    account: MOCK_ACCOUNT,
    account_uuid: MOCK_ACCOUNT.uuid,
    organization: MOCK_ORG
  };

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const originalFetch = globalThis.fetch.bind(globalThis);
  const registry = globalThis.BrowserKingRegistry || null;

  async function writeDebugLog(entry) {
    try {
      if (!globalThis.chrome?.storage?.local) {
        return;
      }

      const existing = await chrome.storage.local.get('apiAdapterDebugLog');
      const current = Array.isArray(existing?.apiAdapterDebugLog)
        ? existing.apiAdapterDebugLog
        : [];

      current.push({
        timestamp: new Date().toISOString(),
        ...entry
      });

      while (current.length > 20) {
        current.shift();
      }

      await chrome.storage.local.set({
        apiAdapterDebugLog: current
      });
    } catch (error) {
      console.warn('[API Adapter] Failed to write debug log:', error);
    }
  }

  function randomId(prefix) {
    const suffix = Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now().toString(36)}${suffix}`;
  }

  function jsonResponse(data, status, extraHeaders) {
    return new Response(JSON.stringify(data), {
      status: status || 200,
      headers: {
        'Content-Type': 'application/json',
        ...(extraHeaders || {})
      }
    });
  }

  function createAnthropicError(message, status) {
    return jsonResponse({
      type: 'error',
      error: {
        type: 'api_error',
        message
      }
    }, status || 500);
  }

  function mergeHeaders(input, init) {
    const merged = new Headers();

    const apply = (value) => {
      if (!value) {
        return;
      }

      if (value instanceof Headers) {
        value.forEach((headerValue, key) => merged.set(key, headerValue));
        return;
      }

      if (Array.isArray(value)) {
        value.forEach(([key, headerValue]) => merged.set(key, headerValue));
        return;
      }

      Object.entries(value).forEach(([key, headerValue]) => {
        if (headerValue !== undefined) {
          merged.set(key, headerValue);
        }
      });
    };

    if (input instanceof Request) {
      apply(input.headers);
    }

    apply(init?.headers);
    return merged;
  }

  async function readJsonBody(input, init) {
    const rawBody = init?.body;

    if (typeof rawBody === 'string') {
      return JSON.parse(rawBody);
    }

    if (rawBody instanceof URLSearchParams) {
      return JSON.parse(rawBody.toString());
    }

    if (input instanceof Request) {
      const text = await input.clone().text();
      return text ? JSON.parse(text) : {};
    }

    return {};
  }

  async function getProviderConfig() {
    try {
      if (registry?.loadState) {
        return registry.loadState();
      }

      if (!globalThis.chrome?.storage?.local) {
        return DEFAULT_PROVIDER_CONFIG;
      }

      const result = await chrome.storage.local.get('providerConfig');
      const config = result?.providerConfig;
      if (!config) {
        return DEFAULT_PROVIDER_CONFIG;
      }

      return {
        ...DEFAULT_PROVIDER_CONFIG,
        ...config,
        darkllm: {
          ...DEFAULT_PROVIDER_CONFIG.darkllm,
          ...(config.darkllm || {})
        }
      };
    } catch (error) {
      console.warn('[API Adapter] Falling back to default provider config:', error);
      return DEFAULT_PROVIDER_CONFIG;
    }
  }

  function getActiveProvider(config) {
    if (config?.providers && registry?.getActiveProviderDefinition) {
      const definition = registry.getActiveProviderDefinition(config);
      const state = registry.getActiveProviderState(config);
      return {
        id: definition.id,
        label: definition.label,
        transport: definition.transport,
        baseUrl: state.baseUrl,
        apiKey: state.apiKey,
        model: state.model,
        supportsVision: registry.modelSupportsVision(config, definition.id, state.model)
      };
    }

    const providerName = config.provider || 'darkllm';
    return config[providerName] || config.darkllm || DEFAULT_PROVIDER_CONFIG.darkllm;
  }

  function ensureArray(value) {
    if (value == null) {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  }

  function stringifyContent(value) {
    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map(stringifyContent).filter(Boolean).join('\n');
    }

    if (value && typeof value === 'object') {
      if (typeof value.text === 'string') {
        return value.text;
      }

      try {
        return JSON.stringify(value);
      } catch (error) {
        return String(value);
      }
    }

    return value == null ? '' : String(value);
  }

  function normaliseAnthropicImage(block) {
    if (!block?.source) {
      return null;
    }

    if (block.source.type === 'base64' && block.source.data) {
      const mediaType = block.source.media_type || 'image/png';
      return {
        type: 'image_url',
        image_url: {
          url: `data:${mediaType};base64,${block.source.data}`
        }
      };
    }

    if ((block.source.type === 'url' || block.source.type === 'image_url') && block.source.url) {
      return {
        type: 'image_url',
        image_url: {
          url: block.source.url
        }
      };
    }

    return null;
  }

  function buildOpenAIContent(blocks) {
    const parts = [];

    ensureArray(blocks).forEach((block) => {
      if (typeof block === 'string') {
        if (block) {
          parts.push({ type: 'text', text: block });
        }
        return;
      }

      if (!block || typeof block !== 'object') {
        return;
      }

      if (block.type === 'text' && block.text) {
        parts.push({ type: 'text', text: block.text });
        return;
      }

      if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        return; // extended thinking blocks not supported by non-Anthropic providers
      }

      if (block.type === 'image') {
        const imagePart = normaliseAnthropicImage(block);
        if (imagePart) {
          parts.push(imagePart);
        }
      }
    });

    if (parts.length === 0) {
      return '';
    }

    if (parts.length === 1 && parts[0].type === 'text') {
      return parts[0].text;
    }

    return parts;
  }

  function buildOpenAIToolCall(block) {
    let args = '{}';

    if (block.input !== undefined) {
      args = typeof block.input === 'string' ? block.input : JSON.stringify(block.input);
    }

    return {
      id: block.id || randomId('call'),
      type: 'function',
      function: {
        name: block.name,
        arguments: args
      }
    };
  }

  function buildToolResultMessages(block) {
    const toolCallId = block.tool_use_id || block.id || randomId('tool');
    const contentBlocks = ensureArray(block.content);
    const textSegments = [];
    const imageParts = [];

    contentBlocks.forEach((contentBlock) => {
      if (typeof contentBlock === 'string') {
        if (contentBlock) {
          textSegments.push(contentBlock);
        }
        return;
      }

      if (!contentBlock || typeof contentBlock !== 'object') {
        return;
      }

      if (contentBlock.type === 'text' && contentBlock.text) {
        textSegments.push(contentBlock.text);
        return;
      }

      if (contentBlock.type === 'image') {
        const imagePart = normaliseAnthropicImage(contentBlock);
        if (imagePart) {
          imageParts.push(imagePart);
        }
      }
    });

    const toolMessages = [{
      role: 'tool',
      tool_call_id: toolCallId,
      content: textSegments.join('\n') || (imageParts.length > 0 ? '[tool returned image output]' : '')
    }];

    if (imageParts.length > 0) {
      toolMessages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: textSegments.length > 0
              ? `Here is the visual result from tool call ${toolCallId}:\n${textSegments.join('\n')}`
              : `Here is the visual result from tool call ${toolCallId}.`
          },
          ...imageParts
        ]
      });
    }

    return toolMessages;
  }

  function convertAnthropicMessagesToOpenAI(body) {
    const openAIMessages = [];

    const systemBlocks = ensureArray(body.system).flatMap((item) => {
      if (typeof item === 'string') {
        return [{ type: 'text', text: item }];
      }

      if (item && typeof item === 'object') {
        return [item];
      }

      return [];
    });

    if (systemBlocks.length > 0) {
      openAIMessages.push({
        role: 'system',
        content: buildOpenAIContent(systemBlocks)
      });
    }

    ensureArray(body.messages).forEach((message) => {
      const role = message.role || 'user';
      const blocks = ensureArray(message.content);
      const nonToolBlocks = [];
      const toolCalls = [];
      const toolResults = [];

      blocks.forEach((block) => {
        if (block?.type === 'tool_use') {
          toolCalls.push(buildOpenAIToolCall(block));
          return;
        }

        if (block?.type === 'tool_result') {
          toolResults.push(...buildToolResultMessages(block));
          return;
        }

        // Skip extended thinking blocks — not supported by non-Anthropic providers
        if (block?.type === 'thinking' || block?.type === 'redacted_thinking') {
          return;
        }

        nonToolBlocks.push(block);
      });

      if (role === 'assistant') {
        if (nonToolBlocks.length > 0 || toolCalls.length > 0) {
          const content = buildOpenAIContent(nonToolBlocks);
          openAIMessages.push({
            role: 'assistant',
            content: content === '' ? null : content,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
          });
        }
      } else {
        if (nonToolBlocks.length > 0) {
          openAIMessages.push({
            role,
            content: buildOpenAIContent(nonToolBlocks)
          });
        }

        toolResults.forEach((toolMessage) => openAIMessages.push(toolMessage));
      }
    });

    return openAIMessages;
  }

  function getLatestUserText(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role !== 'user') {
        continue;
      }

      return stringifyContent(message.content).toLowerCase();
    }

    return '';
  }

  function shouldForceBrowserToolUse(messages, tools) {
    if (!Array.isArray(tools) || tools.length === 0) {
      return false;
    }

    const latestUserText = getLatestUserText(messages);
    if (!latestUserText) {
      return false;
    }

    const visualPatterns = [
      'what do you see',
      'what do the thumbnails look like',
      'tell me what the thumbnails look like',
      'what does this page look like',
      'what is on the screen',
      'what can you see',
      'describe the page',
      'describe what you see',
      'look at the page',
      'look at the screen',
      'screenshot',
      'thumbnail',
      'image',
      'picture'
    ];
    if (visualPatterns.some((pattern) => latestUserText.includes(pattern))) {
      return true;
    }

    // Browser-ACTION intents. The local model sometimes emits a tool call as prose/text (e.g. a
    // `<tool_code>` block) instead of actually calling the browser tool, so nothing happens. Forcing
    // tool_choice on a clear action makes it act. Almost every darkbrowser turn is an action anyway.
    const ACTION_RE = /\b(?:click|tap|press|type|enter|fill|input|scroll|navigate|go ?to|open|visit|browse|reload|refresh|go back|go forward|switch tab|new tab|close tab|select|choose|search(?: for)?|look for|find|log ?in|sign ?in|sign ?up|submit|check ?out|add to cart|buy|purchase|download|upload|hover|drag|play|pause)\b/;
    if (ACTION_RE.test(latestUserText)) {
      return true;
    }

    // A URL / "go to this site" is a navigate.
    return /https?:\/\//.test(latestUserText);
  }

  function convertAnthropicToolsToOpenAI(tools) {
    return ensureArray(tools).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.input_schema || { type: 'object', properties: {} }
      }
    }));
  }

  function convertAnthropicToolChoice(toolChoice) {
    if (!toolChoice) {
      return undefined;
    }

    if (toolChoice.type === 'auto') {
      return 'auto';
    }

    if (toolChoice.type === 'any') {
      return 'required';
    }

    if (toolChoice.type === 'none') {
      return 'none';
    }

    if (toolChoice.type === 'tool' && toolChoice.name) {
      return {
        type: 'function',
        function: {
          name: toolChoice.name
        }
      };
    }

    return undefined;
  }

  function resolveTargetModel(body, provider) {
    if (body.model && !String(body.model).startsWith('claude-')) {
      return body.model;
    }

    return provider.model || DEFAULT_PROVIDER_CONFIG.darkllm.model;
  }

  function downgradeVisionMessages(messages, modelName) {
    return messages.map((message) => {
      if (!Array.isArray(message.content)) {
        return message;
      }

      let omittedImages = 0;
      const nextContent = message.content.filter((part) => {
        const keep = part?.type !== 'image_url';
        if (!keep) {
          omittedImages += 1;
        }
        return keep;
      });

      if (omittedImages === 0) {
        return message;
      }

      nextContent.unshift({
        type: 'text',
        text: `[Darkbrowser note] ${omittedImages} image attachment(s) were omitted because ${modelName} is configured as a text-only model.`
      });

      return {
        ...message,
        content: nextContent
      };
    });
  }

  function requestContainsImages(openAIRequest) {
    return ensureArray(openAIRequest?.messages).some((message) => (
      Array.isArray(message?.content)
      && message.content.some((part) => part?.type === 'image_url')
    ));
  }

  function buildTextOnlyFallbackRequest(openAIRequest, modelName) {
    return {
      ...openAIRequest,
      messages: downgradeVisionMessages(openAIRequest.messages || [], modelName)
    };
  }

  function checkVisionForModel(providerConfig, provider, modelId) {
    if (registry?.modelSupportsVision && providerConfig?.providers) {
      return registry.modelSupportsVision(providerConfig, provider.id, modelId);
    }
    return provider.supportsVision !== false;
  }

  function buildOpenAIRequest(body, provider, providerConfig, overrideModel) {
    // Prefer the caller's already-resolved model (which has the effort tier applied). Falling back to
    // resolveTargetModel here would send the bare lane id (e.g. "thor"), which the gateway rejects.
    const targetModel = overrideModel || resolveTargetModel(body, provider);
    let messages = convertAnthropicMessagesToOpenAI(body);

    if (!messages.some((message) => message.role === 'system')) {
      messages.unshift({
        role: 'system',
        content: SYSTEM_PROMPT
      });
    }

    // Fill the {{currentDateTime}}/{{modelName}} placeholders with real values and append an <env>
    // block (local time / timezone / language). Without this the model saw a literal "{{currentDateTime}}"
    // and couldn't answer "what time is it". The <env> block also survives the gateway's chat-turn gate,
    // which swaps the system prompt but preserves <env>...</env>.
    {
      const sys = messages.find((m) => m.role === 'system');
      if (sys && typeof sys.content === 'string') {
        const now = new Date();
        const opts = Intl.DateTimeFormat().resolvedOptions();
        const tz = opts.timeZone || 'UTC';
        const locale = opts.locale || 'en-US';
        const localTime = now.toLocaleString(locale, {
          timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
        });
        sys.content = sys.content
          .replace(/\{\{currentDateTime\}\}/g, localTime)
          .replace(/\{\{modelName\}\}/g, targetModel || 'the model');
        if (!sys.content.includes('<env>')) {
          sys.content += `\n\n<env>\n  Local time: ${localTime} (${tz})\n  Timezone: ${tz}\n  Language: ${locale}\n</env>`;
        }
      }
    }

    const visionSupported = checkVisionForModel(providerConfig, provider, targetModel);
    if (!visionSupported) {
      messages = downgradeVisionMessages(messages, targetModel);
    }

    // OpenAI o-series models use max_completion_tokens instead of max_tokens
    const isOSeries = /^o\d/.test(targetModel);
    const maxTokensKey = isOSeries ? 'max_completion_tokens' : 'max_tokens';

    // Reasoning headroom: max_tokens bounds reasoning + answer combined. The gateway's
    // model reasons an unpredictable amount (0 tokens on some prompts, ~10K on others),
    // so a small upstream max_tokens gets fully consumed by the think and the answer is
    // truncated (finish_reason=length). Floor to the gateway's output ceiling (32000) so
    // the answer always survives. This is a cap, not a target: the model still stops when
    // done, so the floor only prevents truncation, it never lengthens replies. LiteLLM
    // caps at 32768, so a larger upstream value is harmless.
    const maxTokens = Math.max(Number(body.max_tokens) || 0, 32000);

    const openAIRequest = {
      model: targetModel,
      messages,
      [maxTokensKey]: maxTokens,
      stream: Boolean(body.stream)
    };

    const providerId = provider.id || '';

    // Google Gemini and Perplexity don't support top_p reliably
    const skipTopP = providerId === 'google' || providerId === 'perplexity';

    if (body.temperature !== undefined) {
      openAIRequest.temperature = body.temperature;
    }

    if (body.top_p !== undefined && !skipTopP) {
      openAIRequest.top_p = body.top_p;
    }

    if (Array.isArray(body.stop_sequences) && body.stop_sequences.length > 0) {
      openAIRequest.stop = body.stop_sequences;
    }

    // Providers that don't support function/tool calling
    const noToolsProviders = ['perplexity'];
    const supportsTools = !noToolsProviders.includes(providerId);

    // Providers where tool_choice:'required' is not supported — fall back to 'auto'
    const noRequiredToolChoice = ['google', 'perplexity', 'cerebras'];

    if (Array.isArray(body.tools) && body.tools.length > 0 && supportsTools) {
      openAIRequest.tools = convertAnthropicToolsToOpenAI(body.tools);
      let toolChoice = convertAnthropicToolChoice(body.tool_choice);

      if (toolChoice !== undefined) {
        if (toolChoice === 'required' && noRequiredToolChoice.includes(providerId)) {
          toolChoice = 'auto';
        }
        openAIRequest.tool_choice = toolChoice;
      }

      if (
        openAIRequest.tool_choice === undefined &&
        shouldForceBrowserToolUse(body.messages, body.tools)
      ) {
        openAIRequest.tool_choice = noRequiredToolChoice.includes(providerId) ? 'auto' : 'required';
      }
    }

    return openAIRequest;
  }

  function parseToolArguments(value) {
    if (!value) {
      return {};
    }

    if (typeof value === 'object') {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch (error) {
      return { raw: value };
    }
  }

  function mapFinishReason(reason) {
    switch (reason) {
      case 'tool_calls':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      case 'stop':
      case 'content_filter':
      default:
        return 'end_turn';
    }
  }

  function convertOpenAIMessageToAnthropic(data, requestedModel) {
    const choice = data?.choices?.[0];
    const message = choice?.message || {};
    const content = [];

    if (typeof message.content === 'string' && message.content) {
      content.push({
        type: 'text',
        text: message.content
      });
    } else if (Array.isArray(message.content)) {
      message.content.forEach((part) => {
        if (part?.type === 'text' && part.text) {
          content.push({
            type: 'text',
            text: part.text
          });
        }
      });
    }

    ensureArray(message.tool_calls).forEach((toolCall) => {
      content.push({
        type: 'tool_use',
        id: toolCall.id || randomId('toolu'),
        name: toolCall.function?.name || 'tool',
        input: parseToolArguments(toolCall.function?.arguments)
      });
    });

    return {
      id: data.id || randomId('msg'),
      type: 'message',
      role: 'assistant',
      model: data.model || requestedModel,
      content,
      stop_reason: mapFinishReason(choice?.finish_reason),
      stop_sequence: null,
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0
      }
    };
  }

  function sseChunk(event, payload) {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  function parseSSEEvent(rawChunk) {
    const lines = rawChunk.split(/\r?\n/);
    let eventName = 'message';
    const dataLines = [];

    lines.forEach((line) => {
      if (!line) {
        return;
      }

      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
        return;
      }

      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    });

    return {
      event: eventName,
      data: dataLines.join('\n')
    };
  }

  function buildAnthropicSSETransform(upstreamResponse, requestedModel) {
    const messageId = randomId('msg');
    const activeToolBlocks = new Map();

    return new ReadableStream({
      async start(controller) {
        let textBlockStarted = false;
        let nextContentIndex = 0;
        let finishReason = 'end_turn';
        let finalUsage = null;
        let buffer = '';

        controller.enqueue(sseChunk('message_start', {
          type: 'message_start',
          message: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            model: requestedModel,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: 0,
              output_tokens: 0
            }
          }
        }));

        const closeBlocks = () => {
          if (textBlockStarted) {
            controller.enqueue(sseChunk('content_block_stop', {
              type: 'content_block_stop',
              index: 0
            }));
            textBlockStarted = false;
          }

          activeToolBlocks.forEach((toolState) => {
            if (toolState.started) {
              controller.enqueue(sseChunk('content_block_stop', {
                type: 'content_block_stop',
                index: toolState.anthropicIndex
              }));
              toolState.started = false;
            }
          });
        };

        const ensureTextBlock = () => {
          if (!textBlockStarted) {
            controller.enqueue(sseChunk('content_block_start', {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'text',
                text: ''
              }
            }));
            textBlockStarted = true;
            nextContentIndex = Math.max(nextContentIndex, 1);
          }
        };

        const reader = upstreamResponse.body?.getReader();
        if (!reader) {
          throw new Error('Upstream response body is not readable.');
        }

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });

            while (true) {
              const delimiterIndex = buffer.indexOf('\n\n');
              if (delimiterIndex === -1) {
                break;
              }

              const rawEvent = buffer.slice(0, delimiterIndex);
              buffer = buffer.slice(delimiterIndex + 2);

              const event = parseSSEEvent(rawEvent);
              if (!event.data) {
                continue;
              }

              if (event.data === '[DONE]') {
                closeBlocks();
                controller.enqueue(sseChunk('message_delta', {
                  type: 'message_delta',
                  delta: {
                    stop_reason: finishReason,
                    stop_sequence: null
                  },
                  usage: {
                    output_tokens: finalUsage?.completion_tokens || 0
                  }
                }));
                controller.enqueue(sseChunk('message_stop', {
                  type: 'message_stop'
                }));
                controller.close();
                return;
              }

              let payload;
              try {
                payload = JSON.parse(event.data);
              } catch (error) {
                console.warn('[API Adapter] Ignoring non-JSON SSE payload:', event.data);
                continue;
              }

              if (payload.error) {
                throw new Error(payload.error.message || JSON.stringify(payload.error));
              }

              if (payload.usage) {
                finalUsage = payload.usage;
              }

              const choice = payload.choices?.[0];
              if (!choice) {
                continue;
              }

              if (choice.finish_reason) {
                finishReason = mapFinishReason(choice.finish_reason);
              }

              const delta = choice.delta || {};

              if (delta.content) {
                ensureTextBlock();
                controller.enqueue(sseChunk('content_block_delta', {
                  type: 'content_block_delta',
                  index: 0,
                  delta: {
                    type: 'text_delta',
                    text: delta.content
                  }
                }));
              }

              ensureArray(delta.tool_calls).forEach((toolDelta, listIndex) => {
                const key = toolDelta.index ?? listIndex;
                let toolState = activeToolBlocks.get(key);

                if (!toolState) {
                  toolState = {
                    anthropicIndex: nextContentIndex++,
                    started: false,
                    id: toolDelta.id || randomId('toolu'),
                    name: toolDelta.function?.name || null
                  };
                  activeToolBlocks.set(key, toolState);
                }

                if (toolDelta.id) {
                  toolState.id = toolDelta.id;
                }

                if (toolDelta.function?.name) {
                  toolState.name = toolDelta.function.name;
                }

                if (!toolState.started && toolState.name) {
                  controller.enqueue(sseChunk('content_block_start', {
                    type: 'content_block_start',
                    index: toolState.anthropicIndex,
                    content_block: {
                      type: 'tool_use',
                      id: toolState.id,
                      name: toolState.name,
                      input: {}
                    }
                  }));
                  toolState.started = true;
                }

                if (toolState.started && toolDelta.function?.arguments) {
                  controller.enqueue(sseChunk('content_block_delta', {
                    type: 'content_block_delta',
                    index: toolState.anthropicIndex,
                    delta: {
                      type: 'input_json_delta',
                      partial_json: toolDelta.function.arguments
                    }
                  }));
                }
              });
            }
          }

          closeBlocks();
          controller.enqueue(sseChunk('message_delta', {
            type: 'message_delta',
            delta: {
              stop_reason: finishReason,
              stop_sequence: null
            },
            usage: {
              output_tokens: finalUsage?.completion_tokens || 0
            }
          }));
          controller.enqueue(sseChunk('message_stop', {
            type: 'message_stop'
          }));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      }
    });
  }

  function buildSSEHeaders() {
    return {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    };
  }

  // Pull the plain text of the most recent user turn (content is a string or an array of blocks).
  function extractLastUserText(request) {
    const messages = Array.isArray(request?.messages) ? request.messages : [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (!message || message.role !== 'user') {
        continue;
      }
      const content = message.content;
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        return content
          .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join(' ');
      }
      return '';
    }
    return '';
  }

  // Effort axis (like the darkcode CLI): the model picker chooses the lane; /effort chooses the tier.
  // The real gateway model is lane + tier, e.g. "president" + "high" -> "president-high".
  const EFFORTS = ['low', 'med', 'high', 'ultra'];
  const LANES = ['president'];
  const DEFAULT_EFFORT = 'high';

  function capitalize(value) {
    const s = String(value || '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function normalizeEffort(arg) {
    const a = String(arg || '').toLowerCase();
    if (a === 'medium') return 'med';
    if (a === 'max') return 'ultra';
    return EFFORTS.includes(a) ? a : null;
  }

  async function getEffort() {
    try {
      if (!globalThis.chrome?.storage?.local) return DEFAULT_EFFORT;
      const result = await chrome.storage.local.get('darkbrowserEffort');
      const value = result?.darkbrowserEffort;
      return EFFORTS.includes(value) ? value : DEFAULT_EFFORT;
    } catch {
      return DEFAULT_EFFORT;
    }
  }

  async function setEffort(tier) {
    try {
      if (globalThis.chrome?.storage?.local) {
        await chrome.storage.local.set({ darkbrowserEffort: tier });
      }
    } catch (error) {
      console.warn('[API Adapter] Failed to persist effort:', error);
    }
  }

  // Turn a bare lane id (thor / thor-1m / loki) into the effort-suffixed gateway id. Already-suffixed
  // ids (e.g. a legacy "thor-high") pass through unchanged.
  function applyEffort(modelId, effort) {
    const id = String(modelId || '').trim();
    for (const lane of LANES) {
      if (EFFORTS.some((tier) => id === `${lane}-${tier}`)) {
        return id;
      }
    }
    for (const lane of LANES) {
      if (id === lane) {
        return `${lane}-${effort}`;
      }
    }
    return id;
  }

  // Slash commands handled locally (never sent to the model). Mirrors the darkcode CLI.
  function parseSlashCommand(request) {
    const raw = extractLastUserText(request).trim();
    if (!raw.startsWith('/')) {
      return null;
    }
    const parts = raw.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts[1] || '';
    if (cmd === '/logout' || cmd === '/signout') {
      return { cmd: 'logout' };
    }
    if (cmd === '/effort') {
      return { cmd: 'effort', arg };
    }
    return null;
  }

  async function clearSignIn() {
    if (registry?.updateState) {
      await registry.updateState((draft) => {
        if (draft.providers?.darkllm) {
          draft.providers.darkllm.apiKey = '';
        }
      });
    }
    try {
      if (globalThis.chrome?.storage?.local) {
        await chrome.storage.local.remove('darkbrowserUsername');
      }
    } catch (error) {
      console.warn('[API Adapter] Failed to clear username:', error);
    }
  }

  // The signed-in Dark LLM username, captured at sign-in from the gateway's /key/info (key_alias).
  async function getUsername() {
    try {
      if (!globalThis.chrome?.storage?.local) return null;
      const result = await chrome.storage.local.get('darkbrowserUsername');
      return result?.darkbrowserUsername || null;
    } catch {
      return null;
    }
  }

  // Look up the username from the gateway (key_alias) using the active key, and cache it. Runs
  // lazily so users who signed in before this feature existed still get their name without
  // re-signing-in. /key/info lives at the gateway ROOT, not under /v1.
  async function lookupUsername() {
    try {
      const provider = getActiveProvider(await getProviderConfig());
      if (!isSignedIn(provider)) {
        return null;
      }
      const base = String(provider.baseUrl || DEFAULT_PROVIDER_CONFIG.darkllm.baseUrl).replace(/\/v1\/?$/, '');
      const res = await fetch(`${base}/key/info`, { headers: { Authorization: `Bearer ${provider.apiKey}` } });
      if (!res.ok) {
        return null;
      }
      const data = await res.json();
      const name = data?.info?.key_alias || data?.info?.user_id || '';
      if (name && globalThis.chrome?.storage?.local) {
        await chrome.storage.local.set({ darkbrowserUsername: name });
      }
      return name || null;
    } catch {
      return null;
    }
  }

  // Build the (mock) account profile the stock extension shows, using the real signed-in username
  // instead of the placeholder custom-provider identity.
  async function buildProfile() {
    const username = (await getUsername()) || (await lookupUsername());
    if (!username) {
      return MOCK_PROFILE;
    }
    const account = { ...MOCK_ACCOUNT, email: username, name: username, display_name: username };
    return { account, account_uuid: account.uuid, organization: MOCK_ORG };
  }

  // Emit a single assistant text turn as if the model had replied - streamed (Anthropic SSE) when
  // the caller asked for a stream, otherwise a plain message object. Used for local slash commands.
  function buildAssistantMessageResponse(text, model, stream) {
    const messageId = randomId('msg');
    if (!stream) {
      return jsonResponse({
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      });
    }

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(sseChunk('message_start', {
          type: 'message_start',
          message: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 }
          }
        }));
        controller.enqueue(sseChunk('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' }
        }));
        controller.enqueue(sseChunk('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text }
        }));
        controller.enqueue(sseChunk('content_block_stop', { type: 'content_block_stop', index: 0 }));
        controller.enqueue(sseChunk('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 0 }
        }));
        controller.enqueue(sseChunk('message_stop', { type: 'message_stop' }));
        controller.close();
      }
    });

    return new Response(body, { status: 200, headers: buildSSEHeaders() });
  }

  async function proxyAnthropicMessages(input, init) {
    const headers = mergeHeaders(input, init);
    const anthropicRequest = await readJsonBody(input, init);
    const providerConfig = await getProviderConfig();
    const provider = getActiveProvider(providerConfig);

    // Local slash commands, handled before the gate so they work independently of the model call.
    const command = parseSlashCommand(anthropicRequest);
    const wantsStream = Boolean(anthropicRequest.stream);
    if (command?.cmd === 'logout') {
      await clearSignIn();
      await writeDebugLog({ phase: 'slash_logout' });
      return buildAssistantMessageResponse(
        'Signed out of Darkbrowser. The sign-in screen will appear - sign in again to continue.',
        provider.model || 'darkllm',
        wantsStream
      );
    }
    if (command?.cmd === 'effort') {
      const tier = normalizeEffort(command.arg);
      const lane = provider.model || 'president';
      // No explicit tier (this is what the / menu sends): open the effort picker dialog. A flag in
      // storage triggers effort-dialog.js, which is running on the side panel.
      if (!tier) {
        const current = await getEffort();
        try {
          if (globalThis.chrome?.storage?.local) {
            await chrome.storage.local.set({ darkbrowserEffortPrompt: Date.now() });
          }
        } catch (error) {
          console.warn('[API Adapter] Failed to open effort dialog:', error);
        }
        return buildAssistantMessageResponse(
          `Pick an effort tier in the popup. Current: ${capitalize(current)}.`,
          provider.model || 'darkllm',
          wantsStream
        );
      }
      await setEffort(tier);
      await writeDebugLog({ phase: 'slash_effort', tier });
      return buildAssistantMessageResponse(
        `Effort set to ${capitalize(tier)}. New messages use the ${lane} lane at ${capitalize(tier)} effort.`,
        provider.model || 'darkllm',
        wantsStream
      );
    }

    // Hard login gate (mirrors the darkcode CLI): Darkbrowser will not talk to the gateway
    // until the user has signed in and a real Dark LLM key is stored. There is no guest access.
    if (!isSignedIn(provider)) {
      await writeDebugLog({ phase: 'signed_out_blocked', providerId: provider.id });
      return createAnthropicError(
        'You are not signed in to Darkbrowser. Open the extension options, go to the Dark LLM ' +
        'card, click "Open sign-in page", sign in with your Dark LLM account, then paste your ' +
        'access token back to finish signing in.',
        401
      );
    }

    // Combine the picked lane with the current effort tier into the real gateway model id.
    const requestedModel = applyEffort(resolveTargetModel(anthropicRequest, provider), await getEffort());

    headers.set('Content-Type', 'application/json');
    headers.delete('x-api-key');
    headers.delete('anthropic-version');
    headers.delete('anthropic-dangerous-direct-browser-access');
    headers.delete('Authorization');
    headers.delete('authorization');

    if (provider.apiKey) {
      headers.set('Authorization', `Bearer ${provider.apiKey}`);
      // x-api-key is Anthropic-specific; sending it to OpenAI-compat providers causes 400 errors
    }

    if (provider.transport === 'anthropic') {
      const upstreamUrl = `${String(provider.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '')}/messages`;
      headers.delete('Authorization');
      headers.set('x-api-key', provider.apiKey || '');
      headers.set('anthropic-version', headers.get('anthropic-version') || '2023-06-01');

      const upstreamPayload = {
        ...anthropicRequest,
        model: requestedModel
      };

      await writeDebugLog({
        phase: 'anthropic_passthrough_request',
        requestedModel,
        upstreamUrl,
        anthropicRequest: upstreamPayload
      });

      const response = await originalFetch(upstreamUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(upstreamPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        await writeDebugLog({
          phase: 'anthropic_passthrough_error',
          status: response.status,
          body: errorText
        });
        return createAnthropicError(`Provider error (${response.status}): ${errorText}`, response.status);
      }

      return response;
    }

    // Google Gemini OpenAI-compat endpoint uses ?key= param; remove Bearer header to avoid conflicts
    let rawUpstreamUrl = `${String(provider.baseUrl || DEFAULT_PROVIDER_CONFIG.darkllm.baseUrl).replace(/\/+$/, '')}/chat/completions`;
    if (provider.id === 'google' && provider.apiKey) {
      rawUpstreamUrl = `${rawUpstreamUrl}?key=${encodeURIComponent(provider.apiKey)}`;
      headers.delete('Authorization');
      headers.delete('authorization');
    }
    const upstreamUrl = rawUpstreamUrl;
    const openAIRequest = buildOpenAIRequest(anthropicRequest, provider, providerConfig, requestedModel);

    console.log('[API Adapter] Proxying Anthropic messages -> OpenAI chat completions:', {
      upstreamUrl,
      requestedModel,
      stream: openAIRequest.stream,
      messageCount: openAIRequest.messages.length,
      toolCount: openAIRequest.tools?.length || 0
    });

    await writeDebugLog({
      phase: 'request',
      requestedModel,
      anthropicRequest: {
        model: anthropicRequest.model,
        stream: anthropicRequest.stream,
        toolCount: anthropicRequest.tools?.length || 0,
        toolChoice: anthropicRequest.tool_choice || null,
        messages: anthropicRequest.messages || []
      },
      openAIRequest
    });

    let upstreamResponse;

    try {
      upstreamResponse = await originalFetch(upstreamUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(openAIRequest)
      });
    } catch (error) {
      console.error('[API Adapter] Upstream fetch failed:', error);
      return createAnthropicError(error.message || 'Failed to reach upstream provider.', 502);
    }

    const contentType = upstreamResponse.headers.get('content-type') || '';

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      const shouldRetryWithoutImages = (
        upstreamResponse.status === 400
        && requestContainsImages(openAIRequest)
        && /invalid.*(api|parameter)|invalid_parameter|unsupported.*(image|content|media)|image_url|does not support (image|vision|multimodal)|image|content_type/i.test(errorText)
      );

      if (shouldRetryWithoutImages) {
        const fallbackRequest = buildTextOnlyFallbackRequest(openAIRequest, requestedModel);
        await writeDebugLog({
          phase: 'retry_without_images',
          status: upstreamResponse.status,
          body: errorText,
          fallbackRequest
        });

        try {
          upstreamResponse = await originalFetch(upstreamUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(fallbackRequest)
          });

          if (upstreamResponse.ok) {
            await writeDebugLog({
              phase: 'retry_without_images_success',
              status: upstreamResponse.status
            });
          } else {
            const retryErrorText = await upstreamResponse.text();
            await writeDebugLog({
              phase: 'retry_without_images_error',
              status: upstreamResponse.status,
              body: retryErrorText
            });
            console.error('[API Adapter] Upstream error after retry:', upstreamResponse.status, retryErrorText);
            return createAnthropicError(`Provider error (${upstreamResponse.status}): ${retryErrorText}`, upstreamResponse.status);
          }
        } catch (retryError) {
          console.error('[API Adapter] Retry without images failed:', retryError);
          return createAnthropicError(retryError.message || 'Failed to reach upstream provider after retry.', 502);
        }
      } else {
        console.error('[API Adapter] Upstream error:', upstreamResponse.status, errorText);
        await writeDebugLog({
          phase: 'upstream_error',
          status: upstreamResponse.status,
          body: errorText
        });
        return createAnthropicError(`Provider error (${upstreamResponse.status}): ${errorText}`, upstreamResponse.status);
      }
    }

    if (openAIRequest.stream && contentType.includes('text/event-stream')) {
      await writeDebugLog({
        phase: 'stream_response',
        contentType,
        status: upstreamResponse.status
      });
      return new Response(buildAnthropicSSETransform(upstreamResponse, requestedModel), {
        status: 200,
        headers: buildSSEHeaders()
      });
    }

    const data = await upstreamResponse.json();
    await writeDebugLog({
      phase: 'response',
      status: upstreamResponse.status,
      contentType,
      data
    });

    if (openAIRequest.stream) {
      const anthropicMessage = convertOpenAIMessageToAnthropic(data, requestedModel);
      const fauxStream = new ReadableStream({
        start(controller) {
          controller.enqueue(sseChunk('message_start', {
            type: 'message_start',
            message: {
              ...anthropicMessage,
              content: [],
              stop_reason: null
            }
          }));

          anthropicMessage.content.forEach((block, index) => {
            if (block.type === 'text') {
              controller.enqueue(sseChunk('content_block_start', {
                type: 'content_block_start',
                index,
                content_block: {
                  type: 'text',
                  text: ''
                }
              }));
              controller.enqueue(sseChunk('content_block_delta', {
                type: 'content_block_delta',
                index,
                delta: {
                  type: 'text_delta',
                  text: block.text
                }
              }));
              controller.enqueue(sseChunk('content_block_stop', {
                type: 'content_block_stop',
                index
              }));
              return;
            }

            controller.enqueue(sseChunk('content_block_start', {
              type: 'content_block_start',
              index,
              content_block: {
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: {}
              }
            }));
            controller.enqueue(sseChunk('content_block_delta', {
              type: 'content_block_delta',
              index,
              delta: {
                type: 'input_json_delta',
                partial_json: JSON.stringify(block.input || {})
              }
            }));
            controller.enqueue(sseChunk('content_block_stop', {
              type: 'content_block_stop',
              index
            }));
          });

          controller.enqueue(sseChunk('message_delta', {
            type: 'message_delta',
            delta: {
              stop_reason: anthropicMessage.stop_reason,
              stop_sequence: null
            },
            usage: {
              output_tokens: anthropicMessage.usage.output_tokens
            }
          }));
          controller.enqueue(sseChunk('message_stop', {
            type: 'message_stop'
          }));
          controller.close();
        }
      });

      return new Response(fauxStream, {
        status: 200,
        headers: buildSSEHeaders()
      });
    }

    return jsonResponse(convertOpenAIMessageToAnthropic(data, requestedModel));
  }

  globalThis.fetch = async function(input, init) {
    const url = typeof input === 'string'
      ? input
      : input instanceof Request
        ? input.url
        : String(input);

    if (url.includes('api.anthropic.com')) {
      if (url.includes('/v1/messages') && !url.includes('/batches')) {
        return proxyAnthropicMessages(input, init);
      }

      if (url.includes('/api/oauth/profile') || url.includes('/oauth/profile')) {
        return jsonResponse(await buildProfile());
      }

      if (url.includes('oauth/token') || url.includes('oauth2/token')) {
        return jsonResponse({
          access_token: 'custom-provider-access-token',
          refresh_token: 'custom-provider-refresh-token',
          token_type: 'bearer',
          expires_in: 31536000
        });
      }

      if (url.includes('/chat_conversations')) {
        return jsonResponse([]);
      }

      if (url.includes('/v1/sessions')) {
        if (url.includes('/events')) {
          return jsonResponse({ data: [] });
        }

        return jsonResponse({ session_context: { model: null } });
      }

      if (url.includes('/api/oauth/account/settings')) {
        return jsonResponse({ locale: 'en' });
      }

      if (url.includes('/api/bootstrap/features')) {
        return jsonResponse({
          features: {
            chrome_ext_models: { value: {}, on: true },
            chrome_ext_model_selector: { value: { default: '', options: [] }, on: true },
            chrome_ext_announcement: { value: {}, on: true },
            chrome_ext_version_info: { value: {}, on: true },
            chrome_ext_flash_enabled: { value: false, on: true },
            chrome_ext_downloads: { value: false, on: true },
            chrome_ext_system_prompt: { value: { systemPrompt: SYSTEM_PROMPT }, on: true },
            chrome_ext_skip_perms_system_prompt: { value: { skipPermissionsSystemPrompt: SKIP_PERMS_PROMPT }, on: true },
            chrome_ext_multiple_tabs_system_prompt: { value: {}, on: true },
            chrome_ext_explicit_permissions_prompt: { value: {}, on: true },
            chrome_ext_tool_usage_prompt: { value: {}, on: true },
            chrome_ext_custom_tool_prompts: { value: {}, on: true },
            chrome_ext_purl_config: { value: null, on: true },
            chrome_ext_purl_prompt: { value: '', on: true },
            chrome_ext_oauth_refresh: { value: {}, on: true }
          }
        });
      }

      if (url.includes('/api/oauth/organizations') || url.includes('/organizations')) {
        if (url.includes('/spotlight')) {
          return jsonResponse({ results: [] });
        }

        if (url.includes('/mcp/') && url.includes('/bootstrap')) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('event: server_list\ndata: {"servers":[]}\n\n'));
              controller.close();
            }
          });

          return new Response(stream, {
            status: 200,
            headers: buildSSEHeaders()
          });
        }

        if (url.includes('/mcp/')) {
          return jsonResponse({ tools: [], servers: [] });
        }

        if (url.includes('/conversations')) {
          return jsonResponse([]);
        }

        return jsonResponse({
          uuid: 'custom-provider-org-00000000',
          name: 'Custom Provider',
          billing_type: 'free'
        });
      }

      if (url.includes('/api/bootstrap') || url.includes('/api/version')) {
        return jsonResponse({});
      }

      return jsonResponse({});
    }

    if (url.includes('claude.ai/api/auth') || url.includes('claude.ai/api/account')) {
      return jsonResponse(MOCK_PROFILE);
    }

    if (
      url.includes('api.segment.io') ||
      url.includes('cdn.segment.com') ||
      url.includes('sentry.io') ||
      url.includes('honeycomb.io') ||
      url.includes('datadoghq.com')
    ) {
      return jsonResponse({ success: true });
    }

    return originalFetch(input, init);
  };

  console.log('[API Adapter] Anthropic -> OpenAI compatibility layer installed');
})();
