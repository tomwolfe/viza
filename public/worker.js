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
// SECURITY: Using specific version with integrity hash in production
importScripts('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.82/dist/webllm.min.js#sha384-5crZyMDeTM0ifOFASah8oqsNb1hCtHdT18lSHK6RYsQZlL0nf+DLOyPmAmqloENC');

let engine = null;
let isInitialized = false;
let currentModel = null;
let pendingRef = new Map();
let systemPrompt = `You are a spatial assistant. Analyze this image based on the user's audio request. 
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
 * @param {string} [messageId] - Correlation ID for response routing
 */
async function runVisionInference(image, userPrompt, messageId) {
  if (!engine || !isInitialized) {
    postMessage({ 
      type: 'error', 
      message: 'Engine not initialized. Call init first.',
      messageId 
    });
    return;
  }

  try {
    postMessage({ type: 'inference_start' });

    // Build the multimodal request
    const messages = [
      { role: 'system', content: systemPrompt },
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

    // Parse JSON response with robust extraction
    let parsedResponse;
    let jsonString = content;
    
    // Try to extract JSON from markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonString = jsonMatch[1];
    }
    
    // Clean up potential markdown and whitespace
    jsonString = jsonString.trim();
    
    try {
      const parsed = JSON.parse(jsonString);
      
      // Validate structure matches expected schema
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.objects)) {
        parsedResponse = {
          objects: parsed.objects.map((obj) => ({
            name: obj.name || 'unknown',
            bbox_2d: Array.isArray(obj.bbox_2d) ? obj.bbox_2d : [0, 0, 0, 0],
            action: obj.action || '',
          })),
        };
      } else {
        throw new Error('Invalid response structure');
      }
    } catch {
      // Fallback: try to find any JSON-like structure in the response
      const fallbackMatch = content.match(/\{[\s\S]*\}/);
      if (fallbackMatch) {
        try {
          const fallback = JSON.parse(fallbackMatch[0]);
          parsedResponse = {
            objects: Array.isArray(fallback.objects) ? fallback.objects : [],
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
      usage: response.usage
    });
  } catch (error) {
    postMessage({
      type: 'error',
      messageId,
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
      pendingRef.current.forEach(cb => cb({ type: 'error', message: 'App reset triggered' }));
      pendingRef.current.clear();
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

// Heartbeat to detect worker crashes
setInterval(() => {
  postMessage({ type: 'pong' });
}, 30000);

// Notify main thread that worker is ready
postMessage({ type: 'worker_ready' });
