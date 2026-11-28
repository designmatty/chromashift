import { closingGradientPalette, closingGradientStippleTable } from '@/closing-gradient-color'
import { foldShader, stippleShader, vertexShader } from '@/closing-gradient-shaders'

export const gradientSettings = {
  colors: [0xf847ff, 0xff8d00],
  backgroundColor: 0x0e0e11,
  levels: 4,
  pixelSize: 1,
  warp: 1,
  scale: 1,
  layers: 10,
  spread: 0.75,
  angle: 0,
  drift: 32,
  speed: 0.95,
  seed: 20,
  stir: 1.1,
  tide: 1
} as const

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (shader === null) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  gl.deleteShader(shader)
  return null
}

function buildProgram(gl: WebGL2RenderingContext, vertex: WebGLShader, source: string) {
  const fragment = compile(gl, gl.FRAGMENT_SHADER, source)
  if (fragment === null) return null
  const program = gl.createProgram()
  if (program !== null) {
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
  }
  gl.deleteShader(fragment)
  if (program !== null && gl.getProgramParameter(program, gl.LINK_STATUS)) return program
  gl.deleteProgram(program)
  return null
}

function createTexture(gl: WebGL2RenderingContext, unit: number, filter: number) {
  const texture = gl.createTexture()
  if (texture === null) return null
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
}

export function createClosingGradientRenderer(canvas: HTMLCanvasElement, noise: HTMLImageElement) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    // A paused or reduced-motion frame must survive a compositor resize.
    preserveDrawingBuffer: true,
    failIfMajorPerformanceCaveat: true
  })
  if (gl === null) return null

  const vertex = compile(gl, gl.VERTEX_SHADER, vertexShader)
  if (vertex === null) return null
  const fold = buildProgram(gl, vertex, foldShader)
  const stipple = buildProgram(gl, vertex, stippleShader)
  gl.deleteShader(vertex)
  if (fold === null || stipple === null) {
    gl.deleteProgram(fold)
    gl.deleteProgram(stipple)
    return null
  }

  const framebuffer = gl.createFramebuffer()
  const fieldTexture = createTexture(gl, 0, gl.LINEAR)
  const noiseTexture = createTexture(gl, 1, gl.NEAREST)
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
  if (noiseTexture !== null) {
    // Independent void-and-cluster ranks for red, green, and blue.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, noise)
  }
  const quantizer = createTexture(gl, 2, gl.NEAREST)
  const dispose = () => {
    gl.deleteProgram(fold)
    gl.deleteProgram(stipple)
    gl.deleteFramebuffer(framebuffer)
    gl.deleteTexture(fieldTexture)
    gl.deleteTexture(noiseTexture)
    gl.deleteTexture(quantizer)
  }
  if (
    framebuffer === null ||
    fieldTexture === null ||
    noiseTexture === null ||
    quantizer === null
  ) {
    dispose()
    return null
  }

  gl.disable(gl.DITHER)
  const settings = gradientSettings
  const samples = 2048
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    samples,
    1,
    0,
    gl.RGBA,
    gl.FLOAT,
    closingGradientStippleTable(settings.levels, samples)
  )

  const uniform = (program: WebGLProgram, name: string) => gl.getUniformLocation(program, name)
  const sizeForFold = uniform(fold, 'u_size')
  const sizeForStipple = uniform(stipple, 'u_size')
  const grid = uniform(fold, 'u_fieldSize')
  const flowTime = uniform(fold, 'u_flow')
  const clock = uniform(stipple, 'u_clock')
  const intro = uniform(stipple, 'u_intro')
  const tides = uniform(stipple, 'u_tides[0]')
  const angle = (settings.angle * Math.PI) / 180
  const palette = closingGradientPalette(settings.colors, settings.backgroundColor, settings.drift)

  gl.useProgram(fold)
  gl.uniform2f(uniform(fold, 'u_rotation'), Math.cos(angle), Math.sin(angle))
  gl.uniform1f(uniform(fold, 'u_frequency'), 3 / settings.scale)
  gl.uniform1f(uniform(fold, 'u_warp'), 0.3 * settings.warp)
  gl.uniform1i(uniform(fold, 'u_layers'), settings.layers)
  gl.uniform1f(uniform(fold, 'u_seed'), 16 * settings.seed)

  gl.useProgram(stipple)
  gl.uniform1i(uniform(stipple, 'u_field'), 0)
  gl.uniform1i(uniform(stipple, 'u_noise'), 1)
  gl.uniform1i(uniform(stipple, 'u_quantizer'), 2)
  gl.uniform3fv(uniform(stipple, 'u_background'), palette.backgroundSrgb)
  gl.uniform3fv(uniform(stipple, 'u_dawn[0]'), palette.dawn)
  gl.uniform3fv(uniform(stipple, 'u_dusk[0]'), palette.dusk)
  gl.uniform1f(uniform(stipple, 'u_spread'), settings.spread)
  gl.uniform1f(uniform(stipple, 'u_levels'), settings.levels)

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTexture, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)

  let fieldWidth = 0
  let fieldHeight = 0
  return {
    resize(width: number, height: number): boolean {
      canvas.width = Math.max(1, Math.floor(width / settings.pixelSize))
      canvas.height = Math.max(1, Math.floor(height / settings.pixelSize))
      if (gl.drawingBufferWidth !== canvas.width || gl.drawingBufferHeight !== canvas.height) {
        return false
      }

      // Bound the expensive fold pass while keeping every stipple dot at CSS-pixel scale.
      const foldScale = Math.min(0.25, Math.sqrt(40_625 / (canvas.width * canvas.height)))
      fieldWidth = Math.ceil(canvas.width * foldScale)
      fieldHeight = Math.ceil(canvas.height * foldScale)

      gl.activeTexture(gl.TEXTURE0)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        fieldWidth,
        fieldHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
      )
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)

      gl.useProgram(fold)
      gl.uniform2f(sizeForFold, canvas.width, canvas.height)
      gl.uniform2f(grid, fieldWidth, fieldHeight)
      gl.useProgram(stipple)
      gl.uniform2f(sizeForStipple, canvas.width, canvas.height)
      return complete
    },
    draw(flow: number, phase: number, reveal: number, waves: Float32Array) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.viewport(0, 0, fieldWidth, fieldHeight)
      gl.useProgram(fold)
      gl.uniform1f(flowTime, flow)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.useProgram(stipple)
      gl.uniform1f(clock, phase)
      gl.uniform1f(intro, reveal)
      gl.uniform4fv(tides, waves)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose
  }
}
