# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/repro.spec.ts >> Reproduce AR analyzing scene errors
- Location: tests/repro.spec.ts:3:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.waitForSelector: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('p:has-text("Analyzing scene...")') to be visible

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e2]:
    - generic:
      - generic:
        - status:
          - generic:
            - generic:
              - img
              - generic: Error
            - generic: Please use a WebGPU-capable browser (Chrome 113+, Edge 113+) on a compatible device.
        - button "Start AR session" [disabled] [ref=e7]:
          - img [ref=e8]
          - generic [ref=e10]: Start AR
        - generic: Loading AI model. 0% complete.
  - generic [ref=e15] [cursor=pointer]:
    - button "Open Next.js Dev Tools" [ref=e16]:
      - img [ref=e17]
    - generic [ref=e20]:
      - button "Open issues overlay" [ref=e21]:
        - generic [ref=e22]:
          - generic [ref=e23]: "1"
          - generic [ref=e24]: "2"
        - generic [ref=e25]:
          - text: Issue
          - generic [ref=e26]: s
      - button "Collapse issues badge" [ref=e27]:
        - img [ref=e28]
  - alert [ref=e30]
```

# Test source

```ts
  11  |         requestReferenceSpace: () => Promise.resolve({}),
  12  |         requestAnimationFrame: (cb) => {
  13  |           return setTimeout(() => cb(Date.now(), {
  14  |             getViewerPose: () => ({ 
  15  |               transform: { 
  16  |                 position: { x: 0, y: 0, z: 0 }, 
  17  |                 orientation: { x: 0, y: 0, z: 0, w: 1 } 
  18  |               },
  19  |               views: [{
  20  |                 projectionMatrix: new Float32Array(16),
  21  |                 transform: { matrix: new Float32Array(16) }
  22  |               }]
  23  |             }),
  24  |             getHitTestResults: () => []
  25  |           }), 100);
  26  |         },
  27  |         cancelAnimationFrame: (id) => clearTimeout(id),
  28  |         end: () => Promise.resolve(),
  29  |         enabledFeatures: ['camera-access', 'hit-test'],
  30  |         requestHitTestSource: () => Promise.resolve({}),
  31  |       }),
  32  |       addEventListener: () => {},
  33  |       removeEventListener: () => {},
  34  |     };
  35  | 
  36  |     Object.defineProperty(navigator, 'xr', { value: mockXR, configurable: true });
  37  | 
  38  |     const mockGPU = {
  39  |       requestAdapter: () => Promise.resolve({
  40  |         features: new Set(),
  41  |         limits: {},
  42  |         requestDevice: () => Promise.resolve({
  43  |           lost: new Promise(() => {}),
  44  |           createBuffer: () => ({}),
  45  |           createBindGroup: () => ({}),
  46  |           createBindGroupLayout: () => ({}),
  47  |           createComputePipeline: () => ({}),
  48  |           createShaderModule: () => ({}),
  49  |           createCommandEncoder: () => ({
  50  |             beginComputePass: () => ({
  51  |               setPipeline: () => {},
  52  |               setBindGroup: () => {},
  53  |               dispatchWorkgroups: () => {},
  54  |               end: () => {},
  55  |             }),
  56  |             finish: () => ({}),
  57  |           }),
  58  |           queue: {
  59  |             submit: () => {},
  60  |             writeBuffer: () => {},
  61  |           },
  62  |         }),
  63  |       }),
  64  |     };
  65  | 
  66  |     Object.defineProperty(navigator, 'gpu', { value: mockGPU, configurable: true, writable: true });
  67  | 
  68  |     // Mock MediaDevices
  69  |     if (navigator.mediaDevices) {
  70  |         Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
  71  |           value: async () => {
  72  |             const canvas = document.createElement('canvas');
  73  |             canvas.width = 640;
  74  |             canvas.height = 480;
  75  |             const stream = (canvas as any).captureStream();
  76  |             return stream;
  77  |           },
  78  |           configurable: true
  79  |         });
  80  |     }
  81  |   });
  82  | 
  83  |   const errors: string[] = [];
  84  |   page.on('console', msg => {
  85  |     if (msg.type() === 'error') {
  86  |       errors.push(msg.text());
  87  |       console.log('Browser Console Error:', msg.text());
  88  |     }
  89  |   });
  90  |   page.on('pageerror', err => {
  91  |     errors.push(err.message);
  92  |     console.log('Page Error:', err.message);
  93  |   });
  94  | 
  95  |   await page.goto('http://localhost:3000');
  96  | 
  97  |   // Acknowledge system requirements if visible
  98  |   const acknowledgeBtn = page.locator('button:has-text("Acknowledge")');
  99  |   if (await acknowledgeBtn.isVisible()) {
  100 |     await acknowledgeBtn.click();
  101 |   }
  102 | 
  103 |   // Click Start AR
  104 |   const startArBtn = page.locator('button:has-text("Start AR")');
  105 |   await expect(startArBtn).toBeVisible({ timeout: 10000 });
  106 |   await startArBtn.click();
  107 | 
  108 |   console.log('Clicked Start AR, waiting for "Analyzing scene..."');
  109 | 
  110 |   // Wait for "Analyzing scene..." overlay
> 111 |   await page.waitForSelector('p:has-text("Analyzing scene...")', { timeout: 60000 });
      |              ^ Error: page.waitForSelector: Test timeout of 30000ms exceeded.
  112 | 
  113 |   console.log('Reached "Analyzing scene" phase. Waiting for errors...');
  114 | 
  115 |   // Wait some more to capture potential recurring errors
  116 |   await page.waitForTimeout(10000);
  117 | 
  118 |   if (errors.length > 0) {
  119 |     console.log(`Found ${errors.length} errors.`);
  120 |   } else {
  121 |     console.log('No errors found so far.');
  122 |   }
  123 | });
  124 | 
```