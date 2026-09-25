/**
 * True when WebGL would run on the CPU (SwiftShader, llvmpipe, Microsoft
 * Basic Render — hardware acceleration off, a blocklisted GPU, some VMs) or
 * is missing entirely. The live scenes run at ~1fps there, so callers fall
 * back to the pre-rendered art. Probed once and cached.
 */
let cached;
export function isSlowGpu() {
  if (cached !== undefined) return cached;
  cached = false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true })
      || canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true });
    if (!gl) { cached = true; return cached; }
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    cached = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    cached = true;
  }
  return cached;
}
