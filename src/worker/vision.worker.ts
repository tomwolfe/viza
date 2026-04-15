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

let systemPrompt = '';

function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
    }
  }
  
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonCandidate = trimmed.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonCandidate);
    } catch {
    }
  }
  
  return null;
}

function validateVisionResponse(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const obj = data as { objects?: unknown };
  return Array.isArray(obj.objects);
}

function validatePlanningResponse(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const obj = data as { taskSteps?: unknown };
  return Array.isArray(obj.taskSteps);
}

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

    let parsedResponse = extractJsonFromText(content);

    if (!parsedResponse || !validateVisionResponse(parsedResponse)) {
      parsedResponse = { objects: [], rawText: content };
      postMessage({
        type: 'warning',
        message: 'JSON parse required fallback extraction',
        rawResponse: content,
      });
    } else {
      const parsed = parsedResponse as { objects?: unknown[] };
      parsedResponse = {
        objects: (parsed.objects || []).map((obj: unknown) => ({
          name: (obj as { item?: string }).item || 'unknown',
          bbox_2d: Array.isArray((obj as { coordinates?: unknown[] }).coordinates)
            ? (obj as { coordinates?: number[] }).coordinates
            : [0, 0, 0, 0],
          action: (obj as { action_step?: string }).action_step || '',
        })),
        completed: (parsedResponse as { completed?: boolean }).completed || false,
      };
    }

    const isCompleted = (parsedResponse as { completed?: boolean })?.completed || false;
    postMessage({
      type: 'inference_complete',
      messageId,
      response: parsedResponse,
      completed: isCompleted,
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
  } finally {
    image.close();
  }
}

async function runPlanningInference(
  image: ImageBitmap,
  userGoal: string,
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

    const isCleaningMode = /clean|organize|trash|garbage|mess/i.test(userGoal);
    
    const promptText = isCleaningMode
      ? `You are a spatial planning assistant. The user wants to: "${userGoal}"

Analyze this image and create a detailed task plan. Identify all objects that match the goal category.

Return ONLY a valid JSON object with this structure:
{
  "taskSteps": [
    {
      "id": "step-N",
      "instruction": "Clear description of what to do",
      "targetObject": "The specific object or category to target",
      "validationPrompt": "How to verify this step is complete"
    }
  ]
}

Provide 5-10 specific steps. Focus on actionable items. Do not include any other text.`
      : `You are a spatial planning assistant. The user wants to: "${userGoal}"

Analyze this image and create a detailed task plan for completing this goal.

Return ONLY a valid JSON object with this structure:
{
  "taskSteps": [
    {
      "id": "step-N",
      "instruction": "Clear description of what to do",
      "targetObject": "The specific object or category to target",
      "validationPrompt": "How to verify this step is complete"
    }
  ]
}

Provide 5-10 specific steps in logical order. Do not include any other text.`;

    const messages: webllm.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: image } },
          { type: 'text', text: promptText },
        ],
      },
    ] as webllm.ChatCompletionMessageParam[];

    const response = await engine.chat.completions.create({
      messages,
      temperature: 0.1,
      max_tokens: 2048,
    });

    const content = response.choices[0]?.message?.content || '';
    let parsedResponse = extractJsonFromText(content);

    if (!parsedResponse || !validatePlanningResponse(parsedResponse)) {
      parsedResponse = { taskSteps: [], rawText: content };
      postMessage({
        type: 'warning',
        message: 'Planning JSON parse required fallback extraction',
        rawResponse: content,
      });
    }

    postMessage({
      type: 'planning_complete',
      messageId,
      response: parsedResponse,
      rawText: content,
    });
  } catch (error) {
    const err = error as Error;
    postMessage({
      type: 'error',
      messageId,
      message: `Planning inference failed: ${err.message}`,
      error: err.toString(),
    });
  } finally {
    image.close();
  }
}

async function runCategoryInference(
  image: ImageBitmap,
  userGoal: string,
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

    const isTrash = /trash|garbage|discard|throw away|waste/i.test(userGoal);
    const isClutter = /clean|organize|mess|tidy|put away/i.test(userGoal);
    
    let categoryFocus = '';
    
    if (isTrash) {
      categoryFocus = 'Identify all TRASH items (wrappers, bottles, cans, paper waste, food containers, etc.) and return their bounding boxes.';
    } else if (isClutter) {
      categoryFocus = 'Identify all CLUTTER items (clothes, papers, scattered items, messy areas) and return their bounding boxes.';
    } else {
      categoryFocus = 'Identify all objects and their categories. Use "keep" for items to preserve, "trash" for waste, "clutter" for items to organize.';
    }

    const promptText = `You are a spatial assistant for cleaning tasks.
User Goal: "${userGoal}"

${categoryFocus}

Return ONLY a valid JSON object with the structure:
{
  "objects": [
    {
      "item": "string - object name",
      "coordinates": [x, y, width, height],
      "action_step": "string - action to take with this object (e.g., 'throw away', 'keep', 'organize')",
      "category": "string - one of: trash, clutter, keep, tool, unknown"
    }
  ],
  "completed": boolean
}
Do not include any other text. Only return the JSON object.`;

    const messages: webllm.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: image } },
          { type: 'text', text: promptText },
        ],
      },
    ] as webllm.ChatCompletionMessageParam[];

    const response = await engine.chat.completions.create({
      messages,
      temperature: 0.1,
      max_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content || '';
    let parsedResponse = extractJsonFromText(content);

    if (!parsedResponse || !validateVisionResponse(parsedResponse)) {
      parsedResponse = { objects: [], rawText: content };
    } else {
      const parsed = parsedResponse as { objects?: unknown[]; completed?: boolean };
      parsedResponse = {
        objects: (parsed.objects || []).map((obj: unknown) => ({
          name: (obj as { item?: string }).item || 'unknown',
          bbox_2d: Array.isArray((obj as { coordinates?: unknown[] }).coordinates)
            ? (obj as { coordinates?: number[] }).coordinates
            : [0, 0, 0, 0],
          action: (obj as { action_step?: string }).action_step || '',
          category: (obj as { category?: string }).category || 'unknown',
        })),
        completed: parsed.completed || false,
      };
    }

    const isCompleted = (parsedResponse as { completed?: boolean })?.completed || false;
    postMessage({
      type: 'inference_complete',
      messageId,
      response: parsedResponse,
      completed: isCompleted,
      rawText: content,
    });
  } catch (error) {
    const err = error as Error;
    postMessage({
      type: 'error',
      messageId,
      message: `Category inference failed: ${err.message}`,
      error: err.toString(),
    });
  } finally {
    image.close();
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
      await initializeModel(data.model || 'Phi-3.5-vision-instruct-q4f16_1-MLC');
      break;

    case 'chat':
      await runVisionInference(data.image, data.prompt, data.messageId);
      break;

    case 'planning':
      await runPlanningInference(data.image, data.goal, data.messageId);
      break;

    case 'category':
      await runCategoryInference(data.image, data.goal, data.messageId);
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
