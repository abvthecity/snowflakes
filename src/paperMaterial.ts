// Paper: a rough, faintly fibrous sheet that glows warm where light comes
// through it from behind. Built on MeshPhysicalMaterial so it takes the
// scene's image-based lighting, with a small shader patch for translucency.
import * as THREE from "three";

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

export function createPaperMaterial(mask: THREE.Texture): THREE.MeshPhysicalMaterial {
  const fibres = fibreTexture();
  const tint = fibres.clone();
  tint.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#fbfaf5"),
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
  material.onBeforeCompile = (shader) => {
    shader.uniforms.translucency = { value: 0.55 };
    shader.uniforms.translucencyTint = { value: new THREE.Color("#ffe2b8") };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float translucency;\nuniform vec3 translucencyTint;",
      )
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          diffuseColor.rgb *= mix( vec3( 0.93 ), vec3( 1.04 ), sampledDiffuseColor.r );
        #endif`,
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
        // back face shows on the front, warmed and softened.
        #if NUM_DIR_LIGHTS > 0
          for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
            float through = saturate( dot( -normal, directionalLights[ i ].direction ) );
            reflectedLight.directDiffuse += directionalLights[ i ].color * translucencyTint
              * diffuseColor.rgb * through * translucency * RECIPROCAL_PI;
          }
        #endif
        #if NUM_POINT_LIGHTS > 0
          for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
            vec3 toLight = pointLights[ i ].position - geometryPosition;
            float fall = getDistanceAttenuation( length( toLight ), pointLights[ i ].distance, pointLights[ i ].decay );
            float through = saturate( dot( -normal, normalize( toLight ) ) );
            reflectedLight.directDiffuse += pointLights[ i ].color * translucencyTint
              * diffuseColor.rgb * through * fall * translucency * RECIPROCAL_PI;
          }
        #endif`,
      );
  };
  return material;
}
