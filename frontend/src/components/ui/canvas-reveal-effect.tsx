"use client"

import { cn } from "@/lib/utils"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { useMemo, useRef } from "react"
import * as THREE from "three"

interface CanvasRevealEffectProps {
  animationSpeed?: number
  colors?: number[][]
  dotSize?: number
  containerClassName?: string
  showGradient?: boolean
  reverse?: boolean
}

export function CanvasRevealEffect({
  animationSpeed = 0.4,
  colors = [[124, 111, 240]],
  dotSize = 3,
  containerClassName,
  showGradient = true,
  reverse = false,
}: CanvasRevealEffectProps) {
  return (
    <div className={cn("relative h-full w-full", containerClassName)}>
      <DotMatrix
        colors={colors}
        dotSize={dotSize}
        animationSpeed={animationSpeed}
        reverse={reverse}
      />
      {showGradient && (
        <div className="absolute inset-0 bg-gradient-to-t from-[#09090c] to-[84%]" />
      )}
    </div>
  )
}

const opacities = [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1]
const totalSize = 20

interface DotMatrixProps {
  colors: number[][]
  dotSize: number
  animationSpeed: number
  reverse: boolean
}

function DotMatrix({ colors, dotSize, animationSpeed, reverse }: DotMatrixProps) {
  const uniforms = useMemo(() => {
    let palette = [colors[0], colors[0], colors[0], colors[0], colors[0], colors[0]]
    if (colors.length === 2) {
      palette = [colors[0], colors[0], colors[0], colors[1], colors[1], colors[1]]
    } else if (colors.length === 3) {
      palette = [colors[0], colors[0], colors[1], colors[1], colors[2], colors[2]]
    }

    return {
      u_colors: palette.map((c) => new THREE.Vector3(c[0] / 255, c[1] / 255, c[2] / 255)),
      u_opacities: opacities,
      u_total_size: totalSize,
      u_dot_size: dotSize,
      u_reverse: reverse ? 1 : 0,
    }
  }, [colors, dotSize, reverse])

  return (
    <Canvas className="absolute inset-0 h-full w-full">
      <Shader uniforms={uniforms} animationSpeed={animationSpeed} />
    </Canvas>
  )
}

interface ShaderUniforms {
  u_colors: THREE.Vector3[]
  u_opacities: number[]
  u_total_size: number
  u_dot_size: number
  u_reverse: number
}

const vertexShader = `
precision mediump float;
out vec2 fragCoord;
uniform vec2 u_resolution;

void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
  fragCoord = (position.xy + 1.0) * 0.5 * u_resolution;
  fragCoord.y = u_resolution.y - fragCoord.y;
}
`

const fragmentShader = `
precision mediump float;
in vec2 fragCoord;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec3 u_colors[6];
uniform float u_opacities[10];
uniform float u_total_size;
uniform float u_dot_size;
uniform int u_reverse;

float PHI = 1.61803398874989484820459;

float random(vec2 xy) {
  return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x);
}

void main() {
  vec2 st = fragCoord.xy;
  st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));
  st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));

  float opacity = step(0.0, st.x);
  opacity *= step(0.0, st.y);

  vec2 st2 = vec2(floor(st.x / u_total_size), floor(st.y / u_total_size));

  float show_offset = random(st2);
  float rand = random(st2 * floor((u_time / 5.0) + show_offset + 5.0) + 1.0);
  opacity *= u_opacities[int(rand * 10.0)];
  opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
  opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

  vec3 color = u_colors[int(show_offset * 6.0)];

  float speed = 0.5;
  vec2 center = u_resolution / 2.0 / u_total_size;
  float dist = distance(center, st2);
  float max_dist = distance(center, vec2(0.0, 0.0));

  if (u_reverse == 1) {
    float offset = (max_dist - dist) * 0.01 + random(st2) * 0.15;
    opacity *= 1.0 - step(offset, u_time * speed);
    opacity *= clamp(step(offset + 0.1, u_time * speed) * 1.25, 1.0, 1.25);
  } else {
    float offset = dist * 0.01 + random(st2) * 0.15;
    opacity *= step(offset, u_time * speed);
    opacity *= clamp((1.0 - step(offset + 0.1, u_time * speed)) * 1.25, 1.0, 1.25);
  }

  fragColor = vec4(color, opacity);
  fragColor.rgb *= fragColor.a;
}
`

interface ShaderProps {
  uniforms: ShaderUniforms
  animationSpeed: number
}

function Shader({ uniforms, animationSpeed }: ShaderProps) {
  const { size } = useThree()
  const ref = useRef<THREE.ShaderMaterial>(null)

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        u_time: { value: 0 },
        u_resolution: {
          value: new THREE.Vector2(size.width * 2, size.height * 2),
        },
        u_colors: { value: uniforms.u_colors },
        u_opacities: { value: uniforms.u_opacities },
        u_total_size: { value: uniforms.u_total_size },
        u_dot_size: { value: uniforms.u_dot_size },
        u_reverse: { value: uniforms.u_reverse },
      },
      glslVersion: THREE.GLSL3,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      transparent: true,
      depthWrite: false,
    })
  }, [size.width, size.height, uniforms])

  useFrame(({ clock }) => {
    material.uniforms.u_time.value = clock.getElapsedTime() * animationSpeed
  })

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <primitive object={material} ref={ref} attach="material" />
    </mesh>
  )
}
