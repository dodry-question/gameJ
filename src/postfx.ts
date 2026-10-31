import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

/**
 * Один проход поверх кадра: бочка, хроматика, виньетка, зерно, дрожь яркости.
 * Дёшево и сразу даёт «грязную» картинку.
 */
export function makeFinalPass(): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform vec2 uRes;
      varying vec2 vUv;

      float hash(vec2 p) {
        // хэш без sin: sin-хэш на GPU даёт полосатую структуру зерна
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      void main() {
        vec2 c = vUv - 0.5;
        float r2 = dot(c, c);

        // лёгкая бочка, как у дешёвой оптики
        vec2 uv = vUv + c * r2 * 0.06;

        // хроматическая аберрация по краям
        vec2 ca = c * 0.0022;
        vec3 col;
        col.r = texture2D(tDiffuse, uv + ca).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - ca).b;

        // виньетка: комната тонет по краям, но экран монитора не должна съедать
        float vig = 1.0 - smoothstep(0.18, 0.75, r2);
        col *= mix(0.35, 1.0, vig);

        // зерно: крупное и ленивое (плёнка, а не помехи), дрожь экспозиции мягче.
        // Время ограничено mod'ом: большой t в sin-хэше убивает точность float
        // на GPU, и через минуты игры рябь вырождается в статичную картинку
        float tt = mod(uTime, 100.0);
        float g = hash(floor(uv * uRes / 2.5) + floor(tt * 12.0) * 91.7);
        col += (g - 0.5) * 0.02;
        col *= 0.99 + 0.01 * sin(tt * 41.0) * sin(tt * 2.7);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}
