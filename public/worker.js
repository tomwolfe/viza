/**
 * WebLLM Web Worker
 * Runs @mlc-ai/web-llm inference off the main thread to prevent AR camera freeze.
 * 
 * Message Types:
 * - { type: 'init', model: string }     → Initialize and download model
 * - { type: 'chat', image: ImageBitmap, prompt: string } → Run vision inference
 * - { type: 'reload' }                   → Reload the engine
 */

// Load web-llm from CDN for static export compatibility
// This MUST match the version in package.json
importScripts('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.82/dist/webllm.min.js');

let engine = null;
let isInitialized = false;
let currentModel = null;

// System prompt for spatial task analysis
const SYSTEM_PROMPT = `You are a spatial assistant. Analyze this image based on the user's audio request. 
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

/**
 * Initialize the WebLLM engine with the specified model.
 * Reports progress back to main thread during download.
 */
async function initializeModel(modelId) {
  if (isInitialized && currentModel === modelId) {
    postMessage({ type: 'init_progress', progress: 100, status: 'already_loaded' });
    return;
  }

  try {
    postMessage({ type: 'init_progress', progress: 0, status: 'loading' });

    // Verify web-llm loaded
    if (!self.webllm || !self.webllm.CreateMLCEngine) {
      postMessage({ 
        type: 'error', 
        message: 'WebLLM not loaded from CDN. Check network connection.' 
      });
      return;
    }

    // Create progress callback
    const initProgressCallback = (report) => {
      const progress = Math.round(report.progress * 100);
      postMessage({ 
        type: 'init_progress', 
        progress, 
        status: report.text || 'downloading',
        details: report
      });
    };

    // Initialize engine with progress tracking
    // Model weights are fetched from MLC's default HuggingFace CDN
    engine = await self.webllm.CreateMLCEngine(modelId, {
      initProgressCallback: initProgressCallback,
    });

    isInitialized = true;
    currentModel = modelId;

    postMessage({ 
      type: 'init_complete', 
      model: modelId,
      progress: 100 
    });
  } catch (error) {
    postMessage({ 
      type: 'error', 
      message: `Failed to initialize model: ${error.message}`,
      error: error.toString()
    });
  }
}

/**
 * Run vision inference with an image and prompt.
 * @param {ImageBitmap} image - The camera frame (512x512 downscaled)
 * @param {string} userPrompt - The user's voice request
 */
async function runVisionInference(image, userPrompt) {
  if (!engine || !isInitialized) {
    postMessage({ 
      type: 'error', 
      message: 'Engine not initialized. Call init first.' 
    });
    return;
  }

  try {
    postMessage({ type: 'inference_start' });

    // Build the multimodal request
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: image },
          { type: 'text', text: userPrompt || 'Analyze this scene and identify objects of interest.' }
        ]
      }
    ];

    // Run inference
    const response = await engine.chat.completions.create({
      messages,
      temperature: 0.1, // Low temperature for deterministic JSON
      max_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content || '';

    // Parse JSON response
    let parsedResponse;
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const jsonString = jsonMatch ? jsonMatch[1] : content;
      parsedResponse = JSON.parse(jsonString.trim());
    } catch {
      postMessage({
        type: 'warning',
        message: 'Failed to parse JSON response, returning raw text',
        rawResponse: content
      });
      parsedResponse = { objects: [], rawText: content };
    }

    postMessage({
      type: 'inference_complete',
      response: parsedResponse,
      rawText: content,
      usage: response.usage
    });
  } catch (error) {
    postMessage({
      type: 'error',
      message: `Inference failed: ${error.message}`,
      error: error.toString()
    });
  }
}

/**
 * Reload the engine (free memory and reinitialize).
 */
async function reloadEngine() {
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

// Message handler
self.onmessage = async (event) => {
  const { type, ...data } = event.data;

  switch (type) {
    case 'init':
      await initializeModel(data.model || 'Llama-3.2-11B-Vision-Instruct-q4f16_1-MLC');
      break;

    case 'chat':
      await runVisionInference(data.image, data.prompt);
      break;

    case 'reload':
      await reloadEngine();
      break;

    default:
      postMessage({ type: 'unknown_message', received: type });
      break;
  }
};

// Notify main thread that worker is ready
postMessage({ type: 'worker_ready' });
