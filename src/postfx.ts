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
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
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

        // зерно и мелкая дрожь экспозиции
        float g = hash(uv * uRes + fract(uTime) * 91.7);
        col += (g - 0.5) * 0.03;
        col *= 0.975 + 0.025 * sin(uTime * 41.0) * sin(uTime * 2.7);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}
