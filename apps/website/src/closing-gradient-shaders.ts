export const vertexShader = `#version 300 es
void main() {
  vec2 vertex = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(vertex * 2.0 - 1.0, 0.0, 1.0);
}`

export const foldShader = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 u_size;
uniform vec2 u_fieldSize;
uniform vec2 u_rotation;
uniform float u_flow;
uniform float u_frequency;
uniform float u_warp;
uniform int u_layers;
uniform float u_seed;
out vec4 pixel;

float randomAt(ivec3 position) {
  uvec3 cell = uvec3(position);
  uint hash = (cell.x * 1597334677u) ^ (cell.y * 3812015801u) ^ (cell.z * 2798796415u);
  hash = (hash ^ (hash >> 16u)) * 2246822519u;
  hash = (hash ^ (hash >> 13u)) * 3266489917u;
  return float((hash ^ (hash >> 16u)) >> 8u) * (1.0 / 16777216.0);
}

float valueNoise(vec3 point) {
  ivec3 base = ivec3(floor(point));
  vec3 w = fract(point);
  w = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  float lower = mix(
    mix(randomAt(base), randomAt(base + ivec3(1, 0, 0)), w.x),
    mix(randomAt(base + ivec3(0, 1, 0)), randomAt(base + ivec3(1, 1, 0)), w.x), w.y);
  float upper = mix(
    mix(randomAt(base + ivec3(0, 0, 1)), randomAt(base + ivec3(1, 0, 1)), w.x),
    mix(randomAt(base + ivec3(0, 1, 1)), randomAt(base + ivec3(1, 1, 1)), w.x), w.y);
  return mix(lower, upper, w.z);
}

float turbulence(vec3 point) {
  const mat3 turn = mat3(0.0, 1.6, 1.2, -1.6, 0.72, -0.96, -1.2, -0.96, 1.28);
  float sum = 0.0;
  float weight = 8.0;
  for (int octave = 0; octave < 4; octave++) {
    sum += weight * (valueNoise(point) - 0.5);
    point = turn * point;
    weight *= 0.5;
  }
  return sum / 15.0;
}

void main() {
  // Keep the palette transitions spread across wide sections. The final pass
  // still uses viewport coordinates for the stipple and click ripples.
  float foldAspect = min(u_size.x / u_size.y, 2.25);
  vec2 view = (gl_FragCoord.xy / u_fieldSize - 0.5) * vec2(foldAspect, 1.0);
  vec2 point = mat2(u_rotation.x, u_rotation.y, -u_rotation.y, u_rotation.x) * view;
  vec2 axis = vec2(0.8, -0.6);
  const mat2 rotation = mat2(0.8, -0.6, 0.6, 0.8);
  for (int layer = 0; layer < u_layers; layer++) {
    vec2 normal = vec2(-axis.y, axis.x);
    float position = dot(point, axis) * u_frequency;
    float shear = turbulence(vec3(position, u_flow, u_seed + float(layer)));
    point += normal * (u_warp * shear);
    axis = rotation * axis;
  }

  // Two bytes per coordinate. Combining the channels is linear, so the
  // compositor can use hardware bilinear filtering on the packed field.
  vec2 fixedPoint = round(clamp(point / 16.0 + 0.5, 0.0, 1.0) * 65535.0);
  vec2 high = floor(fixedPoint / 256.0);
  vec2 low = fixedPoint - 256.0 * high;
  pixel = vec4(high, low) / 255.0;
}`

export const maxTides = 6

export const stippleShader = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 u_size;
uniform float u_clock;
uniform float u_intro;
uniform float u_spread;
uniform float u_levels;
uniform vec3 u_background;
uniform vec3 u_dawn[4];
uniform vec3 u_dusk[4];
uniform vec4 u_tides[${maxTides}];
uniform sampler2D u_field;
uniform sampler2D u_noise;
uniform sampler2D u_quantizer;
out vec4 pixel;

vec2 eased(vec2 value) {
  vec2 t = clamp(value, 0.0, 1.0);
  return t * t * t * (t * (6.0 * t - 15.0) + 10.0);
}

vec3 toSrgb(vec3 light) {
  return mix(12.92 * light, 1.055 * pow(light, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, light));
}

vec3 colorAt(vec3 corners[4], vec2 blend) {
  vec3 bottom = mix(corners[0], corners[1], blend.x);
  vec3 top = mix(corners[2], corners[3], blend.x);
  return mix(bottom, top, blend.y);
}

float dotLevel(float display, float rank) {
  int last = textureSize(u_quantizer, 0).x - 1;
  int sampleIndex = int(round(clamp(display, 0.0, 1.0) * float(last)));
  vec3 sampleData = texelFetch(u_quantizer, ivec2(sampleIndex, 0), 0).rgb;
  float stepIndex = float(rank >= sampleData.y) + float(rank >= sampleData.z);
  return (sampleData.x + stepIndex) / (u_levels - 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  vec4 encoded = texture(u_field, uv);
  vec2 point = ((encoded.xy * 256.0 + encoded.zw) * (255.0 / 65535.0) - 0.5) * 16.0;
  vec2 blend = eased(point / u_spread + 0.5);

  float reveal = 1.0;
  if (u_intro < 1.0) {
    float delay = (2.0 - blend.x - blend.y) * 0.3125;
    reveal = eased(vec2((u_intro - delay) / 0.375)).x;
    if (reveal == 0.0) {
      pixel = vec4(u_background, 1.0);
      return;
    }
  }

  vec2 view = (uv - 0.5) * u_size / u_size.y;

  float clock = u_clock;
  for (int wave = 0; wave < ${maxTides}; wave++) {
    vec4 tide = u_tides[wave];
    if (tide.w == 0.0) continue;
    float front = tide.z - length(view - tide.xy);
    clock += tide.w * smoothstep(-0.21, 0.21, front);
  }
  float dusk = 0.5 - 0.5 * cos(clock);
  vec3 lab = mix(colorAt(u_dawn, blend), colorAt(u_dusk, blend), dusk);

  const mat3 toCone = mat3(1.0, 1.0, 1.0, 0.3963377774, -0.1055613458, -0.0894841775,
    0.2158037573, -0.0638541728, -1.291485548);
  const mat3 toRgb = mat3(4.0767416621, -1.2684380046, -0.0041960863, -3.3077115913, 2.6097574011,
    -0.7034186147, 0.2309699292, -0.3413193965, 1.707614701);
  vec3 cone = toCone * lab;
  vec3 display = toSrgb(clamp(toRgb * (cone * cone * cone), 0.0, 1.0));
  ivec2 cell = ivec2(gl_FragCoord.xy) % textureSize(u_noise, 0);
  vec3 rank = (texelFetch(u_noise, cell, 0).rgb * 255.0 + 0.5) / 256.0;
  vec3 dots = vec3(dotLevel(display.r, rank.r), dotLevel(display.g, rank.g), dotLevel(display.b, rank.b));
  // Fade the finished dots in. Quantizing the dark background creates bright specks.
  pixel = vec4(mix(u_background, dots, reveal), 1.0);
}`
