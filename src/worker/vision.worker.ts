import * as webllm from '@mlc-ai/web-llm';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  signal: AbortSignal;
}

let engine: webllm.MLCEngine | null = null;
let isInitialized = false;
let currentModel: string | null = null;
const pendingRef = new Map<string, PendingRequest>();

const SYSTEM_PROMPT_DEFAULT = `You are a spatial assistant. Analyze this image based on the user's audio request. 
Return ONLY a valid JSON object with the structure:
{
  "objects": [
    {
      "name": "string",
      "bbox_2d": [x, y, width, height],
      "action": "string"
    }
  ]
}
Do not include any other text. Only return the JSON object.`;

let systemPrompt = SYSTEM_PROMPT_DEFAULT;

async function initializeModel(modelId: string): Promise<void> {
  if (isInitialized && currentModel === modelId) {
    postMessage({ type: 'init_progress', progress: 100, status: 'already_loaded' });
    return;
  }

  try {
    postMessage({ type: 'init_progress', progress: 0, status: 'loading' });

    const initProgressCallback = (report: webllm.InitProgressReport) => {
      const progress = Math.round(report.progress * 100);
      postMessage({
        type: 'init_progress',
        progress,
        status: report.text || 'downloading',
        details: report,
      });
    };

    engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: initProgressCallback,
    });

    isInitialized = true;
    currentModel = modelId;

    postMessage({
      type: 'init_complete',
      model: modelId,
      progress: 100,
    });
  } catch (error) {
    const err = error as Error;
    postMessage({
      type: 'error',
      message: `Failed to initialize model: ${err.message}`,
      error: err.toString(),
    });
  }
}

async function runVisionInference(
  image: ImageBitmap,
  userPrompt: string,
  messageId: string
): Promise<void> {
  if (!engine || !isInitialized) {
    postMessage({
      type: 'error',
      message: 'Engine not initialized. Call init first.',
      messageId,
    });
    return;
  }

  try {
    postMessage({ type: 'inference_start' });

    const messages: webllm.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: image } },
          { type: 'text', text: userPrompt || 'Analyze this scene and identify objects of interest.' },
        ],
      },
    ] as webllm.ChatCompletionMessageParam[];

    const response = await engine.chat.completions.create({
      messages,
      temperature: 0.1,
      max_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content || '';

    let parsedResponse: unknown;
    let jsonString = content;

    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonString = jsonMatch[1];
    }

    jsonString = jsonString.trim();

    try {
      const parsed = JSON.parse(jsonString);

      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.objects)) {
        parsedResponse = {
          objects: parsed.objects.map((obj: unknown) => ({
            name: (obj as { name?: string }).name || 'unknown',
            bbox_2d: Array.isArray((obj as { bbox_2d?: unknown[] }).bbox_2d)
              ? (obj as { bbox_2d?: number[] }).bbox_2d
              : [0, 0, 0, 0],
            action: (obj as { action?: string }).action || '',
          })),
        };
      } else {
        throw new Error('Invalid response structure');
      }
    } catch {
      const fallbackMatch = content.match(/\{[\s\S]*\}/);
      if (fallbackMatch) {
        try {
          const fallback = JSON.parse(fallbackMatch[0]);
          parsedResponse = {
            objects: Array.isArray((fallback as { objects?: unknown }).objects)
              ? (fallback as { objects: unknown[] }).objects
              : [],
            rawText: content,
          };
        } catch {
          parsedResponse = { objects: [], rawText: content };
        }
      } else {
        parsedResponse = { objects: [], rawText: content };
      }
      postMessage({
        type: 'warning',
        message: 'JSON parse required fallback extraction',
        rawResponse: content,
      });
    }

    postMessage({
      type: 'inference_complete',
      messageId,
      response: parsedResponse,
      rawText: content,
      usage: response.usage,
    });
  } catch (error) {
    const err = error as Error;
    postMessage({
      type: 'error',
      messageId,
      message: `Inference failed: ${err.message}`,
      error: err.toString(),
    });
  }
}

async function reloadEngine(): Promise<void> {
  if (engine) {
    try {
      await engine.unload();
    } catch (e) {
      console.warn('Engine unload error:', e);
    }
  }
  engine = null;
  isInitialized = false;
  currentModel = null;
  postMessage({ type: 'reloaded' });
}

self.onmessage = async (event: MessageEvent) => {
  const { type, ...data } = event.data;

  switch (type) {
    case 'init':
      if (data.systemPrompt) {
        systemPrompt = data.systemPrompt;
      }
      await initializeModel(data.model || 'Llama-3.2-11B-Vision-Instruct-q4f16_1-MLC');
      break;

    case 'chat':
      await runVisionInference(data.image, data.prompt, data.messageId);
      break;

    case 'reload':
      await reloadEngine();
      break;

    case 'app_reset':
      pendingRef.forEach((pending) => {
        pending.reject({ type: 'error', message: 'App reset triggered' });
      });
      pendingRef.clear();
      postMessage({ type: 'reset_ack' });
      break;

    case 'ping':
      postMessage({ type: 'pong' });
      break;

    default:
      postMessage({ type: 'unknown_message', received: type });
      break;
  }
};

setInterval(() => {
  postMessage({ type: 'pong' });
}, 30000);

postMessage({ type: 'worker_ready' });
