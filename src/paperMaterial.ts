// Paper: a rough, faintly fibrous sheet that glows warm where light comes
// through it from behind. Built on MeshPhysicalMaterial so it takes the
// scene's image-based lighting, with a small shader patch for translucency.
import * as THREE from "three";
import { CONTACT_SHADE, CURL_SHADE } from "./paperShading";

/** A tileable-enough field of short fibres, used as colour and bump. */
function fibreTexture(size = 1024): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgb(128,128,128)";
  ctx.fillRect(0, 0, size, size);

  // Pulp: fine speckle.
  const img = ctx.getImageData(0, 0, size, size);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (rand() - 0.5) * 22;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);

  // Fibres: thin, slightly curved strokes, lighter and darker than the pulp.
  ctx.lineCap = "round";
  for (let i = 0; i < 9000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 6 + rand() * 26;
    const a = rand() * Math.PI * 2;
    const bend = (rand() - 0.5) * len * 0.6;
    const light = rand() > 0.5;
    ctx.strokeStyle = light ? `rgba(255,255,255,${0.05 + rand() * 0.1})` : `rgba(0,0,0,${0.04 + rand() * 0.08})`;
    ctx.lineWidth = 0.6 + rand() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend,
      y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend,
      x + Math.cos(a) * len,
      y + Math.sin(a) * len,
    );
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Folds and creases, as the WebGPU paper has them; see foldShading in paper.wgsl. */
export type WebGLPaperMaterial = THREE.MeshPhysicalMaterial & {
  creaseStart: { value: number };
  folds: readonly { value: THREE.Vector4 }[];
  contact: readonly { value: THREE.Vector4 }[];
};

/** paper.wgsl's foldShading, in GLSL. */
const FOLD_SHADING = /* glsl */ `
  uniform float creaseStart;
  uniform vec4 folds[3];
  uniform vec4 contact[6];
  vec2 foldShading(vec2 p, float footprint, float facing) {
    const float STEP = 0.5235988;
    float r = length(p);
    float a = atan(p.y, p.x) - creaseStart;
    a -= floor(a / 6.2831853) * 6.2831853;
    int k = min(int(a / STEP), 11);
    int n = (k + 1) % 12;
    float offset = a - float(k) * STEP;
    float toNear = r * sin(offset);
    float toFar = r * sin(STEP - offset);

    float reach = smoothstep(0.01, 0.08, r);
    float curlWidth = max(0.008, footprint * 2.5);
    float curl = reach * max(
      abs(folds[k / 4][k % 4]) * (1.0 - smoothstep(0.0, curlWidth, toNear)),
      abs(folds[n / 4][n % 4]) * (1.0 - smoothstep(0.0, curlWidth, toFar)));

    vec4 pairs = contact[k / 2];
    vec2 pair = (k % 2 == 1 ? pairs.zw : pairs.xy) * facing;
    float spread = max(0.045, footprint * 10.0);
    float shadowNear = 1.0 - smoothstep(0.0, spread, toNear);
    float shadowFar = 1.0 - smoothstep(0.0, spread, toFar);
    float shadow = reach * max(max(pair.x, 0.0) * shadowNear * shadowNear, max(pair.y, 0.0) * shadowFar * shadowFar);
    return vec2(curl, shadow);
  }`;

export function createPaperMaterial(mask: THREE.Texture): WebGLPaperMaterial {
  const fibres = fibreTexture();
  const tint = fibres.clone();
  tint.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#fcfcfa"),
    map: tint,
    bumpMap: fibres,
    bumpScale: 0.6,
    roughness: 0.88,
    roughnessMap: fibres,
    sheen: 0.35,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color("#ffffff"),
    alphaMap: mask,
    alphaTest: 0.5,
    // Smooth the cut outlines with the canvas's multisampling rather than a hard step.
    alphaToCoverage: true,
    side: THREE.DoubleSide,
  });

  // The fibre texture is authored around mid-grey; lift it so `map` only
  // mottles the white rather than darkening it.
  const creaseStart = { value: 0 };
  const folds = Array.from({ length: 3 }, () => ({ value: new THREE.Vector4() }));
  const contact = Array.from({ length: 6 }, () => ({ value: new THREE.Vector4() }));
  material.onBeforeCompile = (shader) => {
    shader.uniforms.creaseStart = creaseStart;
    shader.uniforms.folds = { value: folds.map((f) => f.value) };
    shader.uniforms.contact = { value: contact.map((c) => c.value) };
    shader.uniforms.translucency = { value: 0.55 };
    shader.uniforms.translucencyTint = { value: new THREE.Color("#ffe2b8") };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float translucency;\nuniform vec3 translucencyTint;\n" + FOLD_SHADING,
      )
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          diffuseColor.rgb *= mix( vec3( 0.93 ), vec3( 1.04 ), sampledDiffuseColor.r );
        #endif
        vec2 sheetP = vAlphaMapUv * 2.0 - 1.0;
        float sheetFootprint = length( fwidth( sheetP ) );
        vec2 folding = foldShading( sheetP, sheetFootprint, gl_FrontFacing ? 1.0 : - 1.0 );
        diffuseColor.rgb *= ( 1.0 - folding.x * ${CURL_SHADE.toFixed(3)} ) * ( 1.0 - folding.y * ${CONTACT_SHADE.toFixed(3)} );`,
      )
      // As three does for alpha to coverage, but with the one-pixel ramp
      // centred on the cut rather than starting at it.
      .replace(
        "#include <alphatest_fragment>",
        `float cutWidth = fwidth( diffuseColor.a );
        diffuseColor.a = smoothstep( alphaTest - 0.5 * cutWidth, alphaTest + 0.5 * cutWidth, diffuseColor.a );
        if ( diffuseColor.a == 0.0 ) discard;`,
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        // Thin paper scatters light straight through: light arriving at the
        // back face shows on the front, warmed and softened. It crosses the
        // dyed fibres on its way, so a coloured sheet glows deeper.
        vec3 throughTint = translucencyTint * diffuseColor.rgb;
        #if NUM_DIR_LIGHTS > 0
          for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
            float through = saturate( dot( -normal, directionalLights[ i ].direction ) );
            reflectedLight.directDiffuse += directionalLights[ i ].color * throughTint
              * diffuseColor.rgb * through * translucency * RECIPROCAL_PI;
          }
        #endif
        #if NUM_POINT_LIGHTS > 0
          for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
            vec3 toLight = pointLights[ i ].position - geometryPosition;
            float fall = getDistanceAttenuation( length( toLight ), pointLights[ i ].distance, pointLights[ i ].decay );
            float through = saturate( dot( -normal, normalize( toLight ) ) );
            reflectedLight.directDiffuse += pointLights[ i ].color * throughTint
              * diffuseColor.rgb * through * fall * translucency * RECIPROCAL_PI;
          }
        #endif`,
      );
  };
  return Object.assign(material, { creaseStart, folds, contact });
}
