import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ThemePreset, WeatherMode } from '../lib/themes';
import {
  resolveQuality,
  QUALITY_SETTINGS,
  loadQualityChoice,
  MAX_DENSITY_SCALE,
  type QualityLevel,
} from '../lib/quality';

export type { WeatherMode } from '../lib/themes';

const ROW_D = 1.35; // road pattern row depth (shader-space)
const ROAD_COLS = 8; // segments across (incl. curbs)
const ROAD_SEGS = 110; // segments along
const ROAD_W = 3 * 2 * 1.2 + 2.4; // road + curb strips
const ROAD_LEN = ROAD_SEGS * ROW_D;
const SPAN = ROAD_LEN; // recycling span shared by roadside props

// ---------------------------------------------------------------------------
// 场景元素基准数量（BASE = medium 档密度 1.0 时的数量）。
//
// 运行时的「实际绘制数量」由画质档位的 densityScale 决定：
//   effective = max(MIN, round(BASE * densityScale))，并夹在 [MIN, MAX] 内；
//   MAX = round(BASE * MAX_DENSITY_SCALE)，即 high 档上限 —— 所有 InstancedMesh /
//   Points 的**容量一律按 MAX 预分配**，切档时只用 setDrawRange / scale=0 降级，
//   **绝不重建几何、不重分配数组**（见 docs/HANDOFF.md §2.4 硬约束）。
// ---------------------------------------------------------------------------
const BASE_GRASS_N = 760;
const BASE_REED_N = 110; // tall grass-spike variant（160 → 110：与 grass 同带内叠加时过密，读作「一片刺」）
const BASE_FLOWER_N = 210; // split across 3 head shapes (i % 3)
const BASE_TREE_N = 40;
const BASE_ROCK_N = 104;
const BASE_BUSH_N = 74;
const BASE_MUSH_N = 52;
const BASE_STUMP_N = 30;
const BASE_PUDDLE_N = 16;
const BASE_LAMP_N = 8;
const BASE_CLOUD_N = 9;
const BASE_FIREFLY_N = 90;
const BASE_BUTTERFLY_N = 4;
const BASE_BUILD_N = 34;
const BASE_NEON_N = 16;
const BASE_TRAFFIC_N = 3;
const BASE_PALM_N = 16;
const BASE_UMBRELLA_N = 7;
const BASE_SHELL_N = 26;
// P3 新增微细节层 —— 密度不足的真正补药：这些元素单体极小，
// 但紧贴已有植被/路面铺开，用「底层覆盖」把视觉密度抬起来（见 §13）。
const BASE_MOSS_N = 68; // L0：贴地苔藓/地衣片，压在草丛根部（宁少勿多：多了会读成「地上的碎块」）
const BASE_TALLGRASS_N = 34; // L3：芒草丛，远侧轮廓区（多则退化成「乱棍」，见 buildVegetation 的第四轮教训）
const BASE_CURB_N = 30; // 路缘石：给路面一条明确的路肩线（**单侧**数量，实际实例 = 2×）
const BASE_DECAL_N = 30; // 路面贴花：磨损/水渍，只压暗 5%~14% 的极淡平面片（宁少勿多）
// P4 路旁设施：让路边「有人用过」的痕迹，是把场景从「布景」变成「场所」的关键。
// 全部离线摆放（不自转、不脉动），只有 genFade 淡入淡出。
const BASE_BENCH_N = 12; // 长椅：面向道路，供「看风景」的叙事落点
const BASE_SIGN_N = 10; // 路牌：细杆 + 小方板
const BASE_FENCE_N = 14; // 篱笆：稀疏的矮栏分段，只作为「野地边界」的暗示，不连成围栏墙

/** high 档上限（= MAX_DENSITY_SCALE 倍），即所有实例 buffer 的预分配容量 */
const MAX_GRASS_N = Math.round(BASE_GRASS_N * MAX_DENSITY_SCALE);
const MAX_REED_N = Math.round(BASE_REED_N * MAX_DENSITY_SCALE);
const MAX_FLOWER_N = Math.round(BASE_FLOWER_N * MAX_DENSITY_SCALE);
const MAX_TREE_N = Math.round(BASE_TREE_N * MAX_DENSITY_SCALE);
const MAX_ROCK_N = Math.round(BASE_ROCK_N * MAX_DENSITY_SCALE);
const MAX_BUSH_N = Math.round(BASE_BUSH_N * MAX_DENSITY_SCALE);
const MAX_MUSH_N = Math.round(BASE_MUSH_N * MAX_DENSITY_SCALE);
const MAX_STUMP_N = Math.round(BASE_STUMP_N * MAX_DENSITY_SCALE);
const MAX_PUDDLE_N = Math.round(BASE_PUDDLE_N * MAX_DENSITY_SCALE);
const MAX_LAMP_N = Math.round(BASE_LAMP_N * MAX_DENSITY_SCALE);
const MAX_CLOUD_N = Math.round(BASE_CLOUD_N * MAX_DENSITY_SCALE);
const MAX_FIREFLY_N = Math.round(BASE_FIREFLY_N * MAX_DENSITY_SCALE);
const MAX_BUTTERFLY_N = Math.round(BASE_BUTTERFLY_N * MAX_DENSITY_SCALE);
const MAX_BUILD_N = Math.round(BASE_BUILD_N * MAX_DENSITY_SCALE);
const MAX_NEON_N = Math.round(BASE_NEON_N * MAX_DENSITY_SCALE);
const MAX_TRAFFIC_N = Math.round(BASE_TRAFFIC_N * MAX_DENSITY_SCALE);
const MAX_PALM_N = Math.round(BASE_PALM_N * MAX_DENSITY_SCALE);
const MAX_UMBRELLA_N = Math.round(BASE_UMBRELLA_N * MAX_DENSITY_SCALE);
const MAX_SHELL_N = Math.round(BASE_SHELL_N * MAX_DENSITY_SCALE);
const MAX_MOSS_N = Math.round(BASE_MOSS_N * MAX_DENSITY_SCALE);
const MAX_TALLGRASS_N = Math.round(BASE_TALLGRASS_N * MAX_DENSITY_SCALE);
const MAX_CURB_N = Math.round(BASE_CURB_N * MAX_DENSITY_SCALE); // 单侧上限；mesh 容量为 2×
const MAX_DECAL_N = Math.round(BASE_DECAL_N * MAX_DENSITY_SCALE);
const MAX_BENCH_N = Math.round(BASE_BENCH_N * MAX_DENSITY_SCALE);
const MAX_SIGN_N = Math.round(BASE_SIGN_N * MAX_DENSITY_SCALE);
const MAX_FENCE_N = Math.round(BASE_FENCE_N * MAX_DENSITY_SCALE); // 单侧上限；mesh 容量为 2×

/** low 档下限：保证任何元素都不会稀到「看不见」 */
const MIN_DENSITY = 0.6;

/** 冰凌数 = 灯柱上限（每盏灯挂一串），容量按上限预分配 */
const ICICLE_N = MAX_LAMP_N;
/**
 * 接触阴影实例数：
 *   slot 0 = 角色主影（内层，深）
 *   slot 1 = 角色副影（P6 外层，大而淡 → 双层椭圆更像软阴影）
 *   slot 2.. = 近处路灯在路面上的长条影（每盏 1 条，按灯柱上限预分配）
 */
const CONTACT_SHADOW_N = 2 + MAX_LAMP_N;
/** 雪面脚印环槽数：左右交替，共 2×N 个印子；N 越大足迹越远越长 */
const FOOTPRINT_N = 18;

const LAMP_H = 3.6;
const TREE_SPAN = 260;
const METEOR_N = 3;
// GPU-driven falling particle counts (zero per-frame CPU) —— 天气粒子不随密度缩放，
// 它们的量级由天气强度（uIntensity）驱动，与场景「静物密度」是两回事。
const PETAL_N = 520;
const LEAF_N = 420;
const SNOW_N = 1300;
const RAIN_N = 1000;
/** wind weather streak count */
const STREAK_N = 260;
const MTN_W = 360; // width of one ridge tile
const MTN_K = [0.055, 0.035, 0.02]; // parallax rate per layer
const MTN_Z = [-64, -92, -122]; // depth behind the walker per layer
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
/** deterministic 2-seed hash for per-cycle variation */
function hash2(a: number, b: number) {
  return hash(a * 17.13 + b * 91.7);
}

interface Lamp {
  group: THREE.Group;
  glow: THREE.Sprite; // inner hot halo
  glowOuter: THREE.Sprite; // large soft bloom shell
  glowFar: THREE.Sprite; // P6 最外层雾状光晕（半径 8，最淡）
  spot: THREE.Sprite; // warm pool of light on the ground
  cone: THREE.Mesh;
  side: number;
  slot: number;
}

export class VoxelWorld {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  /** 由 buildComposer() 赋值（构造函数与 setQuality 共用），故用 ! 断言 */
  composer!: EffectComposer;
  bloom!: UnrealBloomPass;
  /** 当前画质档位（构造时按设备探测，可由 setQuality 覆盖） */
  quality: QualityLevel = 'medium';
  /** 雾密度/曝光呼吸开关（由画质档位决定，low 关闭） */
  private fogBreath = true;
  /** 接触阴影层（角色/道具根部的低成本假阴影），low 档隐藏 */
  private contactShadows: THREE.InstancedMesh | null = null;
  /** project() 复用实例（避免每帧分配） */
  private projectV = new THREE.Vector3();
  /** setTheme 里 lerp 到 snowCap 的复用色对象（避免逐次 new THREE.Color） */
  private snowCapColor = new THREE.Color('#ffffff');

  private ambient: THREE.AmbientLight;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private charLight: THREE.PointLight;
  private character = new THREE.Group();
  private charCore!: THREE.Mesh;
  private charHalo!: THREE.Sprite;

  private road!: THREE.Mesh;
  // road shader uniforms (shared objects, mutated per frame — zero allocation)
  private roadU = {
    uDist: { value: 0 },
    uPulse: { value: 0 },
    uCharZ: { value: 0 },
    uT: { value: 0 },
    uSnow: { value: 0 },
    uMoss: { value: 0 }, // spring: grass grows in the slab gaps
    uLeaf: { value: 0 }, // autumn: fallen-leaf speckles on the slabs
    uZebra: { value: 0 }, // city: zebra-crossing stripes
    uRoadCols: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()] },
    uCurbCols: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] },
    // 路灯在地面的光池：每盏灯的 (x, z, 强度)，由 update() 每帧写入。
    // 数组容量按 LAMP 上限预分配，shader 里的循环也按上限展开（多余槽强度恒 0）。
    uLampX: { value: new Float32Array(MAX_LAMP_N) },
    uLampZ: { value: new Float32Array(MAX_LAMP_N) },
    uLampI: { value: new Float32Array(MAX_LAMP_N) },
    uLampCol: { value: new THREE.Color('#ffc98a') },
  };

  // ---------------------------------------------------------------------------
  // 场景元素「实际绘制数量」：由画质档位 densityScale 决定，切档时重算，
  // 但 buffer 容量恒为 MAX_*（不重建）。所有 update() 循环与 slot() 都以这些字段为准。
  // ---------------------------------------------------------------------------
  private grassN = BASE_GRASS_N;
  private reedN = BASE_REED_N;
  private flowerN = BASE_FLOWER_N;
  private treeN = BASE_TREE_N;
  private rockN = BASE_ROCK_N;
  private bushN = BASE_BUSH_N;
  private mushN = BASE_MUSH_N;
  private stumpN = BASE_STUMP_N;
  private puddleN = BASE_PUDDLE_N;
  private lampN = BASE_LAMP_N;
  private cloudN = BASE_CLOUD_N;
  private butterflyN = BASE_BUTTERFLY_N;
  private buildN = BASE_BUILD_N;
  private neonN = BASE_NEON_N;
  private trafficN = BASE_TRAFFIC_N;
  private palmN = BASE_PALM_N;
  private umbrellaN = BASE_UMBRELLA_N;
  private shellN = BASE_SHELL_N;
  // P3 微细节层
  private mossN = BASE_MOSS_N;
  private tallGrassN = BASE_TALLGRASS_N;
  private curbN = BASE_CURB_N;
  private decalN = BASE_DECAL_N;
  // P4 路旁设施
  private benchN = BASE_BENCH_N;
  private signN = BASE_SIGN_N;
  private fenceN = BASE_FENCE_N;
  /** 当前档位密度是否允许「新增细节层」（low 档为 false → 新增元素全部隐藏） */
  private extras = true;

  private grass!: THREE.InstancedMesh;
  private reeds!: THREE.InstancedMesh;
  private stems!: THREE.InstancedMesh;
  private heads!: THREE.InstancedMesh;
  private petalHeads!: THREE.InstancedMesh; // five-petal blossoms
  private bellHeads!: THREE.InstancedMesh; // drooping bell flowers
  private trunks!: THREE.InstancedMesh;
  private canopyLow!: THREE.InstancedMesh;
  private canopyTop!: THREE.InstancedMesh;
  private pines!: THREE.InstancedMesh; // upright fir variant (merged triple cone)
  private snowCaps!: THREE.InstancedMesh; // white caps on canopies (winter)
  private rocks!: THREE.InstancedMesh;
  private bushes!: THREE.InstancedMesh;
  private mushrooms!: THREE.InstancedMesh;
  private stumps!: THREE.InstancedMesh;
  private puddles!: THREE.InstancedMesh;
  private puddleMat!: THREE.MeshStandardMaterial;
  // P3 微细节层：贴地苔藓 / 高杆芒草 / 路缘石 / 路面贴花
  private mosses!: THREE.InstancedMesh;
  private tallGrass!: THREE.InstancedMesh;
  private curbs!: THREE.InstancedMesh;
  private decals!: THREE.InstancedMesh;
  // P4 路旁设施：长椅 / 路牌 / 篱笆（全部 InstancedMesh）
  private benches!: THREE.InstancedMesh;
  private signs!: THREE.InstancedMesh;
  private fences!: THREE.InstancedMesh;
  // P4 远景剪影带：贴在山脊之外的水平长条（随距离极慢视差），把「世界有边界」补上
  private farTreeLine!: THREE.Mesh;
  private farTreeMats: THREE.MeshBasicMaterial[] = [];
  // P5 雪面脚印：角色走过留在雪上的两行凹痕（纯静态实例，位置由 distance 决定）
  private footprints!: THREE.InstancedMesh;
  // P5 灯下微尘：每盏灯的锥体里缓慢浮动的细小尘埃点（Points，纯 GPU 驱动）
  private dust!: THREE.Points;
  private dustU!: {
    uT: { value: number };
    uOpacity: { value: number };
    uColor: { value: THREE.Color };
    uSpanY: { value: number };
  };
  // GPU falling-particle systems (petals / leaves / snow / rain) — pure shader motion
  private petals!: THREE.Points;
  private leaves!: THREE.Points;
  private snow!: THREE.Points;
  private rain!: THREE.Points;
  private streaks!: THREE.Points; // wind-only horizontal streak system
  private petalU: any;
  private leafU: any;
  private snowU: any;
  private rainU: any;
  private streakU!: ReturnType<VoxelWorld['makeFallSystem']>['uniforms'];
  // weather state machine
  private weatherMode: WeatherMode = 'auto';
  private effWeather: Exclude<WeatherMode, 'auto'> = 'petals';
  private wI = { petals: 0, leaves: 0, snow: 0, rain: 0, wind: 0, streaks: 0 }; // smoothed intensities
  private wT = { petals: 0, leaves: 0, snow: 0, rain: 0, wind: 0, streaks: 0 }; // targets
  // city props
  private buildings!: THREE.InstancedMesh;
  private buildSeed = new Float32Array(MAX_BUILD_N * 3);
  private neon!: THREE.InstancedMesh;
  private neonSeed = new Float32Array(MAX_NEON_N * 3);
  private traffic: THREE.Group[] = [];
  private trafficMats: THREE.MeshBasicMaterial[][] = []; // [light][r,y,g]
  // beach props
  private sea!: THREE.Mesh;
  private seaU: any;
  private palms!: THREE.InstancedMesh;
  private fronds!: THREE.InstancedMesh;
  private palmSeed = new Float32Array(MAX_PALM_N * 3);
  private umbrellas!: THREE.InstancedMesh;
  private umbrellaSeed = new Float32Array(MAX_UMBRELLA_N * 3);
  private shells!: THREE.InstancedMesh;
  private starfish!: THREE.InstancedMesh;
  private shellSeed = new Float32Array(MAX_SHELL_N * 3);
  private icicles!: THREE.InstancedMesh;
  private mapKind: 'nature' | 'city' | 'beach' = 'nature';
  private stars!: THREE.Points;
  private fireflies!: THREE.Points;
  private fireflyUniforms: any;
  private clouds: THREE.Group[] = [];
  private cloudMats: THREE.MeshStandardMaterial[] = [];
  private cloudSeed = new Float32Array(MAX_CLOUD_N * 4);
  private lamps: Lamp[] = [];
  private lampGlowBoost = 1;
  private lampPoleMat!: THREE.MeshStandardMaterial;
  private lampHeadMat!: THREE.MeshStandardMaterial;
  private skyDome!: THREE.Mesh;
  private skyUniforms: any;
  private ground!: THREE.Mesh;
  // distant ridge silhouettes: 3 layers × 2 wrap tiles
  private mountains: THREE.Mesh[] = [];
  private mountainMats: THREE.MeshBasicMaterial[] = [];
  private mountainRidgeMats: THREE.MeshBasicMaterial[] = [];
  // celestial body (sun glow / sunset disc / moon) + halo
  private celestial!: THREE.Group;
  private celestialDisc!: THREE.Mesh;
  private celestialGlow!: THREE.Sprite;
  // winter-only sky dressing
  private aurora!: THREE.Mesh;
  private auroraUniforms: any;
  private meteors: THREE.Mesh[] = [];
  private meteorMats: THREE.MeshBasicMaterial[] = [];
  // spring-only butterflies
  private butterflies: THREE.Group[] = [];
  private butterflyWings: THREE.Mesh[] = []; // 2 per butterfly, L then R
  private breaths: THREE.Sprite[] = []; // winter breath-mist puffs
  private frame = 0; // parity counter for staggered far-instance updates

  private grassSeed = new Float32Array(MAX_GRASS_N * 3);
  private reedSeed = new Float32Array(MAX_REED_N * 3);
  private flowerSeed = new Float32Array(MAX_FLOWER_N * 3);
  private treeSeed = new Float32Array(MAX_TREE_N * 3);
  private rockSeed = new Float32Array(MAX_ROCK_N * 3);
  private bushSeed = new Float32Array(MAX_BUSH_N * 3);
  private mushSeed = new Float32Array(MAX_MUSH_N * 3);
  private stumpSeed = new Float32Array(MAX_STUMP_N * 3);
  private puddleSeed = new Float32Array(MAX_PUDDLE_N * 3);
  private mossSeed = new Float32Array(MAX_MOSS_N * 3);
  private tallGrassSeed = new Float32Array(MAX_TALLGRASS_N * 3);
  private curbSeed = new Float32Array(MAX_CURB_N * 3);
  private decalSeed = new Float32Array(MAX_DECAL_N * 3);
  private benchSeed = new Float32Array(MAX_BENCH_N * 3);
  private signSeed = new Float32Array(MAX_SIGN_N * 3);
  private fenceSeed = new Float32Array(MAX_FENCE_N * 3);

  private distance = 0;
  private speed = 3.1;
  private t = 0;
  private smoothBass = 0;
  private theme!: ThemePreset;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // 画质档位必须在建 composer 之前确定（决定 MSAA samples）
    this.quality = resolveQuality(loadQualityChoice());
    this.fogBreath = QUALITY_SETTINGS[this.quality].fogBreath;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    // ACES 色调映射：与 OutputPass 配合，把线性 HDR 结果映射到 sRGB 显示空间。
    // 修复前（无 toneMapping / 无 OutputPass）composer 路径不做 sRGB 输出转换 → 画面偏暗偏灰。
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0; // 实际值由主题 exposure 决定（见 setTheme）
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    this.camera.position.set(0, 5.0, 8.6);
    this.camera.lookAt(0, 1.4, -8);

    this.ambient = new THREE.AmbientLight('#ffffff', 0.42);
    this.sun = new THREE.DirectionalLight('#ffd9a0', 1.15);
    this.sun.position.set(6, 12, 5);
    // 半球补光：天空色打顶、地面色反底。让两侧植被/岩石脱离「纯黑剪影」，
    // 同时保留明暗梯度（AmbientLight 做这件事会把画面压平）。
    this.hemi = new THREE.HemisphereLight('#bcd7ff', '#3a4a3e', 0.55);
    this.charLight = new THREE.PointLight('#ffd98a', 2.4, 13, 2.0);
    this.charLight.position.set(0, 1.6, 0);
    this.scene.add(this.ambient, this.sun, this.hemi, this.charLight);

    this.buildSky();
    this.buildMountains();
    this.buildFarLine();
    this.buildRoad();
    this.buildVegetation();
    this.buildLamps();
    this.buildCharacter();
    this.buildContactShadows();
    this.buildFootprints();
    this.buildDust();
    this.buildClouds();
    this.buildFireflies();
    this.buildCelestial();
    this.buildAurora();
    this.buildMeteors();
    this.buildButterflies();

    // stars (visible at night)
    const starGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) {
      const a = hash(i) * Math.PI * 2;
      const e = hash(i + 999) * Math.PI * 0.45 + 0.08;
      const r = 180;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      pos[i * 3 + 1] = Math.sin(e) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: '#cfe2ff', size: 0.7, transparent: true, opacity: 0, sizeAttenuation: true })
    );
    this.scene.add(this.stars);

    this.buildFallSystems();
    this.buildCity();
    this.buildBeach();
    this.buildIcicles();

    // 后处理链：RenderPass → UnrealBloom → OutputPass（sRGB 输出 + tone mapping 落地）。
    this.buildComposer();
    // 初始档位的场景元素密度（含 low 档隐藏新增层）——先算，applyDecorDensity 依赖 this.extras
    this.applyDensity();
    // 初始档位的装饰密度也要生效（默认 1.0 时无变化，低档位才会裁剪）
    this.applyDecorDensity();
    this.resize();
  }

  /**
   * 构建后处理链。构造函数与 setQuality() 共用，避免两处实现漂移。
   *
   * 性能要点（实测教训）：本机 16 核/16GB 但配 Radeon 520（2016 入门独显），
   * 原实现无条件开 HalfFloat + samples=4，fill 开销约为无 MSAA 的 4~5 倍 → 严重掉帧。
   * 现在按档位严格分级：
   * - MSAA 仅在档位要求时开启（low 关闭 / medium 2x / high 4x）
   * - HalfFloat HDR 仅在 high 开启（每像素带宽翻倍，对入门卡不可接受）
   * - bloom 内部 RT 分辨率按档位缩放（半分辨率省约 75% 填充）
   */
  private buildComposer(): void {
    if (this.composer) this.composer.dispose();

    const qs = QUALITY_SETTINGS[this.quality];
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: qs.hdrHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples: qs.msaaSamples,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // bloom 的实际分辨率由 applyBloomResolution() 在 resize() 末尾按档位设定
    // （UnrealBloomPass.setSize 会覆盖构造参数，故此处传 1×1 占位即可）
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.78);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  // ---------- builders ----------
  private buildSky() {
    this.skyUniforms = {
      top: { value: new THREE.Color('#0a0a0a') },
      bottom: { value: new THREE.Color('#0a0a0a') },
      // P6 地平线层：天空不再是「上→下」两段线性混合，而是「顶色 → 地平线雾色 → 底色」
      // 三段。中间这一层（mistColor）是让天际线「有厚度」的关键——日出/黄昏时
      // 地平线附近会堆一层暖雾，这是真实天空最强的辨识特征。
      mist: { value: new THREE.Color('#0a0a0a') },
      horizonSharp: { value: 0.75 },
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: this.skyUniforms,
      vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      // 天空占据画面最大面积，必须与标准材质走同一条色彩管线：
      // 先 tonemapping（ACES）再 linear→sRGB，否则天空会明显比地面「亮一档」且发灰。
      //
      // 注意：**不要**再手写 #include <colorspace_pars_fragment> / <tonemapping_pars_fragment>。
      // ShaderMaterial 的 fragment 前缀里 three 已经注入过这些 *_pars_* 函数，
      // 重复 include 会导致着色器编译失败（实测报 "function already has a body"）。
      // 这里只需要在 gl_FragColor 赋值之后调用 *_fragment 段。
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 mist; uniform float horizonSharp;
        varying vec3 vP;
        void main(){
          float h = normalize(vP).y * 0.5 + 0.5;
          // 第一段：底色 → 地平线雾色（收在 h≈0.5 附近，即真正的地平线高度）
          vec3 col = mix(bottom, mist, smoothstep(0.34, 0.52, h));
          // 第二段：雾色 → 顶色，过渡锐度由 horizonSharp 控制（越大天际线越硬）
          col = mix(col, top, smoothstep(0.52, 0.52 + horizonSharp * 0.36, h));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(220, 24, 16), mat);
    this.scene.add(this.skyDome);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(420, 340),
      new THREE.MeshStandardMaterial({ color: '#131b31', roughness: 1 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(0, -0.52, -110);
    this.scene.add(this.ground);
  }

  /**
   * Distant mountain ridges: 3 silhouette layers (ShapeGeometry strips), each with
   * 2 tiles that wrap horizontally as a pure f(distance) — extremely slow lateral
   * parallax. MeshBasicMaterial + scene fog gives the "fading into mist" look.
   */
  private buildMountains() {
    const layerH = [15, 23, 31];
    for (let l = 0; l < 3; l++) {
      const shape = new THREE.Shape();
      shape.moveTo(0, -3);
      const peaks = 14;
      let x = 0;
      for (let p = 0; p < peaks; p++) {
        const w = (MTN_W / peaks) * (0.75 + hash(l * 31 + p * 7.7) * 0.5);
        const h = layerH[l] * (0.45 + hash(l * 13.3 + p * 3.1) * 0.9);
        shape.lineTo(x + w * 0.5, h);
        shape.lineTo(x + w, -3 + hash(l * 5.1 + p) * 2.5);
        x += w;
      }
      shape.lineTo(MTN_W + 40, -3);
      shape.lineTo(MTN_W + 40, -6);
      shape.lineTo(0, -6);
      const geo = new THREE.ShapeGeometry(shape);
      const mat = new THREE.MeshBasicMaterial({ color: '#223052', fog: true, side: THREE.DoubleSide });
      this.mountainMats.push(mat);
      for (let tile = 0; tile < 2; tile++) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(-tile * MTN_W, -0.4, MTN_Z[l]);
        m.userData.layer = l;
        m.userData.tile = tile;
        this.scene.add(m);
        this.mountains.push(m);
      }
    }
    // 亮面描边：与剪影同形，略微上移/放大，用更亮的同色系压出「山脊受光」层次。
    // 用顶点着色无法做渐变，这里靠同形叠色 + polygonOffset 实现低成本分层。
    for (let l = 0; l < 3; l++) {
      const shape = new THREE.Shape();
      shape.moveTo(0, -3);
      const peaks = 14;
      let x = 0;
      for (let p = 0; p < peaks; p++) {
        const w = (MTN_W / peaks) * (0.75 + hash(l * 31 + p * 7.7) * 0.5);
        const h = layerH[l] * (0.45 + hash(l * 13.3 + p * 3.1) * 0.9);
        // 山脊线内收：只保留峰顶以上的一小段，模拟被光照亮的棱线
        shape.lineTo(x + w * 0.5, h);
        shape.lineTo(x + w * 0.5, h - layerH[l] * 0.12);
        x += w;
      }
      const geo = new THREE.ShapeGeometry(shape);
      const mat = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        fog: true,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
      });
      this.mountainRidgeMats.push(mat);
      for (let tile = 0; tile < 2; tile++) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(-tile * MTN_W, -0.4, MTN_Z[l] + 0.5);
        this.scene.add(m);
        this.mountains.push(m);
      }
    }
  }

  /**
   * P4 远景剪影带 —— 山脊之外再压一层「树线 / 楼线」。
   *
   * 为什么放在山之后：山脊是纯几何剪影，与道路之间没有任何「中间景」，
   * 视觉上纵深会断掉（山像是贴在天空上的贴纸）。补一条更远、更低的
   * 锯齿剪影带，夹在山脊与雾之间，纵深立刻由「两层」变成「三层」。
   *
   * 实现与 mountains 同构（两个 tile 横向循环），但：
   *   - Z 更远（-160），因此雾的衰减更重，更像「雾里的轮廓」
   *   - 高度更低、齿更密更碎（模拟树冠／远处楼群的连续起伏）
   *   - 视差系数极小（0.06），几乎不随行走移动，强化「极远」感
   */
  private buildFarLine() {
    const W = 420;
    const shape = new THREE.Shape();
    shape.moveTo(0, -4);
    const teeth = 96; // 齿足够密才能读出「树线」而不是第二座山
    let x = 0;
    for (let p = 0; p < teeth; p++) {
      const w = (W / teeth) * (0.7 + hash(p * 3.7 + 9) * 0.6);
      // 大部分齿很矮（~2-5），偶发高齿（~9-14）模拟大树/高楼
      const spike = hash(p * 5.1 + 21) > 0.86;
      const h = spike ? 9 + hash(p * 7.3) * 6 : 2 + hash(p * 9.1) * 3.2;
      shape.lineTo(x + w * 0.4, h);
      shape.lineTo(x + w, 0.4 + hash(p * 11.3 + 3) * 1.6);
      x += w;
    }
    shape.lineTo(W + 60, -4);
    shape.lineTo(W + 60, -8);
    shape.lineTo(0, -8);
    const geo = new THREE.ShapeGeometry(shape);
    // 颜色由 setTheme 按主题写入（见 farTreeMats 使用处），初值给一个中性雾色
    const mat = new THREE.MeshBasicMaterial({ color: '#2b3a55', fog: true, side: THREE.DoubleSide });
    this.farTreeMats.push(mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, -1, -160);
    this.farTreeLine = m;
    this.scene.add(m);
  }

  /** sun glow (spring) / big sunset disc (autumn) / moon (winter), follows the walker */
  private buildCelestial() {
    this.celestial = new THREE.Group();
    this.celestialDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 28),
      new THREE.MeshBasicMaterial({ color: '#fff3c8', fog: false, transparent: true, opacity: 0.95 })
    );
    this.celestialGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: '#ffe9a8',
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      })
    );
    this.celestial.add(this.celestialGlow, this.celestialDisc);
    this.scene.add(this.celestial);
  }

  /** winter aurora: one large additive shader plane high in the sky, fully GPU-driven */
  private buildAurora() {
    this.auroraUniforms = {
      uT: { value: 0 },
      uOpacity: { value: 0 },
      uColA: { value: new THREE.Color('#37ffa8') },
      uColB: { value: new THREE.Color('#3fc8ff') },
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: this.auroraUniforms,
      vertexShader: `
        uniform float uT;
        varying vec2 vUv;
        void main(){
          vUv = uv;
          vec3 p = position;
          p.y += sin(uv.x * 9.0 + uT * 0.35) * 3.0 + sin(uv.x * 3.1 - uT * 0.18) * 4.5;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform float uT; uniform float uOpacity; uniform vec3 uColA; uniform vec3 uColB;
        varying vec2 vUv;
        void main(){
          float band = sin(vUv.x * 14.0 + uT * 0.5 + sin(vUv.x * 4.0 - uT * 0.23) * 2.0) * 0.5 + 0.5;
          float curtain = smoothstep(0.05, 0.45, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
          float streaks = 0.55 + 0.45 * sin(vUv.x * 47.0 + uT * 0.7);
          vec3 col = mix(uColA, uColB, band);
          float a = uOpacity * curtain * (0.35 + 0.65 * band) * streaks;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.aurora = new THREE.Mesh(new THREE.PlaneGeometry(200, 42, 48, 1), mat);
    this.aurora.position.set(0, 52, 0);
    this.scene.add(this.aurora);
  }

  /** sparse meteors (winter): thin additive streaks, activation window is a pure f(t) */
  private buildMeteors() {
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < METEOR_N; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: '#cfe4ff',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(7, 0.09, 1);
      m.rotation.z = -0.5;
      this.scene.add(m);
      this.meteors.push(m);
      this.meteorMats.push(mat);
    }
  }

  /** spring butterflies: 2-triangle flapping wings, wandering along the roadside */
  private buildButterflies() {
    const wingGeo = new THREE.PlaneGeometry(0.36, 0.27);
    wingGeo.translate(0.18, 0, 0); // hinge at inner edge
    for (let i = 0; i < MAX_BUTTERFLY_N; i++) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: '#ffd9ec', side: THREE.DoubleSide });
      const wl = new THREE.Mesh(wingGeo, mat);
      const wr = new THREE.Mesh(wingGeo, mat);
      wr.rotation.y = Math.PI;
      g.add(wl, wr);
      g.visible = false;
      this.scene.add(g);
      this.butterflies.push(g);
      this.butterflyWings.push(wl, wr);
    }
  }

  /**
   * Road: a static segmented plane. All motion / jitter / coloring happens in the
   * vertex shader as a pure function of uDist (world offset), so the surface is
   * perfectly continuous — no vertex uploads, no snapping, zero per-frame CPU work.
   */
  private buildRoad() {
    const geo = new THREE.PlaneGeometry(ROAD_W, ROAD_LEN, ROAD_COLS, ROAD_SEGS);
    geo.rotateX(-Math.PI / 2);
    const count = geo.attributes.position.count;
    // dummy color attribute so USE_COLOR is defined; real colors come from uniforms
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.92,
      metalness: 0.02,
      flatShading: true,
      vertexColors: true,
    });
    const U = this.roadU;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      // Vertex stage: world z/x + curb flag varyings + slab-row jitter displacement.
      // Fragment stage: irregular stone-slab pattern (dark gaps, per-slab tint) with
      // seasonal dressing — mossy gaps (spring), leaf speckles (autumn), snow cover
      // (winter). All pure functions of world position — continuous, zero CPU work.
      shader.vertexShader =
        `uniform float uDist; uniform float uCharZ; uniform float uSnow;
         float rhash(float n){ return fract(sin(n*127.1+311.7)*43758.5453); }
         varying float vWZ; varying float vWX; varying float vCurb; varying float vJit;\n` +
        shader.vertexShader
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             vWZ = position.z - uDist + (${(10 - ROAD_LEN / 2).toFixed(3)});
             vWX = position.x;
             vCurb = step(${((3 * 1.2 + 0.6)).toFixed(2)}, abs(position.x));
             // 行号先对 4096 取模再喂给 hash：sin 的参数必须保持「小」，
             // 否则长距离行走后（row ~ 1e6）float32 的 ULP 会让 sin 变成常数/噪点，
             // 石板纹理整体塌成平色。详见 ROAD_ROW_MOD 注释。
             float wRow = mod(floor(-vWZ / ${ROW_D.toFixed(3)}), 4096.0);
             vJit = rhash(wRow * 31.0 + position.x * 7.31);
             transformed.y = -0.25 + vJit * 0.07 + vCurb * 0.14;`
          )
          .replace(
            '#include <color_vertex>',
            `#include <color_vertex>
             vColor.rgb = vec3(1.0);`
          );
      shader.fragmentShader =
        `uniform float uPulse; uniform float uCharZ; uniform float uT; uniform float uSnow;
         uniform float uMoss; uniform float uLeaf; uniform float uZebra;
         uniform vec3 uRoadCols[4]; uniform vec3 uCurbCols[3];
         uniform float uLampX[${MAX_LAMP_N}]; uniform float uLampZ[${MAX_LAMP_N}];
         uniform float uLampI[${MAX_LAMP_N}]; uniform vec3 uLampCol;
         float frhash(float n){ return fract(sin(n*127.1+311.7)*43758.5453); }
         varying float vWZ; varying float vWX; varying float vCurb; varying float vJit;\n` +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           {
             // 真实行号（可能达 1e6）只用于取值域内的小量，喂 hash 前先 mod 4096，
             // 否则 float32 的 sin 参数失真 → 石板花纹塌成平色（长距离行走后可见）。
             float rowRaw = floor(-vWZ / ${ROW_D.toFixed(3)});
             float row = mod(rowRaw, 4096.0);
             float fv = fract(-vWZ / ${ROW_D.toFixed(3)});
             // irregular slabs: each row offset by its own hash, widths vary per slab
             float rowOff = frhash(row * 3.7 + 5.1) * 2.4;
             float slabW = 0.95 + frhash(row * 11.3) * 0.5;
             float fx = (vWX + rowOff) / slabW;
             float slab = floor(fx);
             float fu = fract(fx);
             float sh = frhash(row * 17.0 + slab * 7.31);
             vec3 base = sh < 0.25 ? uRoadCols[0] : sh < 0.5 ? uRoadCols[1] : sh < 0.75 ? uRoadCols[2] : uRoadCols[3];
             base *= 0.9 + 0.2 * frhash(slab * 3.1 + row * 1.7); // per-slab tone
             // dark joints between slabs (soft 2-3cm bevel)
             float joint = smoothstep(0.0, 0.055, fu) * smoothstep(1.0, 0.945, fu)
                         * smoothstep(0.0, 0.09, fv) * smoothstep(1.0, 0.91, fv);
             vec3 jointCol = base * 0.32;
             // spring: moss / grass creeps into the joints
             float mossH = frhash(slab * 5.7 + row * 9.1);
             jointCol = mix(jointCol, vec3(0.32, 0.48, 0.24) * (0.8 + 0.4 * mossH), uMoss * step(0.35, mossH));
             vec3 col = mix(jointCol, base, joint);
             // autumn: sparse fallen-leaf speckles sitting on the slabs
             float leafH = frhash(row * 31.7 + slab * 13.3);
             float leafMask = step(0.8, leafH) * joint * smoothstep(0.35, 0.75, frhash(slab * 2.3 + row));
             vec3 leafCol = mix(vec3(0.85, 0.48, 0.16), vec3(0.72, 0.3, 0.12), frhash(slab + row * 3.0));
             col = mix(col, leafCol, uLeaf * leafMask * 0.85);
             // winter: snow blankets the slabs, joints stay dark and peek through
             float cov = uSnow * (0.4 + 0.55 * frhash(slab * 5.3 + row * 2.1));
             col = mix(col, vec3(0.86, 0.9, 0.98), cov * joint);
             col = mix(col, vec3(0.35, 0.38, 0.48), uSnow * (1.0 - joint) * 0.5);
             // curbs keep their own palette, snow-dusted in winter
             float hCurb = frhash(row * 13.0 + vWX * 7.31);
             vec3 ccol = hCurb < 0.34 ? uCurbCols[0] : hCurb < 0.67 ? uCurbCols[1] : uCurbCols[2];
             ccol = mix(ccol, vec3(0.88, 0.92, 1.0), uSnow * 0.55);
             col = mix(col, ccol, vCurb);
             // city: zebra-crossing bands across the roadway every few rows
             float zb = step(fract(-vWZ / 9.0), 0.22) * step(fract(vWX / 1.15), 0.55) * (1.0 - vCurb);
             col = mix(col, vec3(0.82, 0.84, 0.88), uZebra * zb * 0.85);
             // gentle light breathing + bass glow around the walker
             float breathe = 0.96 + 0.05 * sin(uT * 0.8 + row * 0.7);
             float nearGlow = uPulse * 0.22 * exp(-abs(vWZ - uCharZ) * 0.12);
             // 涟漪：从角色脚下向外扩散的同心环，随节拍增亮。
             // 用 -vWZ（前进轴）与 vWX 的径向距离，环带用 sin 相位差做软边。
             // P5：3 环 → 5 环（环数必须与 shader 常量一致；5 环在低档也便宜，
             // 因为它只是每片元多 2 次 sin，而涟漪本身已是「最便宜的高频细节」）。
             float dChar = length(vec2(vWX * 0.85, (vWZ - uCharZ) * 0.5));
             float ripple = 0.0;
             for (int k = 0; k < 5; k++) {
               float ph = uT * 1.15 - float(k) * 0.72;
               float ring = sin(dChar * 1.35 - ph * 6.2831);
               // 软环：只保留波峰附近，且随半径衰减
               ripple += smoothstep(0.55, 1.0, ring) * exp(-dChar * 0.28);
             }
             float rippleAmt = ripple * (0.05 + uPulse * 0.14);
             // 路灯光池：逐盏累加椭圆软光斑（世界坐标距离），让路面真正「被灯照到」。
             // 只有近处几盏对当前片元有贡献，衰减很快所以在 shader 里全遍历 8 盏也很便宜。
             float lampAcc = 0.0;
             for (int li = 0; li < ${MAX_LAMP_N}; li++) {
               vec2 d = vec2((vWX - uLampX[li]) * 0.62, (vWZ - uLampZ[li]) * 0.95);
               float r2 = dot(d, d);
               lampAcc += uLampI[li] / (1.0 + r2 * 0.9);
             }
             vec3 lampWash = uLampCol * lampAcc * 0.16;
             diffuseColor.rgb = col * breathe + nearGlow + rippleAmt * vec3(0.55, 0.72, 1.0) + lampWash;
           }`
        );
    };
    this.road = new THREE.Mesh(geo, mat);
    this.road.frustumCulled = false;
    this.scene.add(this.road);
  }

  private buildVegetation() {
    const flat = (rough = 0.9) =>
      new THREE.MeshStandardMaterial({ roughness: rough, flatShading: true });

    // grass tufts — three crossed blades (rounded quads), no cones
    const blade = new THREE.PlaneGeometry(0.16, 0.5);
    blade.translate(0, 0.25, 0);
    const b2 = blade.clone();
    b2.rotateY((Math.PI / 3) * 1);
    const b3 = blade.clone();
    b3.rotateY((Math.PI / 3) * 2);
    const grassGeo = mergeGeometries([blade, b2, b3])!;
    const grassMat = new THREE.MeshStandardMaterial({
      roughness: 0.9,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    this.grass = new THREE.InstancedMesh(grassGeo, grassMat, MAX_GRASS_N);
    this.grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_GRASS_N * 3; i++) this.grassSeed[i] = hash(i * 7.1);
    this.scene.add(this.grass);

    // reeds — taller, narrower crossed blades with a seed-head tip
    // ★ 视觉教训（第四轮）：旧值 `0.09 × 1.15` 的长径比 ≈ 12.8:1，是本场景里
    //   最细的一层 —— 在秋季暖色（叶色 #d97b3f 等）下，160 根这样的薄叶在路旁
    //   读成一排「红色的细棍/竹签」。修法：加宽到 0.17 并压矮到 0.92
    //   （长径比 → ~5.4:1），保留「芦苇」的竖向感，但不再退化成刺。
    const rBlade = new THREE.PlaneGeometry(0.17, 0.92);
    rBlade.translate(0, 0.46, 0);
    const rB2 = rBlade.clone();
    rB2.rotateY(Math.PI / 2.5);
    const rTip = new THREE.PlaneGeometry(0.2, 0.3);
    rTip.translate(0, 1.0, 0);
    const rTip2 = rTip.clone();
    rTip2.rotateY(Math.PI / 2.5);
    const reedGeo = mergeGeometries([rBlade, rB2, rTip, rTip2])!;
    this.reeds = new THREE.InstancedMesh(
      reedGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true, side: THREE.DoubleSide }),
      MAX_REED_N
    );
    this.reeds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_REED_N * 3; i++) this.reedSeed[i] = hash(i * 3.9 + 40);
    this.scene.add(this.reeds);

    // flowers — thin stem + faceted head
    this.stems = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.025, 0.04, 0.55, 4),
      new THREE.MeshStandardMaterial({ color: '#5e8f5a', roughness: 0.9, flatShading: true }),
      MAX_FLOWER_N
    );
    this.heads = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.15, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.7, emissiveIntensity: 0.25, flatShading: true }),
      MAX_FLOWER_N
    );
    this.stems.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_FLOWER_N * 3; i++) this.flowerSeed[i] = hash(i * 13.3);
    this.scene.add(this.stems, this.heads);

    // five-petal blossoms — 5 flattened spheres around a center nub (merged)
    const petalParts: THREE.BufferGeometry[] = [];
    for (let p = 0; p < 5; p++) {
      const pg = new THREE.IcosahedronGeometry(0.085, 0);
      pg.scale(1, 0.35, 1);
      const a = (p / 5) * Math.PI * 2;
      pg.translate(Math.cos(a) * 0.11, 0, Math.sin(a) * 0.11);
      petalParts.push(pg);
    }
    const nub = new THREE.IcosahedronGeometry(0.055, 0);
    nub.translate(0, 0.04, 0);
    petalParts.push(nub);
    this.petalHeads = new THREE.InstancedMesh(
      mergeGeometries(petalParts)!,
      new THREE.MeshStandardMaterial({ roughness: 0.65, emissiveIntensity: 0.2, flatShading: true }),
      MAX_FLOWER_N
    );
    this.petalHeads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // bell flowers — small inverted cone skirt + tiny clapper (indexed geometries)
    const bellCone = new THREE.ConeGeometry(0.13, 0.2, 6, 1, true);
    bellCone.rotateX(Math.PI); // opening faces down
    const clapper = new THREE.SphereGeometry(0.05, 5, 4);
    clapper.translate(0, -0.12, 0);
    this.bellHeads = new THREE.InstancedMesh(
      mergeGeometries([bellCone, clapper])!,
      new THREE.MeshStandardMaterial({ roughness: 0.65, emissiveIntensity: 0.25, flatShading: true, side: THREE.DoubleSide }),
      MAX_FLOWER_N
    );
    this.bellHeads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.petalHeads, this.bellHeads);

    // low-poly trees — tapered trunk + stacked rounded icosahedron canopy (no cones)
    this.trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.16, 0.32, 2.4, 5),
      flat(0.95),
      MAX_TREE_N
    );
    this.canopyLow = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1.15, 0),
      flat(0.85),
      MAX_TREE_N * 2
    );
    this.canopyTop = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.72, 0),
      flat(0.85),
      MAX_TREE_N
    );
    this.trunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.canopyLow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.canopyTop.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_TREE_N * 3; i++) this.treeSeed[i] = hash(i * 5.9);
    this.scene.add(this.trunks, this.canopyLow, this.canopyTop);

    // fir/pine variant — three stacked upright cones (proper triangular silhouette)
    const pineLow = new THREE.ConeGeometry(1.05, 1.7, 7);
    pineLow.translate(0, 2.4, 0);
    const pineMid = new THREE.ConeGeometry(0.78, 1.5, 7);
    pineMid.translate(0, 3.35, 0);
    const pineTip = new THREE.ConeGeometry(0.5, 1.2, 6);
    pineTip.translate(0, 4.2, 0);
    this.pines = new THREE.InstancedMesh(mergeGeometries([pineLow, pineMid, pineTip])!, flat(0.85), MAX_TREE_N);
    this.pines.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.pines);

    // snow caps — squashed white blobs placed on canopies (winter only)
    this.snowCaps = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.85, 0),
      new THREE.MeshStandardMaterial({ color: '#eaf2ff', roughness: 0.6, flatShading: true }),
      MAX_TREE_N
    );
    this.snowCaps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.snowCaps);

    // rocks & bushes — squashed icosahedra scattered by the roadside
    this.rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.42, 0), flat(0.95), MAX_ROCK_N);
    this.bushes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), flat(0.9), MAX_BUSH_N);
    this.rocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bushes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_ROCK_N * 3; i++) this.rockSeed[i] = hash(i * 11.7);
    for (let i = 0; i < MAX_BUSH_N * 3; i++) this.bushSeed[i] = hash(i * 17.9);
    this.scene.add(this.rocks, this.bushes);

    // mushrooms — stem + dome cap merged; vertex colors keep stem pale vs cap
    const mStem = new THREE.CylinderGeometry(0.05, 0.08, 0.28, 5);
    mStem.translate(0, 0.14, 0);
    paintAttr(mStem, 0.92, 0.88, 0.78);
    const mCap = new THREE.SphereGeometry(0.16, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    mCap.translate(0, 0.26, 0);
    paintAttr(mCap, 1, 1, 1);
    this.mushrooms = new THREE.InstancedMesh(
      mergeGeometries([mStem, mCap])!,
      new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true, vertexColors: true }),
      MAX_MUSH_N
    );
    this.mushrooms.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_MUSH_N * 3; i++) this.mushSeed[i] = hash(i * 21.3 + 7);
    this.scene.add(this.mushrooms);

    // stumps & fallen logs — one cylinder geometry, per-instance pose picks the kind
    this.stumps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.26, 1, 6), flat(0.95), MAX_STUMP_N);
    this.stumps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_STUMP_N * 3; i++) this.stumpSeed[i] = hash(i * 27.7 + 3);
    this.scene.add(this.stumps);

    // puddles — dark glossy little planes that catch the light under bloom
    this.puddleMat = new THREE.MeshStandardMaterial({
      color: '#0d1420',
      roughness: 0.16,
      metalness: 0.65,
      flatShading: true,
    });
    this.puddles = new THREE.InstancedMesh(new THREE.CircleGeometry(0.55, 7), this.puddleMat, MAX_PUDDLE_N);
    this.puddles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_PUDDLE_N * 3; i++) this.puddleSeed[i] = hash(i * 33.1 + 11);
    this.scene.add(this.puddles);

    // ---------------------------------------------------------------------
    // P3 微细节层 —— 用户反馈「场景细节还是不够」的真正解法：
    // 不加新的元素「种类」，而是给已有元素加「底座与边缘」，
    // 让每一处植被/路面在近景都有一圈可看的碎细节。
    // 全部随 densityScale 缩放；low 档（extras=false）整体隐藏。
    // ---------------------------------------------------------------------

    // L0 贴地苔藓/地衣 —— 极扁的多面体圆片，压在草丛根部。
    // 因为旋转被压到 X 轴接近 0，正面几乎贴着地面，只在地面轮廓上留一点起伏。
    this.mosses = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.34, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.98, flatShading: true }),
      MAX_MOSS_N
    );
    this.mosses.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_MOSS_N * 3; i++) this.mossSeed[i] = hash(i * 41.3 + 5);
    this.scene.add(this.mosses);

    // L3 芒草丛 —— 只在远侧轮廓带出现，在天际线下方拉出一条「草尖毛边」。
    // ★ 视觉教训（第四轮，务必记住）：
    //   上一版用 4 片 `0.11 × 1.75` 的十字薄叶。0.11 宽、1.75 高的平面在稍远处
    //   被侧向看到时只剩一条**竖直细缝**，再叠 54 个实例 × 随机 Y 旋转，
    //   整体读成「满地折断的细木棍 / 倒伏的栅栏板」——这正是用户说的「太杂太乱」。
    //   修法：**放弃十字薄叶，改成一丛「矮而宽、带锥度」的叶片**。
    //   - 宽度 0.11 → 0.26（任何角度看都有可见面积，不再退化成细缝）
    //   - 高度 1.75 → 1.02（只比 grass 的 0.5 高一倍，回到「草丛」而非「高杆」）
    //   - 叶片顶端收窄（锥度），读作草叶而不是木板
    //   - 6 片按 60° 均匀铺成莲座状，形成「一丛」的体量，而不是交叉的碎片
    const tBlade = new THREE.PlaneGeometry(0.26, 1.02);
    // 顶端收窄：把上边缘两点向中轴收拢，形成自然的草叶锥度
    {
      const p = tBlade.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > 0) p.setX(i, p.getX(i) * 0.35);
      }
      p.needsUpdate = true;
      tBlade.computeVertexNormals();
    }
    tBlade.translate(0, 0.51, 0);
    const tuftBlades: THREE.BufferGeometry[] = [tBlade];
    for (let b = 1; b < 6; b++) {
      const bl = tBlade.clone();
      bl.rotateY((Math.PI / 3) * b);
      tuftBlades.push(bl);
    }
    this.tallGrass = new THREE.InstancedMesh(
      mergeGeometries(tuftBlades)!,
      new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true, side: THREE.DoubleSide }),
      MAX_TALLGRASS_N
    );
    this.tallGrass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_TALLGRASS_N * 3; i++) this.tallGrassSeed[i] = hash(i * 47.9 + 13);
    this.scene.add(this.tallGrass);

    // 路缘石 —— 低矮长条石块沿道路两侧等距排布，给无限路面一个「路肩」参照物。
    // 有它之后，路面不再是一条飘在空中的带子，景深参照明显增强。
    // 高度压到 0.16 并半埋（y=0.07 → 约一半在地面以下），避免读成「浮在空中的小板」。
    const curbGeo = new THREE.BoxGeometry(0.3, 0.16, 1.0);
    // 容量 = 单侧上限 × 2（左右各一排），与 canopyLow 的 MAX_TREE_N*2 同一套思路
    this.curbs = new THREE.InstancedMesh(curbGeo, flat(0.95), MAX_CURB_N * 2);
    this.curbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_CURB_N * 3; i++) this.curbSeed[i] = hash(i * 53.1 + 17);
    this.scene.add(this.curbs);

    // 路面贴花 —— 贴地的极扁圆片，模拟磨损 / 补丁 / 干涸水渍。
    // ★ 视觉教训（三轮，务必记住）：
    //   1) opacity 0.5 + MeshStandardMaterial：被阳光照亮后比路面更亮 → 读成「地上的纸片」。
    //   2) 即便压到 0.14，只要是 Standard 材质，直射光仍可能让它亮过阴影中的路面。
    //   3) ★★ 致命一轮：改用 MultiplyBlending 后**误留深色材质色 #5c6068 + opacity 0.85**，
    //      乘数 ≈ 0.36 × 0.7 × 0.85 ≈ 0.21 → 路面被压到约 21% 亮度（近黑），
    //      在浅色路面（春/冬/沙滩）上直接读成「一个个破洞/污渍」，是最刺眼的杂乱源。
    // 结论：Multiply 混合下**乘数必须贴近 1**。做法 —— 材质色恒定 #ffffff（基准 1.0），
    // 压暗幅度**只由 instanceColor 的 0.86~0.95 决定**（只压暗 5%~14%，读作「淡淡湿痕」）。
    // 冷中性（而非暖褐）：与蓝调雪面/夜色路面混合时不会污染出橄榄黄。
    this.decals = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.7, 6),
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 1,
        depthWrite: false,
        // three 的硬性要求：MultiplyBlending 必须配 premultipliedAlpha，
        // 否则每个 draw call 都打一条 WebGLState 警告（实测会刷满 console）。
        premultipliedAlpha: true,
        blending: THREE.MultiplyBlending,
      }),
      MAX_DECAL_N
    );
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_DECAL_N * 3; i++) this.decalSeed[i] = hash(i * 59.7 + 19);
    this.scene.add(this.decals);

    // ---------------------------------------------------------------------
    // P4 路旁设施 —— 长椅 / 路牌 / 篱笆。
    // 三者都用「草地色 + 木色」的低饱和材质，保证与 P3 植被层同属一个色彩家族。
    // ---------------------------------------------------------------------

    // 长椅：座面 + 靠背 + 两条腿，合并成单个几何，靠实例旋转朝向道路。
    const seat = new THREE.BoxGeometry(1.5, 0.09, 0.45);
    seat.translate(0, 0.44, 0);
    const back = new THREE.BoxGeometry(1.5, 0.42, 0.07);
    back.translate(0, 0.66, -0.2);
    const legA = new THREE.BoxGeometry(0.09, 0.44, 0.4);
    legA.translate(-0.62, 0.22, 0);
    const legB = legA.clone();
    legB.translate(1.24, 0, 0);
    this.benches = new THREE.InstancedMesh(
      mergeGeometries([seat, back, legA, legB])!,
      flat(0.9),
      MAX_BENCH_N
    );
    this.benches.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_BENCH_N * 3; i++) this.benchSeed[i] = hash(i * 61.7 + 23);
    this.scene.add(this.benches);

    // 路牌：细杆 + 方板（板身用亮色 instanceColor，杆身随材质走暗色）。
    const post = new THREE.CylinderGeometry(0.035, 0.045, 1.5, 5);
    post.translate(0, 0.75, 0);
    const panel = new THREE.BoxGeometry(0.52, 0.34, 0.05);
    panel.translate(0, 1.42, 0);
    this.signs = new THREE.InstancedMesh(
      mergeGeometries([post, panel])!,
      new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.15, flatShading: true }),
      MAX_SIGN_N
    );
    this.signs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_SIGN_N * 3; i++) this.signSeed[i] = hash(i * 67.3 + 29);
    this.scene.add(this.signs);

    // 篱笆：两段短柱 + 两根横杆，构成一个「一段」模块，环槽复用。
    // ★ 视觉教训：初版柱高 0.72、间距几乎首尾相接时，两侧会连成一道「围栏墙」，
    // 把近景挤成一圈畜栏，反而压过了植被。现在整体压矮到 ~0.52 并只保留稀疏分段，
    // 定位在「隐约的田埂边界」而非「围栏」。
    const fp1 = new THREE.BoxGeometry(0.07, 0.52, 0.07);
    fp1.translate(-0.55, 0.26, 0);
    const fp2 = fp1.clone();
    fp2.translate(1.1, 0, 0);
    const fr1 = new THREE.BoxGeometry(1.2, 0.05, 0.05);
    fr1.translate(0, 0.42, 0);
    const fr2 = fr1.clone();
    fr2.translate(0, -0.22, 0);
    this.fences = new THREE.InstancedMesh(
      mergeGeometries([fp1, fp2, fr1, fr2])!,
      flat(0.92),
      MAX_FENCE_N * 2
    );
    this.fences.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_FENCE_N * 3; i++) this.fenceSeed[i] = hash(i * 71.9 + 31);
    this.scene.add(this.fences);

    // Collapse every instance to zero scale: InstancedMesh buffers start as
    // identity matrices at the origin — without this, variant slots that are
    // only written for certain tree types (firs / canopy layers) render as a
    // phantom tree sitting in the middle of the road at world origin.
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const mesh of [
      this.grass, this.reeds, this.stems, this.heads, this.petalHeads, this.bellHeads,
      this.trunks, this.canopyLow, this.canopyTop, this.pines, this.snowCaps,
      this.rocks, this.bushes, this.mushrooms, this.stumps, this.puddles,
      this.mosses, this.tallGrass, this.curbs, this.decals,
      this.benches, this.signs, this.fences,
    ]) {
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, zero);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** street lamps: slim tapered pole, curved arm, hanging lantern head, layered glow sprites, soft cone, ground light pool */
  private buildLamps() {
    const poleGeo = new THREE.CylinderGeometry(0.035, 0.075, LAMP_H, 6);
    const armGeo = new THREE.CylinderGeometry(0.028, 0.035, 1.1, 5);
    const capGeo = new THREE.ConeGeometry(0.16, 0.14, 6); // lantern roof
    const lanternGeo = new THREE.SphereGeometry(0.15, 8, 6); // warm glowing paper lantern body
    lanternGeo.scale(1, 1.25, 1);
    const ringGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.05, 6); // lantern bottom ring
    const coneGeo = new THREE.ConeGeometry(1.7, 4.6, 12, 1, true);
    this.lampPoleMat = new THREE.MeshStandardMaterial({ color: '#3a3f3a', roughness: 0.65, metalness: 0.4, flatShading: true });
    this.lampHeadMat = new THREE.MeshStandardMaterial({
      color: '#fff2d0',
      emissive: '#ffe9c4',
      emissiveIntensity: 1.6,
      roughness: 0.4,
      flatShading: true,
    });
    const glowTex = makeGlowTexture();
    for (let i = 0; i < MAX_LAMP_N; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const group = new THREE.Group();

      const pole = new THREE.Mesh(poleGeo, this.lampPoleMat);
      pole.position.y = LAMP_H / 2;
      group.add(pole);

      // gracefully curved arm arcing over the road
      const arm = new THREE.Mesh(armGeo, this.lampPoleMat);
      arm.rotation.z = Math.PI / 2 - side * 0.55;
      arm.position.set(-side * 0.48, LAMP_H - 0.02, 0);
      group.add(arm);

      // lantern hangs from the arm tip on a short cord
      const headX = -side * 0.95;
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 4), this.lampPoleMat);
      cord.position.set(headX, LAMP_H + 0.1, 0);
      group.add(cord);
      const cap = new THREE.Mesh(capGeo, this.lampPoleMat);
      cap.position.set(headX, LAMP_H - 0.06, 0);
      group.add(cap);
      const head = new THREE.Mesh(lanternGeo, this.lampHeadMat);
      head.position.set(headX, LAMP_H - 0.28, 0);
      group.add(head);
      const ring = new THREE.Mesh(ringGeo, this.lampPoleMat);
      ring.position.set(headX, LAMP_H - 0.48, 0);
      group.add(ring);

      // layered halo: small hot core + wide soft shell
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: '#ffe9c4',
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      glow.scale.set(0.9, 0.9, 1);
      glow.position.set(headX, LAMP_H - 0.28, 0);
      group.add(glow);
      const glowOuter = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: '#ffe9c4',
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      glowOuter.scale.set(3.4, 3.4, 1);
      glowOuter.position.set(headX, LAMP_H - 0.3, 0);
      group.add(glowOuter);
      // P6 第三层光晕 glowFar：更大更淡的雾状外层（半径 8），把灯「焊」进空气里。
      // 低档位由 applyDensity/setQuality 按 lampLayers 关闭，避免中等档多付这笔填充。
      const glowFar = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: '#ffe9c4',
          transparent: true,
          opacity: 0.05,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      glowFar.scale.set(8, 8, 1);
      glowFar.position.set(headX, LAMP_H - 0.32, 0);
      group.add(glowFar);

      // soft light cone: radial edge falloff (vUv.x wraps around the cone surface)
      const coneMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          color: { value: new THREE.Color('#ffe9c4') },
          opacity: { value: 0.12 },
        },
        vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){
            vUv=uv; vN = normalMatrix * normal;
            vec4 mv = modelViewMatrix * vec4(position,1.0);
            vV = -mv.xyz;
            gl_Position = projectionMatrix*mv;
          }`,
        fragmentShader: `uniform vec3 color; uniform float opacity; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){
            // fresnel-style falloff: brightest through the middle of the beam,
            // dissolving at the silhouette so there are no hard "tent" edges
            float facing = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
            float fade = smoothstep(1.0, 0.45, vUv.y); // bright at the lantern, dissolving toward the ground
            float a = opacity * facing * fade * fade;
            gl_FragColor = vec4(color, a);
          }`,
      });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(headX, LAMP_H - 0.28 - 4.6 / 2, 0);
      group.add(cone);

      // warm pool of light where the beam lands on the path
      const spot = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: '#ffe9c4',
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      spot.scale.set(3.4, 1.5, 1);
      spot.position.set(headX * 0.7, 0.15, 0);
      group.add(spot);

      this.scene.add(group);
      this.lamps.push({ group, glow, glowOuter, glowFar, spot, cone, side, slot: i });
    }
  }

  /** distant low-poly clouds drifting very slowly, positions are pure f(t, distance) */
  private buildClouds() {
    const puffGeo = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < MAX_CLOUD_N; i++) {
      // per-cloud material so opacity can vary per layer (front bright / back hazy)
      const mat = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 1,
        flatShading: true,
        transparent: true,
        opacity: 0.85,
      });
      this.cloudMats.push(mat);
      const g = new THREE.Group();
      const puffs = 3 + (hash(i * 3.3) * 2) | 0;
      for (let p = 0; p < puffs; p++) {
        const m = new THREE.Mesh(puffGeo, mat);
        const s = 1.6 + hash(i * 11 + p * 7) * 2.6;
        m.position.set((p - puffs / 2) * s * 0.9, (hash(p * 13 + i) - 0.5) * 0.8, (hash(p * 5 + i * 3) - 0.5) * 2);
        m.scale.set(s, s * 0.55, s * 0.8);
        g.add(m);
      }
      this.cloudSeed[i * 4] = hash(i * 3.1);
      this.cloudSeed[i * 4 + 1] = hash(i * 7.7);
      this.cloudSeed[i * 4 + 2] = hash(i * 9.4);
      this.cloudSeed[i * 4 + 3] = hash(i * 12.8);
      this.scene.add(g);
      this.clouds.push(g);
    }
  }

  /** fireflies / floating glow motes — fully GPU-animated points, zero per-frame CPU */
  private buildFireflies() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_FIREFLY_N * 3);
    const phase = new Float32Array(MAX_FIREFLY_N);
    for (let i = 0; i < MAX_FIREFLY_N; i++) {
      pos[i * 3] = (hash(i * 2.3) - 0.5) * 30;
      pos[i * 3 + 1] = 0.4 + hash(i * 4.9) * 4.2;
      pos[i * 3 + 2] = 6 - hash(i * 6.1) * 70; // local band around the walker
      phase[i] = hash(i * 8.7) * Math.PI * 2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    this.fireflyUniforms = {
      uT: { value: 0 },
      uWind: { value: 0 },
      uColor: { value: new THREE.Color('#ffe9a8') },
      uOpacity: { value: 0.7 },
      uTex: { value: makeGlowTexture() },
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: this.fireflyUniforms,
      vertexShader: `
        uniform float uT; uniform float uWind;
        attribute float phase;
        varying float vTw;
        void main(){
          vec3 p = position;
          p.x += sin(uT * 0.6 + phase) * 1.6 + uWind * sin(uT * 1.3 + phase * 2.0) * 3.5;
          p.y += sin(uT * 0.9 + phase * 1.7) * 0.7 + uWind * 0.4 * sin(uT * 2.1 + phase);
          p.z += sin(uT * 0.23 + phase * 2.3) * 1.2;
          vTw = 0.35 + 0.65 * (0.5 + 0.5 * sin(uT * 2.2 + phase * 3.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = min((110.0 * vTw) / max(1.0, -mv.z), 18.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uOpacity; uniform sampler2D uTex;
        varying float vTw;
        void main(){
          vec4 tex = texture2D(uTex, gl_PointCoord);
          // 中心亮核：萤火虫应是「有芯的亮点」，而不是均匀发光圆片
          float r = length(gl_PointCoord - 0.5);
          float core = smoothstep(0.18, 0.0, r);
          vec3 col = mix(uColor, vec3(1.0), core * 0.7);
          gl_FragColor = vec4(col, tex.a * vTw * uOpacity);
        }`,
    });
    this.fireflies = new THREE.Points(geo, mat);
    this.fireflies.frustumCulled = false;
    this.scene.add(this.fireflies);
  }

  /**
   * 接触阴影（低成本假阴影）：一片朝上的软边贴片，跟随角色脚下。
   * 不用 shadowMap —— 零额外 draw call 成本，仅 1 个 InstancedMesh。
   * 由 setQuality 按档位显隐（low 档关闭）。
   */
  private buildContactShadows() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: makeGlowTexture(),
      color: '#000000',
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, CONTACT_SHADOW_N);
    mesh.frustumCulled = false;
    for (let i = 0; i < CONTACT_SHADOW_N; i++) {
      dummy.position.set(0, -10, 0);
      dummy.scale.setScalar(0);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    // 双重条件：contactShadows（档位总开关）+ shadowQuality>0（阴影质量分档，0 = 不要阴影）
    mesh.visible = QUALITY_SETTINGS[this.quality].contactShadows && QUALITY_SETTINGS[this.quality].shadowQuality > 0;
    this.contactShadows = mesh;
    this.scene.add(mesh);
  }

  /**
   * P5 雪面脚印 —— 角色身后两行交替的浅凹痕。
   *
   * 为什么值得做：无限雪地上「走过」这件事本身没有留下任何痕迹，
   * 走着走着会觉得世界是「贴片」而不是「地面」。脚印把「经过」变成可读的历史。
   *
   * 实现要点：
   *   - 位置是 `distance` 的纯函数（`slot()` 同款环槽），所以不做状态累积，
   *     长时间运行不会漂移、不会内存增长；
   *   - 左右脚交替：`k % 2` 决定横向偏移 ±0.22；
   *   - 用一盏「极暗 + 极低不透明度」的软边圆片贴在雪面极薄之上（y=0.013）。
   */
  private buildFootprints() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: makeGlowTexture(),
      color: '#8fa8d8', // 雪面阴影偏蓝，才像「压出的坑」而不是「贴上去的黑点」
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, FOOTPRINT_N * 2);
    mesh.frustumCulled = false;
    for (let i = 0; i < FOOTPRINT_N * 2; i++) {
      dummy.position.set(0, -10, 0);
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = false; // 仅雪天/雪主题由 update 打开
    this.footprints = mesh;
    this.scene.add(mesh);
  }

  /**
   * P5 灯下微尘 —— 每盏灯的光锥内缓慢漂浮的细小尘埃。
   *
   * 为什么值得做：路灯的光锥目前是「干净的几何体」，现实里灯光锥里一定有浮尘，
   * 这是让「灯光质感」从塑料变成可信的关键一笔（比把锥体做得更亮更有效）。
   *
   * 纯 GPU：位置在顶点着色器里由 uT + 每顶点种子算出，CPU 每帧只写 1 个 uniform。
   * 尘埃锚点跟随角色（整片随角色移动），保证相机附近总有尘埃可看。
   */
  private buildDust() {
    const N = 240;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = 0;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = 0;
      seed[i * 2] = hash(i * 2.3 + 5);
      seed[i * 2 + 1] = hash(i * 7.9 + 11);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
    this.dustU = {
      uT: { value: 0 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color('#ffe9c4') },
      uSpanY: { value: 4.2 },
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: this.dustU,
      vertexShader: `
        attribute vec2 aSeed;
        uniform float uT; uniform float uSpanY;
        varying float vA;
        void main(){
          // 每个粒子在「路两侧灯柱区」的柱体内绕灯缓慢上浮，到达顶部后回到底部（不累积状态）。
          // x 偏向两侧（±5.6 是灯柱位置），y 覆盖灯高（0~4.2），使尘埃聚集在灯附近而非全屏乱飞。
          float sp = 0.06 + aSeed.y * 0.12;
          float y = mod(aSeed.x * uSpanY + uT * sp, uSpanY);
          float a = aSeed.x * 6.2831 + uT * 0.5;
          float r = 0.5 + aSeed.y * 1.6;
          float sideSign = aSeed.y > 0.5 ? 1.0 : -1.0;
          vec3 p = vec3(sideSign * 5.4 + cos(a) * r, y, sin(a * 1.3) * r);
          vA = (1.0 - y / uSpanY) * (0.35 + aSeed.y * 0.65);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = min(26.0 / max(0.4, -mv.z), 5.0) * (0.5 + aSeed.y);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uOpacity;
        varying float vA;
        void main(){
          vec2 q = gl_PointCoord - 0.5;
          float d = length(q);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d) * vA * uOpacity;
          vec3 col = uColor * (0.7 + 0.6 * (1.0 - d * 2.0));
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.dustU.uOpacity.value = 0.5;
    this.scene.add(this.dust);
  }

  private buildCharacter() {
    const coreMat = new THREE.MeshStandardMaterial({
      color: '#fff6e2',
      emissive: '#fff2d0',
      emissiveIntensity: 1.05,
      roughness: 0.35,
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 18), coreMat);
    orb.position.y = 1.0;
    this.charCore = orb;
    this.character.add(orb);

    const haloTex = makeGlowTexture();
    this.charHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: haloTex, color: '#ffd98a', transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.charHalo.scale.set(1.5, 1.5, 1);
    this.charHalo.position.y = 1.0;
    this.character.add(this.charHalo);
    this.scene.add(this.character);

    // winter breath mist — small soft puffs exhaled ahead of the walker
    const breathTex = makeGlowTexture();
    for (let i = 0; i < 2; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: breathTex,
          color: '#dfe9ff',
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
      );
      s.visible = false;
      this.scene.add(s);
      this.breaths.push(s);
    }
  }

  /**
   * GPU-driven falling particles: THREE.Points where position / sway / spin /
   * horizon wrap are all computed in the vertex shader as f(uT, uDist, seed).
   * CPU writes a handful of uniforms per frame — zero setMatrixAt, zero allocation.
   * Shape (soft dot / petal / leaf / rain streak) is drawn in the fragment shader,
   * with fake rotation by rotating gl_PointCoord around the sprite center.
   */
  private makeFallSystem(n: number, shape: 'dot' | 'petal' | 'leaf' | 'streak') {
    const geo = new THREE.BufferGeometry();
    // position attribute is required by three but unused (all from seeds)
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) seed[i] = hash(i * 3.7 + n);
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    const uniforms = {
      uT: { value: 0 },
      uDist: { value: 0 },
      uWind: { value: 0 },
      uIntensity: { value: 0 },
      uFall: { value: 0.6 }, // base fall speed
      uSway: { value: 1.4 },
      uSpin: { value: 1.0 },
      uSize: { value: 1.0 },
      uBoost: { value: 1.0 }, // music swell
      uSlant: { value: 0.0 }, // rain slant
      uSpan: { value: SPAN },
      uOpacity: { value: 0.9 },
      uColA: { value: new THREE.Color('#ffffff') },
      uColB: { value: new THREE.Color('#ffffff') },
      uColC: { value: new THREE.Color('#ffffff') },
    };
    // NOTE: `a` is declared once in main(); each branch must ASSIGN, never re-declare
    // (GLSL has no nested scope here — a second `float a = ...` is a redefinition error).
    const shapeFrag =
      shape === 'dot'
        ? `a = smoothstep(0.5, 0.16, length(q));
           // 亮核 + 软晕：让雪花读起来是「晶点」而不是一团白雾
           float dotCore = smoothstep(0.22, 0.0, length(q));
           col = mix(col, vec3(1.0), dotCore * 0.85);
           a = max(a, dotCore * 0.95);`
        : shape === 'streak'
          ? `vec2 d = abs(q); a = smoothstep(0.10, 0.03, d.x) * smoothstep(0.5, 0.42, d.y);
             float strCore = smoothstep(0.05, 0.0, d.x) * smoothstep(0.36, 0.12, d.y);
             col = mix(col, vec3(1.0), strCore * 0.7); a = max(a, strCore);`
          : shape === 'leaf'
            ? `vec2 e = q / vec2(0.42, 0.24); a = smoothstep(1.0, 0.72, dot(e, e)); a *= 0.7 + 0.3 * smoothstep(0.0, 0.2, abs(q.x));`
            : `vec2 e = q / vec2(0.34, 0.26); a = smoothstep(1.0, 0.65, dot(e, e));`;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms,
      vertexShader: `
        uniform float uT; uniform float uDist; uniform float uWind; uniform float uIntensity;
        uniform float uFall; uniform float uSway; uniform float uSpin; uniform float uSize;
        uniform float uBoost; uniform float uSlant; uniform float uSpan;
        attribute vec3 aSeed;
        varying float vRot; varying float vMix; varying float vA;
        void main(){
          float s0 = aSeed.x, s1 = aSeed.y, s2 = aSeed.z;
          float charZ = -uDist;
          // uDist 可能到 1e5+；先 mod 到 [0, uSpan) 再参与运算，
          // 避免 float32 在大数上做 mod 时丢掉小数位（粒子会整体跳变/聚堆）。
          float uD = mod(uDist, uSpan);
          float z = charZ + 4.0 - uSpan + mod(s2 * uSpan + uD * (0.9 + s0 * 0.2), uSpan);
          float H = 14.0;
          float speedVar = 0.35 + s2 * 1.3;
          float y = mod(s1 * H - uT * uFall * speedVar * uBoost, H);
          float sway = sin(uT * (0.5 + s2) + s1 * 20.0) * uSway * (1.0 + uWind * 2.5);
          float x = (s0 - 0.5) * 26.0 + sway + uWind * sin(uT * 1.1 + s0 * 40.0) * 2.5 + (H - y) * uSlant;
          vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
          // intensity gates the visible share; fade at horizon wrap & behind camera
          float vis = step(s0, uIntensity);
          float dz = z - charZ;
          float fade = smoothstep(-uSpan + 2.0, -uSpan + 16.0, dz) * smoothstep(7.5, 4.5, dz);
          vA = vis * fade;
          vRot = uT * uSpin * (0.6 + s0 * 1.8) * uBoost + s1 * 6.2832;
          vMix = fract(s0 * 7.31 + s2 * 3.7);
          float sz = uSize * (0.5 + s2 * 1.3);
          float d = max(1.0, -mv.z);
          // 上限 26px：贴近相机的粒子不再膨胀成糊屏大白球（bloom 会把它放大成肥皂泡）
          gl_PointSize = min(sz * 300.0 / d, 26.0) * step(0.001, vA);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uColC; uniform float uOpacity;
        varying float vRot; varying float vMix; varying float vA;
        void main(){
          vec2 pc = gl_PointCoord - 0.5;
          float c = cos(vRot), s = sin(vRot);
          vec2 q = vec2(pc.x * c - pc.y * s, pc.x * s + pc.y * c);
          vec3 col = vMix < 0.34 ? uColA : vMix < 0.67 ? uColB : uColC;
          float a = 0.0;
          ${shapeFrag}
          float alpha = a * vA * uOpacity;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    return { pts, uniforms };
  }

  private buildFallSystems() {
    const p = this.makeFallSystem(PETAL_N, 'petal');
    this.petals = p.pts;
    this.petalU = p.uniforms;
    this.petalU.uFall.value = 0.55;
    this.petalU.uSize.value = 0.55;
    this.petalU.uSpin.value = 1.4;
    const l = this.makeFallSystem(LEAF_N, 'leaf');
    this.leaves = l.pts;
    this.leafU = l.uniforms;
    this.leafU.uFall.value = 0.85;
    this.leafU.uSize.value = 0.8;
    this.leafU.uSpin.value = 2.2;
    this.leafU.uSway.value = 2.1;
    const s = this.makeFallSystem(SNOW_N, 'dot');
    this.snow = s.pts;
    this.snowU = s.uniforms;
    this.snowU.uFall.value = 0.5;
    this.snowU.uSize.value = 0.4;
    this.snowU.uSpin.value = 0.0;
    this.snowU.uSway.value = 1.1;
    this.snowU.uOpacity.value = 0.95;
    const r = this.makeFallSystem(RAIN_N, 'streak');
    this.rain = r.pts;
    this.rainU = r.uniforms;
    this.rainU.uFall.value = 9.5;
    this.rainU.uSize.value = 0.5;
    this.rainU.uSway.value = 0.15;
    this.rainU.uSlant.value = 0.35;
    this.rainU.uOpacity.value = 0.5;
    // 风痕：横向掠过的高速细痕，专门服务 'wind' 天气（原先 wind 只有落叶 0.22 + 摇摆，视觉表达很弱）
    const st = this.makeFallSystem(STREAK_N, 'streak');
    this.streaks = st.pts;
    this.streakU = st.uniforms;
    this.streakU.uFall.value = 0.35; // 缓慢下落，主要靠横向风
    this.streakU.uSize.value = 0.42;
    this.streakU.uSway.value = 0.5;
    this.streakU.uSpin.value = 0.0;
    this.streakU.uSlant.value = 0.85; // 大斜角 → 横向风痕
    this.streakU.uOpacity.value = 0.42;
  }

  /** city: low-poly building blocks with baked emissive lit-window texture */
  private buildCity() {
    const { map, emissiveMap } = makeFacadeTextures();
    const mat = new THREE.MeshStandardMaterial({
      map,
      emissiveMap,
      emissive: '#ffffff',
      emissiveIntensity: 1.1,
      roughness: 0.85,
      flatShading: true,
    });
    this.buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAX_BUILD_N);
    this.buildings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_BUILD_N * 3; i++) this.buildSeed[i] = hash(i * 6.7 + 21);
    this.scene.add(this.buildings);

    // neon signs — small bright boxes floating on the inner building faces.
    // P6：材质基色设为白（不参与配色），真正的色相由 setTheme 逐实例写入
    // neonHue（每个主题一组霓虹色）→ 霓虹灯牌不再是一片死白。
    this.neon = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.18, 0.7, 0.1),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      MAX_NEON_N
    );
    this.neon.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_NEON_N * 3; i++) this.neonSeed[i] = hash(i * 9.1 + 47);
    this.scene.add(this.neon);

    // traffic lights — pole + head box + 3 lamps, ring slots like street lamps
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.06, 3.0, 5);
    const headGeo = new THREE.BoxGeometry(0.34, 0.9, 0.28);
    const lampGeo = new THREE.SphereGeometry(0.09, 8, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: '#2a2e3c', roughness: 0.6, metalness: 0.4, flatShading: true });
    const headMat = new THREE.MeshStandardMaterial({ color: '#1c2030', roughness: 0.7, flatShading: true });
    for (let i = 0; i < MAX_TRAFFIC_N; i++) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 1.5;
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.y = 3.1;
      g.add(pole, head);
      const mats: THREE.MeshBasicMaterial[] = [];
      const cols = ['#ff4a4a', '#ffc44a', '#4aff7a'];
      for (let k = 0; k < 3; k++) {
        const m = new THREE.MeshBasicMaterial({ color: cols[k] });
        const dot = new THREE.Mesh(lampGeo, m);
        dot.position.set(0, 3.38 - k * 0.28, 0.16);
        g.add(dot);
        mats.push(m);
      }
      g.visible = false;
      this.scene.add(g);
      this.traffic.push(g);
      this.trafficMats.push(mats);
    }
  }

  /** beach: shader sea plane, palms, umbrellas, shells & starfish */
  private buildBeach() {
    this.seaU = {
      uT: { value: 0 },
      uDist: { value: 0 },
      uDeep: { value: new THREE.Color('#1a6aa8') },
      uShallow: { value: new THREE.Color('#4fc8d8') },
      uFoam: { value: new THREE.Color('#f4feff') },
      uFogColor: { value: new THREE.Color('#a8d8e0') },
      uFogDensity: { value: 0.014 },
      // P6 反射带：太阳/月亮在海面上的垂直亮带（sun path）。
      // uReflect = 强度（主题 seaReflect），uReflectCol = 光源色（celestial 色）。
      // 它在视觉上是「海面把天空反射回来」的唯一线索——没有它，海就是一块蓝布。
      uReflect: { value: 0.55 },
      uReflectCol: { value: new THREE.Color('#fff3c8') },
      uReflectX: { value: 0.5 },
    };
    const seaMat = new THREE.ShaderMaterial({
      uniforms: this.seaU,
      vertexShader: `
        varying vec2 vUv; varying float vFogDepth;
        void main(){
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uT; uniform float uDist; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam;
        uniform vec3 uFogColor; uniform float uFogDensity;
        uniform float uReflect; uniform vec3 uReflectCol; uniform float uReflectX;
        // 同上：pars 由 three 自动注入，此处只需在输出后调用 fragment 段
        varying vec2 vUv; varying float vFogDepth;
        void main(){
          // vUv.x: 0 = shore side, 1 = horizon; vUv.y runs along the path
          vec3 col = mix(uShallow, uDeep, smoothstep(0.05, 0.6, vUv.x));
          // rolling wave bands drifting toward the shore
          float w = sin(vUv.x * 34.0 - uT * 1.2 + sin(vUv.y * 60.0 + uT * 0.7) * 0.8);
          float foam = smoothstep(0.86, 0.99, w) * smoothstep(0.55, 0.12, vUv.x);
          // bright shore edge, gently breathing
          float shore = smoothstep(0.045 + 0.02 * sin(uT * 0.8), 0.0, vUv.x);
          col = mix(col, uFoam, clamp(foam * 0.8 + shore, 0.0, 1.0));
          // sun sparkle
          col += 0.08 * sin(vUv.y * 300.0 + uT * 2.0) * sin(vUv.x * 220.0 - uT * 1.4);
          // P6 反射带：以 uReflectX 为中心的高斯亮带，横向随波光抖动 → 像太阳在水面的倒影路径。
          // 越靠岸（vUv.x 小）越窄越亮，越靠地平线越宽越淡，符合透视下光带的收敛规律。
          float bandW = mix(0.022, 0.14, vUv.x);
          float dx = (vUv.y - uReflectX) + sin(vUv.y * 90.0 + uT * 1.6) * 0.012;
          float band = exp(-(dx * dx) / (bandW * bandW));
          // 断开成「闪光点」而非连续亮条：用高频 sin 调制成碎光
          float glint = 0.55 + 0.45 * sin(vUv.y * 210.0 - uT * 3.1);
          col += uReflectCol * band * glint * uReflect * (1.0 - vUv.x * 0.5);
          // FogExp2 —— 与 scene.fog 同参数，避免远端海面与雾色地面/山剪影衔接生硬
          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
          col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
          // 海面同样占据大面积，需与标准材质一致的 tonemapping + sRGB 输出
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(150, 420, 1, 1), seaMat);
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.rotation.z = Math.PI; // uv.x=0 at the shore (east edge)
    this.sea.position.set(89, -0.25, -80);
    this.scene.add(this.sea);

    // palm trunk — bent cylinder; fronds — 6 drooping tapered planes
    const trunkGeo = new THREE.CylinderGeometry(0.09, 0.17, 3.6, 5, 6);
    trunkGeo.translate(0, 1.8, 0);
    const tp = trunkGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i);
      tp.setX(i, tp.getX(i) + Math.pow(y / 3.6, 2) * 0.85);
    }
    trunkGeo.computeVertexNormals();
    this.palms = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: '#8a6f4e', roughness: 0.95, flatShading: true }),
      MAX_PALM_N
    );
    this.palms.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const frondParts: THREE.BufferGeometry[] = [];
    for (let f = 0; f < 6; f++) {
      const fg = new THREE.PlaneGeometry(0.5, 1.9, 1, 3);
      fg.translate(0, 0.95, 0);
      const fp = fg.attributes.position;
      for (let i = 0; i < fp.count; i++) {
        const y = fp.getY(i);
        fp.setZ(i, -Math.pow(y / 1.9, 2) * 0.7); // droop
      }
      fg.rotateX(-Math.PI / 2 + 0.5);
      fg.rotateY((f / 6) * Math.PI * 2);
      fg.translate(0.85, 3.6, 0); // trunk top (accounting for the bend)
      frondParts.push(fg);
    }
    this.fronds = new THREE.InstancedMesh(
      mergeGeometries(frondParts)!,
      new THREE.MeshStandardMaterial({ color: '#4a9a5e', roughness: 0.9, flatShading: true, side: THREE.DoubleSide }),
      MAX_PALM_N
    );
    this.fronds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_PALM_N * 3; i++) this.palmSeed[i] = hash(i * 4.3 + 71);
    this.scene.add(this.palms, this.fronds);

    // beach umbrellas — striped cone canopy + pole (vertex colors)
    const uPole = new THREE.CylinderGeometry(0.03, 0.04, 1.9, 5);
    uPole.translate(0, 0.95, 0);
    paintAttr(uPole, 0.85, 0.82, 0.75);
    const uTop = new THREE.ConeGeometry(1.25, 0.6, 8);
    uTop.translate(0, 1.95, 0);
    paintAttr(uTop, 1, 1, 1);
    this.umbrellas = new THREE.InstancedMesh(
      mergeGeometries([uPole, uTop])!,
      new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true, vertexColors: true }),
      MAX_UMBRELLA_N
    );
    this.umbrellas.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_UMBRELLA_N * 3; i++) this.umbrellaSeed[i] = hash(i * 7.9 + 33);
    this.scene.add(this.umbrellas);

    // shells & starfish — small blobs / 5-arm stars on the sand
    const shellGeo = new THREE.SphereGeometry(0.14, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    shellGeo.scale(1, 0.6, 1.25);
    const starParts: THREE.BufferGeometry[] = [];
    for (let a = 0; a < 5; a++) {
      const arm = new THREE.BoxGeometry(0.26, 0.05, 0.09);
      arm.translate(0.13, 0.03, 0);
      arm.rotateY((a / 5) * Math.PI * 2);
      starParts.push(arm);
    }
    const starGeo = mergeGeometries(starParts)!;
    this.shells = new THREE.InstancedMesh(
      shellGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true }),
      MAX_SHELL_N
    );
    this.shells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.starfish = new THREE.InstancedMesh(
      starGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true }),
      MAX_SHELL_N
    );
    this.starfish.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_SHELL_N * 3; i++) this.shellSeed[i] = hash(i * 11.3 + 91);
    this.scene.add(this.shells, this.starfish);
  }

  /** winter icicles — small translucent spikes hanging from each lamp arm */
  private buildIcicles() {
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 3; k++) {
      const g = new THREE.ConeGeometry(0.035, 0.3 + k * 0.12, 5);
      g.rotateX(Math.PI);
      g.translate((k - 1) * 0.22, -0.15 - k * 0.05, 0);
      parts.push(g);
    }
    this.icicles = new THREE.InstancedMesh(
      mergeGeometries(parts)!,
      new THREE.MeshStandardMaterial({
        color: '#cfe8ff',
        roughness: 0.15,
        metalness: 0.1,
        transparent: true,
        opacity: 0.85,
        flatShading: true,
      }),
      ICICLE_N
    );
    this.icicles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < ICICLE_N; i++) this.icicles.setMatrixAt(i, zero);
    this.icicles.instanceMatrix.needsUpdate = true;
    this.scene.add(this.icicles);
  }

  // ---------- weather ----------
  /**
   * Select the weather. 'auto' follows the active theme's default weather;
   * any other mode is decoupled from the theme and can combine freely.
   */
  setWeather(mode: WeatherMode) {
    this.weatherMode = mode;
    this.applyWeatherTargets();
  }

  getWeather(): WeatherMode {
    return this.weatherMode;
  }

  /** the resolved (non-auto) weather currently in effect */
  getEffectiveWeather(): Exclude<WeatherMode, 'auto'> {
    return this.effWeather;
  }

  getMapKind(): 'nature' | 'city' | 'beach' {
    return this.mapKind;
  }

  // ---------- quality ----------
  /**
   * 运行时切换画质档位。新增方法，不改既有签名。
   * 会重建 composer（MSAA samples / RT 类型只能在建 RT 时生效）。
   */
  setQuality(level: QualityLevel) {
    if (level === this.quality) return;
    this.quality = level;
    const qs = QUALITY_SETTINGS[level];
    this.fogBreath = qs.fogBreath;

    // 与构造函数共用同一实现；重建后 bloom 是全新实例，需重设参数
    this.buildComposer();
    if (this.theme) {
      this.bloom.strength = this.theme.bloom;
      this.bloom.radius = this.theme.bloomRadius * qs.bloomRadiusScale;
    }
    this.resize();

    if (this.contactShadows) this.contactShadows.visible = qs.contactShadows && qs.shadowQuality > 0;

    // 场景元素密度随档位重算（不重建几何）——先算，applyDecorDensity 依赖 this.extras
    this.applyDensity();
    // 装饰密度变化需重建相关实例系统
    this.applyDecorDensity();
  }

  getQuality(): QualityLevel {
    return this.quality;
  }

  /**
   * 按当前档位调整装饰密度。decorDensity 的真正消费者。
   *
   * 这些装饰都是 THREE.Points + BufferGeometry，所以用 setDrawRange 控制
   * 实际绘制的顶点子集即可——不重建几何、不重新分配显存，切换档位零卡顿。
   * 萤火虫/风痕的顶点顺序是随机的，截断不会产生可见的聚集感。
   */
  private applyDecorDensity() {
    const d = QUALITY_SETTINGS[this.quality].decorDensity;
    const limit = (pts: THREE.Points | undefined | null) => {
      if (!pts) return;
      const attr = pts.geometry.getAttribute('position');
      if (!attr) return;
      pts.geometry.setDrawRange(0, Math.max(1, Math.floor(attr.count * d)));
    };
    limit(this.fireflies);
    limit(this.streaks);
    // 星空：按档位 setDrawRange（600 / 1200 / 2000）——用 starCount 而非 decorDensity，
    // 因为星星在夜空是主视觉，不应该与「装饰密度」共用一个乘数导致高质量档也偏稀。
    const sc = QUALITY_SETTINGS[this.quality].starCount;
    const starAttr = this.stars.geometry.getAttribute('position');
    if (starAttr) this.stars.geometry.setDrawRange(0, Math.min(starAttr.count, sc));
    // 蝴蝶是可交互的 Group，逐个开关（数量少，开销可忽略）
    // ambienceExtras=false（low 档）时只保留 1 只；否则按 decorDensity 缩放
    const shown = this.extras
      ? Math.max(1, Math.round(this.butterflies.length * Math.min(1, d)))
      : Math.min(1, this.butterflies.length);
    this.butterflies.forEach((g, i) => {
      g.visible = i < shown;
    });
  }

  /**
   * 按当前档位重算「场景元素实际绘制数量」。
   *
   * ★ 与 applyDecorDensity 的分工：
   *   - applyDecorDensity：只调 Points 的 setDrawRange + 蝴蝶/额外层可见性（轻量）
   *   - applyDensity（本方法）：重算 grass/reed/.../shell 的 effective count，
   *     并同步 InstancedMesh 的 count（.count 可运行时改，不用重建 buffer）。
   *
   * 关键：InstancedMesh.count 可以直接赋值来「少画」尾部实例——three 按 count 遍历，
   * 不读 instanceMatrix 之外的资源，因此切档零重建、零卡顿。
   * 但 count 只能「减到不超过容量」；容量恒为 MAX_*，所以任何档位都能安全下调。
   */
  private applyDensity() {
    const s = QUALITY_SETTINGS[this.quality].densityScale;
    const eff = (base: number, max: number) =>
      Math.min(max, Math.max(1, Math.round(base * Math.max(MIN_DENSITY, s))));
    this.grassN = eff(BASE_GRASS_N, MAX_GRASS_N);
    this.reedN = eff(BASE_REED_N, MAX_REED_N);
    this.flowerN = eff(BASE_FLOWER_N, MAX_FLOWER_N);
    this.treeN = eff(BASE_TREE_N, MAX_TREE_N);
    this.rockN = eff(BASE_ROCK_N, MAX_ROCK_N);
    this.bushN = eff(BASE_BUSH_N, MAX_BUSH_N);
    this.mushN = eff(BASE_MUSH_N, MAX_MUSH_N);
    this.stumpN = eff(BASE_STUMP_N, MAX_STUMP_N);
    this.puddleN = eff(BASE_PUDDLE_N, MAX_PUDDLE_N);
    this.lampN = eff(BASE_LAMP_N, MAX_LAMP_N);
    this.cloudN = eff(BASE_CLOUD_N, MAX_CLOUD_N);
    this.butterflyN = eff(BASE_BUTTERFLY_N, MAX_BUTTERFLY_N);
    this.buildN = eff(BASE_BUILD_N, MAX_BUILD_N);
    this.neonN = eff(BASE_NEON_N, MAX_NEON_N);
    this.trafficN = eff(BASE_TRAFFIC_N, MAX_TRAFFIC_N);
    this.palmN = eff(BASE_PALM_N, MAX_PALM_N);
    this.umbrellaN = eff(BASE_UMBRELLA_N, MAX_UMBRELLA_N);
    this.shellN = eff(BASE_SHELL_N, MAX_SHELL_N);
    this.mossN = eff(BASE_MOSS_N, MAX_MOSS_N);
    this.tallGrassN = eff(BASE_TALLGRASS_N, MAX_TALLGRASS_N);
    this.curbN = eff(BASE_CURB_N, MAX_CURB_N);
    this.decalN = eff(BASE_DECAL_N, MAX_DECAL_N);
    this.benchN = eff(BASE_BENCH_N, MAX_BENCH_N);
    this.signN = eff(BASE_SIGN_N, MAX_SIGN_N);
    this.fenceN = eff(BASE_FENCE_N, MAX_FENCE_N);
    this.extras = QUALITY_SETTINGS[this.quality].ambienceExtras;

    // 同步 InstancedMesh 的绘制数量（只为已有实例设置；未构建的跳过）
    const setCount = (m: THREE.InstancedMesh | undefined, n: number) => {
      if (m) m.count = n;
    };
    setCount(this.grass, this.grassN);
    setCount(this.reeds, this.reedN);
    setCount(this.stems, this.flowerN);
    setCount(this.heads, this.flowerN);
    setCount(this.petalHeads, this.flowerN);
    setCount(this.bellHeads, this.flowerN);
    setCount(this.trunks, this.treeN);
    setCount(this.canopyLow, this.treeN * 2);
    setCount(this.canopyTop, this.treeN);
    setCount(this.pines, this.treeN);
    setCount(this.snowCaps, this.treeN);
    setCount(this.rocks, this.rockN);
    setCount(this.bushes, this.bushN);
    setCount(this.mushrooms, this.mushN);
    setCount(this.stumps, this.stumpN);
    setCount(this.puddles, this.puddleN);
    setCount(this.buildings, this.buildN);
    setCount(this.neon, this.neonN);
    setCount(this.palms, this.palmN);
    setCount(this.fronds, this.palmN);
    setCount(this.umbrellas, this.umbrellaN);
    setCount(this.shells, this.shellN);
    setCount(this.starfish, this.shellN);
    // P3 微细节层：low 档（extras=false）整体不画
    setCount(this.mosses, this.extras ? this.mossN : 0);
    setCount(this.tallGrass, this.extras ? this.tallGrassN : 0);
    setCount(this.curbs, this.extras ? this.curbN * 2 : 0);
    setCount(this.decals, this.extras ? this.decalN : 0);
    setCount(this.benches, this.extras ? this.benchN : 0);
    setCount(this.signs, this.extras ? this.signN : 0);
    setCount(this.fences, this.extras ? this.fenceN * 2 : 0);
    // 红绿灯：Group 数组，可见性 = 「主题族允许」&&「档位允许」，见 refreshPropVisibility()
    this.traffic.forEach((g, i) => {
      g.userData.byDensity = i < this.trafficN;
    });
    // 云：同上
    this.clouds.forEach((g, i) => {
      g.userData.byDensity = i < this.cloudN;
    });
    // 路灯：多出的灯柱整体隐藏（含光晕/光锥），并按新数量刷新光池数组
    // lampLayers 控制光晕层数：1=仅内核 / 2=+中层 / 3=+外层雾晕（high）
    const lampLayers = QUALITY_SETTINGS[this.quality].lampLayers;
    const volumetric = QUALITY_SETTINGS[this.quality].volumetricLight;
    this.lamps.forEach((l, i) => {
      const on = i < this.lampN;
      l.group.visible = on;
      l.glowOuter.visible = lampLayers >= 2;
      l.glowFar.visible = lampLayers >= 3;
      // 体积光锥（cone）是填充大户：只在高档开启，中低档完全关掉
      l.cone.visible = volumetric;
      // godrayLayers：地面光池贴片（spot）的档位开关。0 = 完全不要光池（最低档），
      // ≥1 = 开启。它与 cone 是两个独立的「光柱体」元素，分开控制才能做到
      // 「低档连光池都不画」而「中档有光池但无锥体」。
      l.spot.visible = QUALITY_SETTINGS[this.quality].godrayLayers >= 1;
      if (!on) this.roadU.uLampI.value[l.slot] = 0;
    });
    for (let i = this.lampN; i < MAX_LAMP_N; i++) this.roadU.uLampI.value[i] = 0;

    this.refreshPropVisibility();
  }

  /**
   * 统一刷新「分组数组型道具」的可见性。
   *
   * ★ 为什么需要这一层：traffic / clouds 这类道具的可见性同时受两个正交开关控制——
   *   - 主题族开关：如红绿灯只在 city 出现（由 setTheme 决定）
   *   - 档位开关：如 low 档只保留一部分（由 applyDensity 决定）
   * 若两处各自直接写 visible，后调用者会覆盖前者（例如 setTheme 会把低档裁掉的红绿灯
   * 重新点亮，且它们位置是上一轮的陈旧值 → 出现「卡在路边的幽灵红绿灯」）。
   * 因此两个开关分别写入 userData，再由本方法合成最终 visible。
   */
  private refreshPropVisibility() {
    for (const g of this.traffic) {
      g.visible = !!g.userData.familyOn && !!g.userData.byDensity;
    }
    for (const g of this.clouds) {
      // 云在所有主题都出现，familyOn 缺省视为 true
      g.visible = g.userData.familyOn !== false && g.userData.byDensity !== false;
    }
  }

  /** recompute intensity targets from the effective weather mode */
  private applyWeatherTargets() {
    const w = this.weatherMode === 'auto' ? this.theme?.defaultWeather || 'clear' : this.weatherMode;
    this.effWeather = w;
    const T = this.wT;
    T.petals = w === 'petals' ? 0.9 : 0;
    T.leaves = w === 'leaves' ? 0.9 : w === 'wind' ? 0.22 : 0;
    T.snow = w === 'snow' ? 0.55 : w === 'snowstorm' ? 1 : 0;
    T.rain = w === 'rain' ? 0.9 : 0;
    T.wind = w === 'wind' ? 1 : w === 'snowstorm' ? 0.7 : w === 'leaves' ? 0.35 : w === 'rain' ? 0.3 : 0;
    // 风痕：仅 wind 天气显式出现（snowstorm 时由雪本体承担视觉，不叠加避免过乱）
    T.streaks = w === 'wind' ? 0.85 : 0;
  }

  // ---------- theme ----------
  setTheme(theme: ThemePreset) {
    this.theme = theme;
    this.scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);
    // 海面为自定义 shader，需手动同步雾参数（scene.fog 对其无效）
    this.seaU?.uFogColor.value.set(theme.fog);
    if (this.seaU) {
      this.seaU.uFogDensity.value = theme.fogDensity;
      // P6 反射带参数：强度取主题 seaReflect，颜色取天体色，位置跟着天体横移
      this.seaU.uReflect.value = theme.seaReflect ?? 0.5;
      this.seaU.uReflectCol.value.set(theme.celestialColor);
      // celestialX 是 -0.6~0.6 的横移系数 → 映射到海面 uv.y 的 0~1
      this.seaU.uReflectX.value = 0.5 + theme.celestialX * 0.42;
    }
    (this.ground.material as THREE.MeshStandardMaterial).color.set(theme.ground);
    this.skyUniforms.top.value.set(theme.skyTop);
    this.skyUniforms.bottom.value.set(theme.skyBottom);
    // P6 地平线雾色：默认取主题 fog（保证与地面/山剪影的雾同色 → 天地无缝），
    // 主题可用 mistColor 覆写成更暖/更冷的独立色（如黄昏的橙雾）。
    this.skyUniforms.mist.value.set(theme.mistColor ?? theme.fog);
    // 锐度：夜景（星空/极光）用更硬的过渡让星空「压」在地平线上；日景更柔
    this.skyUniforms.horizonSharp.value = theme.night ? 1.05 : 0.7;
    this.ambient.color.set(theme.ambient);
    this.ambient.intensity = theme.ambientIntensity;
    this.sun.color.set(theme.sunColor);
    this.sun.intensity = theme.sunIntensity;
    this.sun.position.set(...theme.sunPosition);
    // 半球光：天空侧取主题天顶色；地面侧取 ambientGround（新增，独立于雾色，做环境光上下分层），
    // 未填则退化为雾色（旧行为）。强度由 hemiIntensity 显式化（未填则 night?0.34:0.5）。
    this.hemi.color.set(theme.skyTop);
    this.hemi.groundColor.set(theme.ambientGround ?? theme.fog);
    this.hemi.intensity = theme.hemiIntensity ?? (theme.night ? 0.34 : 0.5);
    this.bloom.strength = theme.bloom;
    this.bloom.radius = theme.bloomRadius * QUALITY_SETTINGS[this.quality].bloomRadiusScale;
    this.renderer.toneMappingExposure = theme.exposure;
    this.charLight.color.set(theme.characterHalo);
    this.charHalo.material.color.set(theme.characterHalo);
    (this.charCore.material as THREE.MeshStandardMaterial).emissive.set(theme.characterCore);
    (this.charCore.material as THREE.MeshStandardMaterial).color.set(theme.characterCore);

    // road palette uniforms
    for (let i = 0; i < 4; i++) this.roadU.uRoadCols.value[i].set(theme.roadBase[i % theme.roadBase.length]);
    for (let i = 0; i < 3; i++) this.roadU.uCurbCols.value[i].set(theme.curb[i % theme.curb.length]);
    this.roadU.uLampCol.value.set(theme.lampGlow);

    // clouds & fireflies adapt to theme brightness
    const night = theme.night;
    for (let i = 0; i < this.cloudMats.length; i++) {
      const base = 0.5 + this.cloudSeed[i * 4 + 3] * 0.4;
      this.cloudMats[i].color.set(night ? '#2c3a5e' : '#f5f2ea');
      this.cloudMats[i].opacity = night ? base * 0.55 : base;
    }
    // 萤火虫颜色改由主题 particleColor 决定（见下方粒子调色板段）；此处只处理透明度
    this.fireflyUniforms.uOpacity.value = night ? 0.9 : theme.defaultWeather === 'leaves' ? 0.75 : 0.45;

    // mountains — silhouette layers tinted per theme
    for (let l = 0; l < 3; l++) this.mountainMats[l].color.set(theme.mountains[l]);
    // 山脊亮线：夜晚主题更亮（月光/雪光更明显），白天收敛
    for (let l = 0; l < 3; l++) {
      const rm = this.mountainRidgeMats[l];
      if (!rm) continue;
      rm.color.set(night ? '#ffffff' : theme.mountains[l]).lerp(new THREE.Color('#ffffff'), night ? 0.6 : 0.35);
      rm.opacity = night ? 0.1 : 0.05;
    }

    // celestial body: spring sun glow / autumn sunset disc / winter moon
    (this.celestialDisc.material as THREE.MeshBasicMaterial).color.set(theme.celestialColor);
    this.celestialGlow.material.color.set(theme.celestialGlow);
    const cScale = theme.celestialSize;
    this.celestialDisc.scale.setScalar(cScale);
    const gScale = cScale * (night ? 3.2 : 3.8);
    this.celestialGlow.scale.set(gScale, gScale, 1);

    // aurora + meteors only in the winter night
    this.aurora.visible = theme.aurora;
    if (!theme.aurora) this.auroraUniforms.uOpacity.value = 0;
    for (const m of this.meteors) m.visible = night;

    // butterflies only in spring
    for (let i = 0; i < this.butterflies.length; i++) {
      this.butterflies[i].visible = theme.butterflies;
      if (theme.butterflies) {
        const c = theme.flowerPetals[i % theme.flowerPetals.length];
        (this.butterflyWings[i * 2].material as THREE.MeshBasicMaterial).color.set(c);
        (this.butterflyWings[i * 2 + 1].material as THREE.MeshBasicMaterial).color.set(c);
      }
    }

    // winter dressing: snowy road shader, stronger lamp glow, capped canopies
    this.roadU.uSnow.value = theme.id === 'winter' ? 1 : 0;
    this.roadU.uMoss.value = theme.id === 'spring' ? 1 : 0;
    this.roadU.uLeaf.value = theme.id === 'autumn' ? 1 : 0;
    this.roadU.uZebra.value = theme.mapKind === 'city' ? 1 : 0;
    // 夜间灯光聚焦：在原有 1.5 倍基础上再乘主题 lampFocus（夜都/冬夜灯光更集中）
    this.lampGlowBoost = night ? 1.5 * (theme.lampFocus ?? 1.2) : 1;
    if (!night) {
      // collapse caps once; update() skips writing them outside winter
      dummy.position.set(0, -10, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      for (let i = 0; i < MAX_TREE_N; i++) this.snowCaps.setMatrixAt(i, dummy.matrix);
      this.snowCaps.instanceMatrix.needsUpdate = true;
    } else {
      (this.snowCaps.material as THREE.MeshStandardMaterial).color.set(theme.snowCap);
    }

    // 主题粒子调色板 → 接通到萤火虫与风痕（原先 particleColor/particlePalette 是死字段）
    this.fireflyUniforms.uColor.value.set(theme.particleColor);
    if (this.streakU) {
      const pp = theme.particlePalette;
      this.streakU.uColA.value.set(pp[0] ?? theme.particleColor);
      this.streakU.uColB.value.set(pp[1 % pp.length] ?? theme.particleColor);
      this.streakU.uColC.value.set(pp[2 % pp.length] ?? theme.particleColor);
    }

    // puddles reflect the sky, tinted per theme
    this.puddleMat.color.set(theme.skyBottom).multiplyScalar(0.35);
    this.puddleMat.emissive.set(theme.lampGlow).multiplyScalar(0.05);

    // lamps
    this.lampPoleMat.color.set(theme.lampPole);
    this.lampHeadMat.emissive.set(theme.lampGlow);
    this.lampHeadMat.color.set(theme.lampGlow);
    for (const l of this.lamps) {
      l.glow.material.color.set(theme.lampGlow);
      l.glowOuter.material.color.set(theme.lampGlow);
      // 外层雾晕用 godrayColor（若主题给了）→ 让「灯把空气染成什么色」与主题一致
      l.glowFar.material.color.set(theme.godrayColor ?? theme.lampGlow);
      l.spot.material.color.set(theme.lampGlow);
      ((l.cone.material as THREE.ShaderMaterial).uniforms.color.value as THREE.Color).set(theme.coneColor);
    }

    // P6 霓虹上色：逐实例取 neonHue（未定义时回退 lampGlow），并做轻微「亮度呼吸」偏移，
    // 让相邻灯牌颜色错开、不呈现同一批次的机械感。夜晚更强，白天压暗（白昼霓虹本就该弱）。
    {
      const hues = theme.neonHue ?? [theme.lampGlow];
      const neonGain = theme.night ? 1 : 0.55;
      for (let i = 0; i < MAX_NEON_N; i++) {
        const c = tmpColor.set(hues[(hash(i * 4.7 + 31) * hues.length) | 0]);
        const b = 0.75 + hash(i * 9.3 + 5) * 0.35; // 亮度错落
        this.neon.setColorAt(i, c.multiplyScalar(b * neonGain));
      }
      this.neon.instanceColor!.needsUpdate = true;
    }

    // GPU particle palettes (petals from the theme's flower palette, leaves/snow fixed-ish)
    const pal = theme.particlePalette;
    this.petalU.uColA.value.set(theme.flowerPetals[0] || '#ffc7da');
    this.petalU.uColB.value.set(theme.flowerPetals[1] || '#ffffff');
    this.petalU.uColC.value.set(theme.flowerPetals[2] || '#f6b8c8');
    this.leafU.uColA.value.set(pal[0] || '#f2c063');
    this.leafU.uColB.value.set(pal[1] || '#e8963f');
    this.leafU.uColC.value.set(pal[2] || '#d97b3f');
    this.snowU.uColA.value.set('#ffffff');
    this.snowU.uColB.value.set('#dfeaff');
    this.snowU.uColC.value.set('#bcd7ff');
    this.rainU.uColA.value.set('#a8c8e8');
    this.rainU.uColB.value.set('#c8dcf0');
    this.rainU.uColC.value.set('#90b8d8');
    (this.stars.material as THREE.PointsMaterial).opacity = night ? 0.9 : 0;

    // map layout: toggle prop families
    this.mapKind = theme.mapKind;
    const isNature = theme.mapKind === 'nature';
    const isCity = theme.mapKind === 'city';
    const isBeach = theme.mapKind === 'beach';
    this.trunks.visible = this.canopyLow.visible = this.canopyTop.visible = this.pines.visible = isNature;
    this.reeds.visible = this.mushrooms.visible = this.stumps.visible = isNature;
    this.stems.visible = this.heads.visible = this.petalHeads.visible = this.bellHeads.visible = isNature;
    this.grass.visible = !isCity;
    this.bushes.visible = !isCity;
    this.rocks.visible = !isCity;
    // P3：苔藓/高杆芒草属于自然植被层，城市主题不出现；路缘石/路面贴花依附于路面，全主题都有
    this.mosses.visible = !isCity;
    this.tallGrass.visible = !isCity;
    this.curbs.visible = true;
    this.decals.visible = true;
    // P4：长椅/路牌全主题有（城市与自然都可读）；篱笆只属于自然/海滩的野地边界
    this.benches.visible = true;
    this.signs.visible = true;
    this.fences.visible = !isCity;
    this.snowCaps.visible = isNature && theme.id === 'winter';
    for (const m of this.mountains) m.visible = isNature;
    // 远景剪影带：自然主题=树线，城市=楼线，海滩=稀疏椰林线；统一用一个几何，
    // 只换颜色与纵向缩放，避免为每个主题各建一套几何。
    this.farTreeLine.visible = !isBeach;
    this.farTreeLine.scale.set(isCity ? 1.0 : 1.2, isCity ? 1.35 : 1.0, 1);
    this.buildings.visible = this.neon.visible = isCity;
    for (const g of this.traffic) g.userData.familyOn = isCity;
    this.sea.visible = this.palms.visible = this.fronds.visible = isBeach;
    this.umbrellas.visible = this.shells.visible = this.starfish.visible = isBeach;
    this.icicles.visible = theme.id === 'winter';
    // 合成「主题族开关 + 档位开关」（避免 setTheme 覆盖低档位裁剪结果）
    this.refreshPropVisibility();

    // weather: 'auto' follows the new theme's default
    this.applyWeatherTargets();
    if (this.weatherMode === 'auto') {
      // snap intensities on theme change so the new scene starts coherent
      this.wI.petals = this.wT.petals;
      this.wI.leaves = this.wT.leaves;
      this.wI.snow = this.wT.snow;
      this.wI.rain = this.wT.rain;
      this.wI.wind = this.wT.wind;
      this.wI.streaks = this.wT.streaks;
    }

    // static instance colors
    for (let i = 0; i < MAX_GRASS_N; i++)
      this.grass.setColorAt(i, tmpColor.set(theme.foliage[(hash(i * 4.1) * theme.foliage.length) | 0]));
    this.grass.instanceColor!.needsUpdate = true;
    for (let i = 0; i < MAX_REED_N; i++)
      this.reeds.setColorAt(
        i,
        // ★ 视觉教训（第四轮）：reeds 旧值 = foliage 色再 lerp curb 0.3 ——
        //   秋季 foliage 是饱和橙红（#d97b3f/#c45a3a/#e8a04c），即便加宽了叶片，
        //   110 根「橙红细高叶」仍读成一排「红色竹签」。芦苇本就是偏枯黄/灰绿的
        //   老秆，颜色应当**明显退出 foliage 家族**：lerp 系数 0.3 → 0.72，
        //   主体变成 curb 的枯褐色，只留 28% 叶色 —— 这样它才退回「背景草秆」。
        tmpColor.set(theme.foliage[(hash(i * 2.7 + 9) * theme.foliage.length) | 0]).lerp(new THREE.Color(theme.curb[0]), 0.72)
      );
    this.reeds.instanceColor!.needsUpdate = true;
    for (let i = 0; i < MAX_FLOWER_N; i++) {
      const c = theme.flowerPetals[(hash(i * 6.3) * theme.flowerPetals.length) | 0];
      this.heads.setColorAt(i, tmpColor.set(c));
      this.petalHeads.setColorAt(i, tmpColor.set(theme.flowerPetals[(hash(i * 4.9 + 2) * theme.flowerPetals.length) | 0]));
      this.bellHeads.setColorAt(i, tmpColor.set(c).lerp(new THREE.Color('#ffffff'), 0.25));
    }
    this.heads.instanceColor!.needsUpdate = true;
    this.petalHeads.instanceColor!.needsUpdate = true;
    this.bellHeads.instanceColor!.needsUpdate = true;
    // 夜间提亮统一系数（nightLift）：原先各道具硬编码 0.3/0.35/0.4/0.45 导致提亮不一致，
    // 现在统一读主题 nightLift，同主题所有道具的夜间提亮台阶一致。
    const lift = night ? theme.nightLift ?? 0.35 : 0;
    this.snowCapColor.set(theme.snowCap);
    for (let i = 0; i < MAX_TREE_N; i++)
      this.trunks.setColorAt(i, tmpColor.set(theme.trunk).lerp(this.snowCapColor, lift * 0.5));
    this.trunks.instanceColor!.needsUpdate = true;
    for (let i = 0; i < MAX_TREE_N * 2; i++)
      this.canopyLow.setColorAt(
        i,
        tmpColor.set(theme.foliage[(hash(i * 9.7) * theme.foliage.length) | 0]).lerp(this.snowCapColor, lift)
      );
    this.canopyLow.instanceColor!.needsUpdate = true;
    for (let i = 0; i < MAX_TREE_N; i++) {
      this.canopyTop.setColorAt(
        i,
        tmpColor.set(theme.foliage[(hash(i * 12.3) * theme.foliage.length) | 0]).lerp(this.snowCapColor, lift)
      );
      // firs keep a cooler, darker tone; snow-dusted at night
      this.pines.setColorAt(
        i,
        tmpColor.set(theme.foliage[i % theme.foliage.length]).multiplyScalar(0.75).lerp(this.snowCapColor, lift)
      );
    }
    this.canopyTop.instanceColor!.needsUpdate = true;
    this.pines.instanceColor!.needsUpdate = true;
    for (let i = 0; i < MAX_ROCK_N; i++)
      this.rocks.setColorAt(
        i,
        tmpColor.set(theme.rock[(hash(i * 8.3) * theme.rock.length) | 0]).lerp(this.snowCapColor, lift * 1.15)
      );
    this.rocks.instanceColor!.needsUpdate = true;
    for (let i = 0; i < MAX_BUSH_N; i++)
      this.bushes.setColorAt(
        i,
        tmpColor.set(theme.foliage[(hash(i * 15.1) * theme.foliage.length) | 0]).lerp(this.snowCapColor, lift)
      );
    this.bushes.instanceColor!.needsUpdate = true;
    for (let i = 0; i < MAX_MUSH_N; i++)
      this.mushrooms.setColorAt(
        i,
        tmpColor.set(theme.flowerPetals[(hash(i * 10.7 + 5) * theme.flowerPetals.length) | 0])
      );
    this.mushrooms.instanceColor!.needsUpdate = true;
    for (let i = 0; i < MAX_STUMP_N; i++) this.stumps.setColorAt(i, tmpColor.set(theme.trunk));
    this.stumps.instanceColor!.needsUpdate = true;
    for (let i = 0; i < MAX_PUDDLE_N; i++) this.puddles.setColorAt(i, tmpColor.set('#ffffff'));
    this.puddles.instanceColor!.needsUpdate = true;

    // P3 微细节层配色（全部沿用主题既有色板，避免引入新色相破坏「材质与配色协调」）
    // 苔藓：取植被色再压暗 25%，形成「草叶亮 / 苔藓暗」的层次；夜间同 lift 提亮
    for (let i = 0; i < MAX_MOSS_N; i++)
      this.mosses.setColorAt(
        i,
        tmpColor
          .set(theme.foliage[(hash(i * 23.9 + 3) * theme.foliage.length) | 0])
          .multiplyScalar(0.75)
          .lerp(this.snowCapColor, lift * 0.8)
      );
    this.mosses.instanceColor!.needsUpdate = true;
    // 高杆芒草：植被色向路缘（curb）拉 40%，比 reeds 更「干」，在前景与草皮区分开
    for (let i = 0; i < MAX_TALLGRASS_N; i++)
      this.tallGrass.setColorAt(
        i,
        tmpColor
          .set(theme.foliage[(hash(i * 29.1 + 7) * theme.foliage.length) | 0])
          .lerp(new THREE.Color(theme.curb[0]), 0.4)
          .lerp(this.snowCapColor, lift * 0.9)
      );
    this.tallGrass.instanceColor!.needsUpdate = true;
    // 路缘石：用主题 rock 色板（石材语义），亮度略压，避免抢主体
    for (let i = 0; i < MAX_CURB_N * 2; i++)
      this.curbs.setColorAt(
        i,
        tmpColor.set(theme.rock[(hash(i * 31.7 + 11) * theme.rock.length) | 0]).multiplyScalar(0.88).lerp(this.snowCapColor, lift * 0.6)
      );
    this.curbs.instanceColor!.needsUpdate = true;
    // 路面贴花：Multiply 混合下 instanceColor 就是「乘数」——越接近 1 越不可见。
    // ★ 只允许 0.86~0.95（压暗 5%~14%）：读作「淡淡的湿痕/磨损」，绝不是黑斑。
    //   曾经的 0.72 × 0.85 ≈ 0.21 会把路面压成近黑，在浅色路面上直接变成「破洞」。
    {
      const roadDarkBias = theme.night ? 0.965 : 0.99;
      for (let i = 0; i < MAX_DECAL_N; i++) {
        const v = (0.9 + hash(i * 37.3 + 13) * 0.07) * roadDarkBias;
        this.decals.setColorAt(i, tmpColor.setRGB(v, v, v));
      }
      this.decals.instanceColor!.needsUpdate = true;
    }

    // 远景剪影带：由天空底色与雾色混合，并适当提亮，使其「像被大气层托亮」。
    // 比 mountainMats 更亮一档，形成「远 → 更远」的明度递进（近实远虚）。
    {
      const skyTop = theme.skyTop, skyBot = theme.skyBottom;
      const fm = this.farTreeMats[0];
      if (fm)
        fm.color
          .set(skyBot)
          .lerp(new THREE.Color(skyTop), 0.25)
          .lerp(new THREE.Color(theme.fog), 0.5)
          .multiplyScalar(theme.night ? 0.75 : 0.92);
    }

    // P4 路旁设施配色：木/金属语义，全部取自主题既有色板
    // 长椅：木色 = trunk 色（去掉夜提亮，保留木头本色）
    for (let i = 0; i < MAX_BENCH_N; i++)
      this.benches.setColorAt(i, tmpColor.set(theme.trunk).multiplyScalar(0.92));
    this.benches.instanceColor!.needsUpdate = true;
    // 路牌：面板用主题 curb 亮色（**不**再向纯白插值 0.28 —— 那会让面板在雾里
    // 读成「悬空的纸片」），只在夜间保留一点点提亮作为反光。
    for (let i = 0; i < MAX_SIGN_N; i++)
      this.signs.setColorAt(
        i,
        tmpColor
          .set(theme.curb[(hash(i * 43.1 + 17) * theme.curb.length) | 0])
          .multiplyScalar(0.78)
          .lerp(this.snowCapColor, lift * 0.25)
      );
    this.signs.instanceColor!.needsUpdate = true;
    // 篱笆：与 trunk 同族但明显更灰更旧（乘 0.62），退到背景层次，不抢植被
    for (let i = 0; i < MAX_FENCE_N * 2; i++)
      this.fences.setColorAt(i, tmpColor.set(theme.trunk).multiplyScalar(0.62).lerp(this.snowCapColor, lift * 0.3));
    this.fences.instanceColor!.needsUpdate = true;
  }

  /**
   * Staggered fade factor: grows in at the horizon, then stays fully visible until
   * the prop is completely past the camera (z > charZ + ~9, i.e. behind the
   * camera plane by roughly a quarter screen depth) and dissolves over a short,
   * soft band. Fade is scale-to-zero, so nothing semi-transparent ever occludes
   * the frame (no depthWrite hazards).
   */
  private genFade(z: number, zFar: number, zNear: number, seed: number): number {
    const span = zNear - zFar;
    const inT = (z - zFar) / (span * 0.14);
    // callers pass zNear = charZ + 2; camera sits at charZ + 8.6
    const outT = (zNear + 9 - z) / 4.5;
    return Math.max(0, Math.min(1, Math.min(inT, outT) * 1.9 - seed * 0.7));
  }

  /**
   * Ring-buffer slot for a roadside prop: position is a continuous function of
   * distance; appearance parameters re-randomize only when the instance wraps at
   * the far horizon (hidden by fog + fade-in), so recycling is invisible and the
   * per-frame cost is identical every frame.
   */
  private slot(i: number, n: number, span: number, jitter: number, out: { z: number; cycle: number }) {
    const off = (i / n) * span + jitter * (span / n) * 2.2;
    const d = this.distance + off;
    const c = Math.floor(d / span);
    out.cycle = c;
    // z sweeps from the far horizon (charZ + 16 - span) toward and past the
    // camera (charZ + 16 > camera z = charZ + 8.6) so props visibly leave the
    // screen before the late fade-out band dissolves them; at wrap the slot
    // snaps back behind the horizon (hidden by fog + fade-in) and rehashes.
    out.z = 16 - span - this.distance + (d - c * span);
    return out;
  }

  private slotOut = { z: 0, cycle: 0 };

  // ---------- frame ----------
  update(dt: number, playing: boolean, bands: { bass: number; mid: number; treble: number; level: number }) {
    this.t += dt;
    this.frame++;
    if (playing) this.distance += this.speed * dt; // constant forward speed
    this.smoothBass += (bands.bass - this.smoothBass) * Math.min(1, dt * 8);
    const pulse = this.smoothBass;
    const t = this.t;
    const theme = this.theme;
    if (!theme) return;
    const frame = this.frame;

    // ---- weather state machine: smooth intensities toward targets ----
    const wI = this.wI, wT = this.wT;
    const wLerp = Math.min(1, dt * 1.6);
    wI.petals += (wT.petals - wI.petals) * wLerp;
    wI.leaves += (wT.leaves - wI.leaves) * wLerp;
    wI.snow += (wT.snow - wI.snow) * wLerp;
    wI.rain += (wT.rain - wI.rain) * wLerp;
    wI.wind += (wT.wind - wI.wind) * wLerp;
    wI.streaks += (wT.streaks - wI.streaks) * wLerp;
    // gust envelope rides on top of the wind mode &&  (pure f(t), continuous)
    const gustEnv = Math.pow(Math.max(0, Math.sin(t * 0.42) * 0.65 + Math.sin(t * 0.17 + 1.3) * 0.5 - 0.15), 1.6);
    const gust = wI.wind * (0.35 + gustEnv) * (0.6 + bands.mid * 0.9);
    // snowfall grading: calm spells ↔ heavier flurries
    const snowFlurry = 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.sin(t * 0.21 + Math.sin(t * 0.09) * 1.8), 2);
    this.fireflyUniforms.uWind.value = gust;

    // GPU falling particles — a few uniform writes, zero per-particle CPU work
    const boost = 0.7 + bands.level * 1.1 + pulse * 0.6;
    const snowActive = wI.snow > 0.02;
    this.petalU.uT.value = t;
    this.petalU.uDist.value = this.distance;
    this.petalU.uWind.value = gust;
    this.petalU.uBoost.value = boost;
    this.petalU.uIntensity.value = wI.petals;
    this.leafU.uT.value = t;
    this.leafU.uDist.value = this.distance;
    this.leafU.uWind.value = gust;
    this.leafU.uBoost.value = boost;
    this.leafU.uIntensity.value = wI.leaves;
    this.snowU.uT.value = t;
    this.snowU.uDist.value = this.distance;
    this.snowU.uWind.value = gust;
    this.snowU.uBoost.value = 0.8 + snowFlurry * 0.5;
    this.snowU.uIntensity.value = wI.snow * snowFlurry;
    this.rainU.uT.value = t;
    this.rainU.uDist.value = this.distance;
    this.rainU.uWind.value = gust;
    this.rainU.uIntensity.value = wI.rain;
    // 风痕：横向快扫，强度由 wI.streaks 平滑驱动
    this.streakU.uT.value = t;
    this.streakU.uDist.value = this.distance;
    this.streakU.uWind.value = gust;
    this.streakU.uBoost.value = 1.2 + bands.level * 0.8;
    this.streakU.uIntensity.value = wI.streaks;
    this.petals.visible = wI.petals > 0.01;
    this.leaves.visible = wI.leaves > 0.01;
    this.snow.visible = snowActive;
    this.rain.visible = wI.rain > 0.01;
    this.streaks.visible = wI.streaks > 0.01;

    const charZ = -this.distance;

    // road — static mesh; pattern scrolls in shader as f(distance), fully continuous
    this.roadU.uDist.value = this.distance;
    this.roadU.uPulse.value = pulse;
    this.roadU.uCharZ.value = charZ;
    this.roadU.uT.value = t;
    this.road.position.z = charZ + 10 - ROAD_LEN / 2;
    // sky, stars and ground follow so they never run out
    this.ground.position.z = charZ - 110;
    this.skyDome.position.z = charZ;
    this.stars.position.z = charZ;

    // 雾密度呼吸：夜雾更「沉」，日雾更轻。low 档关闭（fogBreath=false）以省常数级开销。
    // 海面是自定义 shader，scene.fog 对其无效，必须同步 uFogDensity，否则海天雾不一致。
    if (this.fogBreath) {
      const amp = theme.fogBreathAmp ?? 0.06;
      const spd = theme.fogBreathSpeed ?? 0.06;
      const fd = theme.fogDensity * (1 + Math.sin(t * spd) * amp);
      (this.scene.fog as THREE.FogExp2).density = fd;
      if (this.seaU) this.seaU.uFogDensity.value = fd;
    }

    // grass — continuous ring slots, random side/offset/size per cycle
    if (this.grass.visible)
    for (let i = 0; i < this.grassN; i++) {
      const s0 = this.grassSeed[i * 3], s2 = this.grassSeed[i * 3 + 2];
      const sl = this.slot(i, this.grassN, SPAN, s0, this.slotOut);
      const z = sl.z, cyc = sl.cycle;
      if (z < charZ - 55 && ((frame + i) & 1) === 1) continue; // far tufts update every other frame
      const side = hash2(cyc, i * 1.3) > 0.5 ? 1 : -1;
      const rx = hash2(cyc * 3.1, i);
      const sway = Math.sin(t * 1.8 + s2 * 12 + z * 0.4) * (0.12 + bands.mid * 0.35);
      // P5 踩草倒伏：角色前后 3.5m 内、靠近路肩（|x| < 7.5）的草被「压向路外」。
      // 采用「离角色越近倒得越多」的连续权重，而不是硬阈值——硬阈值会出现
      // 一撮草突然弹起的台阶感。注意倒伏方向是**远离角色**（-side），即向外倾倒。
      const dz = z - charZ;
      const near = this.extras ? Math.max(0, 1 - Math.abs(dz) / 3.5) : 0;
      const lean = near * near * 0.5 * (side > 0 ? -1 : 1);
      const gf = this.genFade(z, charZ - SPAN, charZ + 2, s2);
      dummy.position.set(side * (5.4 + rx * 2.6), 0, z); // strictly off the roadway (|x| > 5.2)
      dummy.rotation.set((rx - 0.5) * 0.3, s2 * 6.3 + cyc, sway * side + lean);
      dummy.scale.set(gf * (0.8 + s0 * 0.9), (0.7 + s0 * 1.2) * gf, gf);
      dummy.updateMatrix();
      this.grass.setMatrixAt(i, dummy.matrix);
    }
    this.grass.instanceMatrix.needsUpdate = true;

    // reeds — same ring slots, taller sway, sparser
    if (this.reeds.visible)
    for (let i = 0; i < this.reedN; i++) {
      const s0 = this.reedSeed[i * 3], s2 = this.reedSeed[i * 3 + 2];
      const sl = this.slot(i, this.reedN, SPAN, s0, this.slotOut);
      const z = sl.z, cyc = sl.cycle;
      if (z < charZ - 55 && ((frame + i) & 1) === 1) continue;
      const side = hash2(cyc * 1.3, i * 2.1) > 0.5 ? 1 : -1;
      const rx = hash2(cyc * 2.3, i + 17);
      const sway = Math.sin(t * 1.3 + s2 * 10 + z * 0.3) * (0.1 + bands.mid * 0.22);
      const gf = this.genFade(z, charZ - SPAN, charZ + 2, s2);
      // 后退到 6.2 起（旧 5.4）—— 让开 grass 的近景带，避免两层细叶在同一带内叠加成「刺丛」
      dummy.position.set(side * (6.2 + rx * 2.6), 0, z);
      dummy.rotation.set((rx - 0.5) * 0.2, s2 * 6.3 + cyc, sway * side);
      dummy.scale.set(gf * (0.7 + s0 * 0.5), (0.8 + s0 * 0.8) * gf, gf);
      dummy.updateMatrix();
      this.reeds.setMatrixAt(i, dummy.matrix);
    }
    this.reeds.instanceMatrix.needsUpdate = true;

    // ------------------------------------------------------------------
    // P3 微细节层 —— 静态摆放，只有「极轻微」的气流扰动（避免整体死板）。
    // 全部以 densityScale 为数量、genFade 为淡出、slot() 为环槽复用。
    // ------------------------------------------------------------------

    // L0 苔藓片：批量多、分布最宽、几乎贴地，铺在草丛与路肩之间的过渡带。
    if (this.mosses.visible)
    for (let i = 0; i < this.mossN; i++) {
      const s0 = this.mossSeed[i * 3], s1 = this.mossSeed[i * 3 + 1], s2 = this.mossSeed[i * 3 + 2];
      const sl = this.slot(i, this.mossN, SPAN, s0, this.slotOut);
      const z = sl.z, cyc = sl.cycle;
      if (z < charZ - 48 && ((frame + i) & 1) === 1) continue;
      const side = hash2(cyc * 2.7, i * 3.3) > 0.5 ? 1 : -1;
      // 苔藓比草更靠近路肩，是「人工路面 → 自然草皮」的过渡。
      // ★ 内沿必须让开路面：路面半宽 4.8，苔藓 X 半径最大约 1.1（见下方 scale），
      //   所以内沿至少 6.0 才不会压到路面（旧值 5.0 → 0.2 就贴到路沿上，读成「路上的碎块」）。
      const x = side * (6.0 + hash2(cyc, i * 5.5) * 3.5);
      const gf = this.genFade(z, charZ - SPAN, charZ + 2, s2);
      dummy.position.set(x, 0.03, z);
      dummy.rotation.set(0, s1 * 6.3 + cyc, 0);
      // ★ 视觉教训（第四轮）：旧值 Y 压到 0.06~0.13，而 X/Z 铺到 1.0~1.9 倍，
      //   在半径 0.34 的二十面体上得到长径比 ≈ 21:1 → 侧看就是一根「细刺/薄片」，
      //   15 个近景实例全部命中（CDP 实测 maxAspect=21.2）。这正是「满地的碎棍」的另一半来源。
      //   修法：Y 下限抬到能保持「扁但有厚度」（长径比 ≤ ~6:1），X/Z 收敛到 1.3~2.0。
      //   这样它才读作「一摊贴地的苔绿」，而不是「插在地上的薄片」。
      dummy.scale.set(gf * (1.3 + s0 * 0.7), gf * (0.42 + s1 * 0.16), gf * (1.3 + s2 * 0.7));
      dummy.updateMatrix();
      this.mosses.setMatrixAt(i, dummy.matrix);
    }
    this.mosses.instanceMatrix.needsUpdate = true;

    // L3 高杆芒草：数量中等，站得最高，只在远侧（|x| 7~13）出现，
    // 让地平线下方始终有一条毛茸茸的草尖带 —— 这是拉深度的关键一层。
    if (this.tallGrass.visible)
    for (let i = 0; i < this.tallGrassN; i++) {
      const s0 = this.tallGrassSeed[i * 3], s2 = this.tallGrassSeed[i * 3 + 2];
      const sl = this.slot(i, this.tallGrassN, SPAN, s0, this.slotOut);
      const z = sl.z, cyc = sl.cycle;
      if (z < charZ - 60 && ((frame + i) & 1) === 1) continue; // 最远层，更新更省
      const side = hash2(cyc * 3.9, i * 1.7) > 0.5 ? 1 : -1;
      const rx = hash2(cyc * 2.1, i + 41);
      const sway = Math.sin(t * 1.05 + s2 * 8 + z * 0.22) * (0.08 + bands.mid * 0.18);
      const gf = this.genFade(z, charZ - SPAN, charZ + 2, s2);
      // 内沿让开路面：草丛 X 半径最大约 1.3，内沿 6.4 → 最近处 5.1，仍在路沿 4.8 之外
      dummy.position.set(side * (6.4 + rx * 5.2), 0, z);
      // 倾角收敛（±0.18 → ±0.10）：过大的随机倾角是「倒伏的木棍」观感的主要来源
      dummy.rotation.set((rx - 0.5) * 0.1, s2 * 6.3 + cyc, sway * side);
      dummy.scale.set(gf * (0.9 + s0 * 0.45), (0.9 + s0 * 0.5) * gf, gf);
      dummy.updateMatrix();
      this.tallGrass.setMatrixAt(i, dummy.matrix);
    }
    this.tallGrass.instanceMatrix.needsUpdate = true;

    // 路缘石：沿两侧等距硬排（类似灯柱的固定节奏），缩放不随脉动，只有 genFade 淡出。
    // 位置严格夹在路面外沿（|x| = 5.15），与道路 shader 的 curb 色带对齐。
    if (this.curbs.visible) {
      const ccs = SPAN / this.curbN;
      for (let i = 0; i < this.curbN; i++) {
        const s1 = this.curbSeed[i * 3 + 1], s2 = this.curbSeed[i * 3 + 2];
        for (let side = -1; side <= 1; side += 2) {
          const k = i * 2 + (side > 0 ? 1 : 0);
          // 用同一套 slot 节奏，但在 z 上做半个间隔的交错，避免左右完全对称的机械感
          const sl = this.slot(k, this.curbN * 2, SPAN, s1, this.slotOut);
          const z = sl.z + (side > 0 ? ccs * 0.5 : 0);
          const gf = this.genFade(z, charZ - SPAN, charZ + 2, s2);
          if (gf <= 0.001) {
            dummy.scale.set(0, 0, 0);
          } else {
            dummy.position.set(side * 5.15, 0.055, z);
            dummy.rotation.set(0, (s1 - 0.5) * 0.1, 0);
            // 长度随机，偶尔缺一块（s2 < 0.12）→ 像被踩缺的路肩
            const gap = s2 < 0.12 ? 0 : 1;
            dummy.scale.set(gf * gap, gf, gf * (0.8 + s2 * 0.6));
          }
          dummy.updateMatrix();
          this.curbs.setMatrixAt(k, dummy.matrix);
        }
      }
      this.curbs.instanceMatrix.needsUpdate = true;
    }

    // 路面贴花：贴地圆片，缓慢横向漂移（视觉上是「路面在动」而非贴花在动），
    // 用极低 opacity + 随机大小制造路面磨损/补丁的斑驳感。
    if (this.decals.visible)
    for (let i = 0; i < this.decalN; i++) {
      const s0 = this.decalSeed[i * 3], s1 = this.decalSeed[i * 3 + 1], s2 = this.decalSeed[i * 3 + 2];
      const sl = this.slot(i, this.decalN, SPAN, s0, this.slotOut);
      const z = sl.z, cyc = sl.cycle;
      if (z < charZ - 40 && ((frame + i) & 1) === 1) continue;
      const gf = this.genFade(z, charZ - SPAN, charZ + 2, s0);
      // 横向压在路面宽度内（±4.8），纵向随机旋转避免看出是圆
      dummy.position.set((hash2(cyc * 4.3, i * 6.1) - 0.5) * 9.6, 0.012, z);
      dummy.rotation.set(-Math.PI / 2, 0, s1 * 6.3 + cyc * 2.4);
      // 尺寸收小（0.4~0.9 倍）：大片贴花即便很淡也更容易读成「异物」
      const ds = gf * (0.4 + s2 * 0.5);
      dummy.scale.set(ds * (0.75 + s0 * 0.7), ds, ds);
      dummy.updateMatrix();
      this.decals.setMatrixAt(i, dummy.matrix);
    }
    this.decals.instanceMatrix.needsUpdate = true;

    // ------------------------------------------------------------------
    // P4 路旁设施 —— 位置固定、姿态固定（椅子不会随风摇摆），只保留 genFade 与
    // 极微小的「坐面落雪/落尘」反应，避免出现「活物」的错觉。
    // ------------------------------------------------------------------

    // 长椅：朝向道路（rotation.y = ±π/2 让椅背朝外），间隔较大，成组出现
    if (this.benches.visible)
    for (let i = 0; i < this.benchN; i++) {
      const s0 = this.benchSeed[i * 3], s1 = this.benchSeed[i * 3 + 1], s2 = this.benchSeed[i * 3 + 2];
      const sl = this.slot(i, this.benchN, SPAN, s0, this.slotOut);
      const z = sl.z;
      const gf = this.genFade(z, charZ - SPAN, charZ + 2, s2);
      if (gf <= 0.001) {
        dummy.scale.set(0, 0, 0);
      } else {
        const side = s1 > 0.5 ? 1 : -1;
        dummy.position.set(side * 6.3, 0, z);
        // 椅背朝外：站侧决定朝向，附加一点随机的「摆放不正」感
        dummy.rotation.set(0, (side > 0 ? -Math.PI / 2 : Math.PI / 2) + (s0 - 0.5) * 0.22, 0);
        dummy.scale.setScalar(gf);
      }
      dummy.updateMatrix();
      this.benches.setMatrixAt(i, dummy.matrix);
    }
    this.benches.instanceMatrix.needsUpdate = true;

    // 路牌：细杆立在草皮带边缘，面板朝向道路前方（rotation.y = 0 面向摄像机来的方向）
    if (this.signs.visible)
    for (let i = 0; i < this.signN; i++) {
      const s0 = this.signSeed[i * 3], s1 = this.signSeed[i * 3 + 1], s2 = this.signSeed[i * 3 + 2];
      const sl = this.slot(i, this.signN, SPAN, s0, this.slotOut);
      const z = sl.z;
      const gf = this.genFade(z, charZ - SPAN, charZ + 2, s2);
      if (gf <= 0.001) {
        dummy.scale.set(0, 0, 0);
      } else {
        const side = s1 > 0.5 ? 1 : -1;
        dummy.position.set(side * (5.9 + s0 * 0.5), 0, z);
        dummy.rotation.set(0, (s0 - 0.5) * 0.5, 0);
        dummy.scale.set(gf, gf * (0.9 + s2 * 0.25), gf);
      }
      dummy.updateMatrix();
      this.signs.setMatrixAt(i, dummy.matrix);
    }
    this.signs.instanceMatrix.needsUpdate = true;

    // 篱笆：连续分段（间距 = SPAN / n，几乎首尾相接）→ 一条连续的矮栏线，
    // 只在自然主题出现，用来划分「草皮」与「更远的野地」。
    if (this.fences.visible) {
      const fspan = SPAN / this.fenceN;
      for (let i = 0; i < this.fenceN; i++) {
        const s1 = this.fenceSeed[i * 3 + 1], s2 = this.fenceSeed[i * 3 + 2];
        for (let side = -1; side <= 1; side += 2) {
          const k = i * 2 + (side > 0 ? 1 : 0);
          const sl = this.slot(k, this.fenceN * 2, SPAN, s1, this.slotOut);
          const z = sl.z;
          const gf = this.genFade(z, charZ - SPAN, charZ + 2, s2);
          if (gf <= 0.001) {
            dummy.scale.set(0, 0, 0);
          } else {
            // 偶尔断一段（s2 < 0.22）→ 显得年久失修而非程序生成
            const gap = s2 < 0.22 ? 0 : 1;
            dummy.position.set(side * (9.2 + s1 * 0.8), 0, z);
            dummy.rotation.set(0, (s1 - 0.5) * 0.1, (s1 - 0.5) * 0.06);
            // 每段只占间距的 55%，段与段之间留出真正的空隙（不再是连续栏杆）
            dummy.scale.set(gf * gap * (fspan / 1.2) * 0.55, gf, gf);
          }
          dummy.updateMatrix();
          this.fences.setMatrixAt(k, dummy.matrix);
        }
      }
      this.fences.instanceMatrix.needsUpdate = true;
    }

    // flowers — 3 head shapes partitioned by slot (i % 3): puff / five-petal / bell
    if (this.stems.visible)
    for (let i = 0; i < this.flowerN; i++) {
      const s0 = this.flowerSeed[i * 3], s2 = this.flowerSeed[i * 3 + 2];
      const sl = this.slot(i, this.flowerN, SPAN, s0, this.slotOut);
      const z = sl.z, cyc = sl.cycle;
      if (z < charZ - 55 && ((frame + i) & 1) === 1) continue;
      const side = hash2(cyc * 1.7, i * 2.9) > 0.48 ? 1 : -1;
      const x = side * (5.5 + hash2(cyc, i * 7.7) * 3.6);
      const sway = Math.sin(t * 2.2 + s2 * 9 + z * 0.3) * (0.08 + bands.treble * 0.3);
      const h = 0.4 + s0 * 0.5;
      const ff = this.genFade(z, charZ - SPAN, charZ + 2, s0);
      dummy.position.set(x, (h / 2) * ff, z);
      dummy.rotation.set(0, 0, sway);
      dummy.scale.set(ff, (h / 0.55) * ff, ff);
      dummy.updateMatrix();
      this.stems.setMatrixAt(i, dummy.matrix);
      const kind = i % 3;
      const hx = x + sway * h * ff;
      const hs = (0.8 + s2 * 0.5 + pulse * 0.25) * ff;
      if (kind === 0) {
        // puff ball
        dummy.position.set(hx, (h + 0.08 + pulse * 0.05) * ff, z);
        dummy.rotation.set(sway, t * 0.4 + s0 * 6, sway);
        dummy.scale.setScalar(hs);
        dummy.updateMatrix();
        this.heads.setMatrixAt(i, dummy.matrix);
      } else if (kind === 1) {
        // five-petal blossom, faces up with a gentle tilt
        dummy.position.set(hx, (h + 0.05 + pulse * 0.04) * ff, z);
        dummy.rotation.set(sway * 0.6 - 0.35, t * 0.15 + s0 * 6, sway * 0.6);
        dummy.scale.setScalar(hs * 1.15);
        dummy.updateMatrix();
        this.petalHeads.setMatrixAt(i, dummy.matrix);
      } else {
        // bell flower, hangs and nods below the stem tip
        dummy.position.set(hx, (h - 0.02) * ff, z);
        dummy.rotation.set(sway * 1.6, s0 * 6, sway * 1.6);
        dummy.scale.setScalar(hs * 1.05);
        dummy.updateMatrix();
        this.bellHeads.setMatrixAt(i, dummy.matrix);
      }
    }
    this.stems.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    this.petalHeads.instanceMatrix.needsUpdate = true;
    this.bellHeads.instanceMatrix.needsUpdate = true;

    // trees — 3 variants partitioned by slot: 0 round broadleaf, 1 upright fir, 2 droopy wide
    const snowy = this.roadU.uSnow.value > 0 && this.snowCaps.visible;
    if (this.trunks.visible)
    for (let i = 0; i < this.treeN; i++) {
      const s0 = this.treeSeed[i * 3], s1 = this.treeSeed[i * 3 + 1], s2 = this.treeSeed[i * 3 + 2];
      const sl = this.slot(i, this.treeN, TREE_SPAN, s0, this.slotOut);
      const z = sl.z, cyc = sl.cycle;
      if (z < charZ - 80 && ((frame + i) & 1) === 1) continue; // far trees stagger updates
      const present = hash2(cyc * 2.3, i * 5.1) > 0.22; // poisson-like gaps
      const side = hash2(cyc, i * 3.7) > 0.5 ? 1 : -1;
      const x = side * (6.2 + hash2(cyc * 1.9, i * 1.1) * 6.5);
      const tf = this.genFade(z, charZ - TREE_SPAN, charZ + 2, s0) * (present ? 1 : 0);
      const sc = (0.75 + s1 * 1.0) * tf;
      const lean = (hash2(cyc, i * 9.3) - 0.5) * 0.14;
      const breathe = 1 + Math.sin(t * 1.2 + i) * 0.02 + pulse * 0.07;
      const type = i % 3;
      // trunk (firs sit on a shorter, slimmer trunk)
      dummy.position.set(x, (type === 1 ? 0.9 : 1.2) * sc, z);
      dummy.rotation.set(lean * 0.5, s2 * 6.3, lean);
      dummy.scale.set(sc * (type === 1 ? 0.8 : 1), sc * (type === 1 ? 0.75 : 1), sc * (type === 1 ? 0.8 : 1));
      dummy.updateMatrix();
      this.trunks.setMatrixAt(i, dummy.matrix);
      if (type === 1) {
        // fir — merged triple-cone geometry, single write
        dummy.position.set(x + lean * 1.5 * sc, 0, z);
        dummy.rotation.set(lean * 0.4, s1 * 6.3 + t * 0.02, lean * 0.8);
        dummy.scale.set(sc * 1.05 * breathe, sc * (0.95 + s0 * 0.3) * breathe, sc * 1.05 * breathe);
        dummy.updateMatrix();
        this.pines.setMatrixAt(i, dummy.matrix);
        if (snowy) {
          dummy.position.set(x + lean * 1.5 * sc, 4.35 * sc, z);
          dummy.rotation.set(0, s1 * 6.3, 0);
          dummy.scale.set(sc * 0.42, sc * 0.5, sc * 0.42);
          dummy.updateMatrix();
          this.snowCaps.setMatrixAt(i, dummy.matrix);
        }
      } else if (type === 2) {
        // droopy wide tree — canopy blobs hung lower, broader, flatter
        for (let l = 0; l < 2; l++) {
          const li = i * 2 + l;
          const ls = sc * (1.5 - l * 0.45) * breathe;
          dummy.position.set(
            x + (hash2(cyc, li) - 0.5) * 1.6 * sc + lean * 2 * sc,
            (2.0 + l * 0.55) * sc,
            z + (hash2(cyc, li + 40) - 0.5) * 1.4 * sc
          );
          dummy.rotation.set(0, hash2(cyc, li * 2) * 6.3 + t * 0.02, lean);
          dummy.scale.set(ls, ls * 0.5 * (1 + pulse * 0.05), ls);
          dummy.updateMatrix();
          this.canopyLow.setMatrixAt(li, dummy.matrix);
        }
        dummy.position.set(x + lean * 2.5 * sc, (2.9 + s0 * 0.3) * sc, z);
        dummy.rotation.set(0, s1 * 6.3 + t * 0.03, 0);
        dummy.scale.set(sc * 1.05 * breathe, sc * 0.42 * breathe, sc * 1.05 * breathe);
        dummy.updateMatrix();
        this.canopyTop.setMatrixAt(i, dummy.matrix);
        if (snowy) {
          dummy.position.set(x + lean * 2.5 * sc, (3.2 + s0 * 0.3) * sc, z);
          dummy.rotation.set(0, s1 * 6.3, 0);
          dummy.scale.set(sc * 0.95, sc * 0.3, sc * 0.95);
          dummy.updateMatrix();
          this.snowCaps.setMatrixAt(i, dummy.matrix);
        }
      } else {
        // round broadleaf — two lower canopy blobs, offset for organic asymmetry
        for (let l = 0; l < 2; l++) {
          const li = i * 2 + l;
          const ls = sc * (1.25 - l * 0.38) * breathe;
          dummy.position.set(
            x + (hash2(cyc, li) - 0.5) * 1.1 * sc + lean * 2 * sc,
            (2.6 + l * 0.95) * sc,
            z + (hash2(cyc, li + 40) - 0.5) * 1.1 * sc
          );
          dummy.rotation.set(0, hash2(cyc, li * 2) * 6.3 + t * 0.02, lean);
          dummy.scale.set(ls, ls * 0.72 * (1 + pulse * 0.05), ls);
          dummy.updateMatrix();
          this.canopyLow.setMatrixAt(li, dummy.matrix);
        }
        // rounded top blob
        dummy.position.set(x + lean * 3 * sc, (3.9 + s0 * 0.5) * sc, z);
        dummy.rotation.set(0, s1 * 6.3 + t * 0.03, 0);
        dummy.scale.set(sc * 0.8 * breathe, sc * 0.62 * breathe, sc * 0.8 * breathe);
        dummy.updateMatrix();
        this.canopyTop.setMatrixAt(i, dummy.matrix);
        if (snowy) {
          dummy.position.set(x + lean * 3 * sc, (4.35 + s0 * 0.5) * sc, z);
          dummy.rotation.set(0, s1 * 6.3, 0);
          dummy.scale.set(sc * 0.7, sc * 0.32, sc * 0.7);
          dummy.updateMatrix();
          this.snowCaps.setMatrixAt(i, dummy.matrix);
        }
      }
    }
    this.trunks.instanceMatrix.needsUpdate = true;
    this.canopyLow.instanceMatrix.needsUpdate = true;
    this.canopyTop.instanceMatrix.needsUpdate = true;
    this.pines.instanceMatrix.needsUpdate = true;
    if (snowy) this.snowCaps.instanceMatrix.needsUpdate = true;

    // rocks & bushes — random scatter
    if (this.rocks.visible)
    for (let i = 0; i < this.rockN; i++) {
      const s0 = this.rockSeed[i * 3], s1 = this.rockSeed[i * 3 + 1], s2 = this.rockSeed[i * 3 + 2];
      const sl = this.slot(i, this.rockN, SPAN, s0, this.slotOut);
      const z = sl.z, cyc = sl.cycle;
      if (z < charZ - 55 && ((frame + i) & 1) === 1) continue;
      const side = hash2(cyc * 1.1, i * 4.3) > 0.5 ? 1 : -1;
      const rf = this.genFade(z, charZ - SPAN, charZ + 2, s2);
      const sc = (0.4 + s2 * 1.2) * rf;
      dummy.position.set(side * (5.4 + hash2(cyc, i * 6.7) * 4.2), 0.1 * sc, z); // ~7% sink, no floating
      dummy.rotation.set(s0 * 3 + cyc, s1 * 6, s2 * 2);
      dummy.scale.set(sc, sc * 0.55, sc * (0.7 + s1 * 0.5));
      dummy.updateMatrix();
      this.rocks.setMatrixAt(i, dummy.matrix);
    }
    this.rocks.instanceMatrix.needsUpdate = true;
    if (this.bushes.visible)
    for (let i = 0; i < this.bushN; i++) {
      const s0 = this.bushSeed[i * 3], s1 = this.bushSeed[i * 3 + 1], s2 = this.bushSeed[i * 3 + 2];
      const sl = this.slot(i, this.bushN, SPAN, s1, this.slotOut);
      const z = sl.z, cyc = sl.cycle;
      if (z < charZ - 55 && ((frame + i) & 1) === 1) continue;
      const side = hash2(cyc * 2.7, i * 1.9) > 0.5 ? 1 : -1;
      const bf = this.genFade(z, charZ - SPAN, charZ + 2, s0);
      const breathe = 1 + Math.sin(t * 1.5 + s2 * 9) * 0.03 + pulse * 0.05;
      const sc = (0.55 + s2 * 1.0) * bf * breathe;
      dummy.position.set(side * (5.6 + hash2(cyc, i * 8.9) * 3.9), 0.24 * sc, z); // ~8% sink into ground
      dummy.rotation.set(0, s0 * 6 + t * 0.01 + cyc, 0);
      dummy.scale.set(sc, sc * 0.72, sc);
      dummy.updateMatrix();
      this.bushes.setMatrixAt(i, dummy.matrix);
    }
    this.bushes.instanceMatrix.needsUpdate = true;

    // mushrooms — small clusters near the road edge, occasional
    if (this.mushrooms.visible)
    for (let i = 0; i < this.mushN; i++) {
      const s0 = this.mushSeed[i * 3], s1 = this.mushSeed[i * 3 + 1], s2 = this.mushSeed[i * 3 + 2];
      const sl = this.slot(i, this.mushN, SPAN, s0, this.slotOut);
      const z = sl.z, cyc = sl.cycle;
      if (z < charZ - 55 && ((frame + i) & 1) === 1) continue;
      const present = hash2(cyc * 3.7, i * 1.3) > 0.35; // patchy
      const side = hash2(cyc * 0.9, i * 5.7) > 0.5 ? 1 : -1;
      const mf = this.genFade(z, charZ - SPAN, charZ + 2, s1) * (present ? 1 : 0);
      const sc = (0.6 + s2 * 0.9) * mf;
      dummy.position.set(side * (5.4 + hash2(cyc, i * 3.1) * 2.2), 0, z);
      dummy.rotation.set((s1 - 0.5) * 0.25, s0 * 6.3 + cyc, (s2 - 0.5) * 0.25);
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      this.mushrooms.setMatrixAt(i, dummy.matrix);
    }
    this.mushrooms.instanceMatrix.needsUpdate = true;

    // stumps & fallen logs — per-cycle coin flip picks upright stump vs lying log
    if (this.stumps.visible)
    for (let i = 0; i < this.stumpN; i++) {
      const s0 = this.stumpSeed[i * 3], s1 = this.stumpSeed[i * 3 + 1], s2 = this.stumpSeed[i * 3 + 2];
      const sl = this.slot(i, this.stumpN, SPAN, s1, this.slotOut);
      const z = sl.z, cyc = sl.cycle;
      if (z < charZ - 55 && ((frame + i) & 1) === 1) continue;
      const present = hash2(cyc * 1.9, i * 2.3) > 0.4;
      const side = hash2(cyc * 2.1, i * 4.9) > 0.5 ? 1 : -1;
      const sf = this.genFade(z, charZ - SPAN, charZ + 2, s0) * (present ? 1 : 0);
      // ★ 视觉教训（第四轮）：`lying` 默认 0.5 + 长度缩放 (1.6+s1) 让倒木长径比达到 ~13:1，
      //   再配随机 Y 朝向，整体读成「满地的红木棍」。修法：
      //   - 倒木概率 0.5 → 0.22（树桩为主，倒木只是偶尔的点缀）
      //   - 倒木长度 (1.6+s1) → (1.0+s1*0.5)（≈1.0~1.5），并加粗径向 0.8 → 1.25
      //     长径比收敛到 ~5:1，才像一段「木头」而不是一根「棍」。
      const lying = hash2(cyc * 5.3, i) > 0.78;
      const sc = (0.7 + s2 * 0.7) * sf;
      if (lying) {
        dummy.position.set(side * (5.5 + hash2(cyc, i * 6.1) * 2.4), 0.16 * sc, z); // embedded, not floating
        dummy.rotation.set(0, s0 * 6.3, Math.PI / 2);
        dummy.scale.set(sc * 1.25, sc * (1.0 + s1 * 0.5), sc * 1.25);
      } else {
        dummy.position.set(side * (5.5 + hash2(cyc, i * 6.1) * 2.4), 0.3 * sc, z);
        dummy.rotation.set(0, s0 * 6.3, 0);
        dummy.scale.set(sc, sc * 0.6, sc);
      }
      dummy.updateMatrix();
      this.stumps.setMatrixAt(i, dummy.matrix);
    }
    this.stumps.instanceMatrix.needsUpdate = true;

    // puddles — rare glossy patches hugging the road edge, shimmer with bass
    for (let i = 0; i < this.puddleN; i++) {
      const s0 = this.puddleSeed[i * 3], s1 = this.puddleSeed[i * 3 + 1], s2 = this.puddleSeed[i * 3 + 2];
      const sl = this.slot(i, this.puddleN, SPAN, s0, this.slotOut);
      const z = sl.z, cyc = sl.cycle;
      if (z < charZ - 55 && ((frame + i) & 1) === 1) continue;
      const present = hash2(cyc * 4.1, i * 1.7) > 0.45;
      const side = hash2(cyc * 1.5, i * 3.3) > 0.5 ? 1 : -1;
      const pf = this.genFade(z, charZ - SPAN, charZ + 2, s2) * (present ? 1 : 0);
      const sc = (0.5 + s2 * 0.8) * pf;
      dummy.position.set(side * (5.3 + hash2(cyc, i * 8.3) * 1.8), -0.05, z);
      dummy.rotation.set(-Math.PI / 2, 0, s1 * 6.3);
      dummy.scale.set(sc * (1 + s0), sc * 0.7, 1);
      dummy.updateMatrix();
      this.puddles.setMatrixAt(i, dummy.matrix);
    }
    this.puddles.instanceMatrix.needsUpdate = true;
    this.puddleMat.emissiveIntensity = 0.25 + pulse * 0.45;

    // street lamps — regular alternating rhythm, continuous slide from horizon to camera.
    // 环槽间距恒按 MAX_LAMP_N 计算（保证换档时灯距不变、只是灯变多变少），
    // 超出当前档位数量的灯在 applyDensity() 里已 group.visible=false 且 uLampI=0。
    const cs = (SPAN * 1.1) / MAX_LAMP_N;
    const lampSpan = cs * MAX_LAMP_N; // one full ring of lamps covers the corridor
    this.lampHeadMat.emissiveIntensity = 1.3 + pulse * 1.6;
    for (const l of this.lamps) {
      if (!l.group.visible) continue;
      const slot = l.slot;
      const q = this.distance - 10 + slot * cs;
      const wrap = Math.floor(q / lampSpan);
      const cyc = wrap * MAX_LAMP_N + slot; // rehashes only when this lamp wraps at the horizon
      const z = charZ + 16 - lampSpan + (q - wrap * lampSpan);
      const x = l.side * (5.6 + hash(cyc) * 0.7);
      const lf = this.genFade(z, charZ - SPAN, charZ + 2, hash(slot * 3));
      l.group.position.set(x, 0, z);
      l.group.scale.setScalar(Math.max(lf, 0.0001));
      const flicker = 0.08 * Math.sin(t * 1.7 + slot * 2.3);
      const glowLvl = lf * (0.26 + pulse * 0.4 + flicker) * this.lampGlowBoost;
      l.glow.material.opacity = Math.min(1, glowLvl * 1.5);
      l.glowOuter.material.opacity = Math.min(0.4, glowLvl * 0.42);
      const gs = (0.85 + pulse * 0.5) * Math.max(lf, 0.0001) * this.lampGlowBoost;
      l.glow.scale.set(gs, gs, 1);
      const os = (3.2 + pulse * 1.8) * Math.max(lf, 0.0001) * this.lampGlowBoost;
      l.glowOuter.scale.set(os, os, 1);
      // P6 外层雾晕：更慢的呼吸（与内两层错开相位），强度最低。lampLayers<3 时整层不可见。
      if (l.glowFar.visible) {
        l.glowFar.material.opacity = Math.min(0.16, glowLvl * 0.16);
        const fs = (7.2 + pulse * 3.2 + Math.sin(t * 0.9 + slot) * 0.7) * Math.max(lf, 0.0001);
        l.glowFar.scale.set(fs, fs, 1);
      }
      l.spot.material.opacity = Math.min(0.5, lf * (0.2 + pulse * 0.22 + flicker) * this.lampGlowBoost);
      const ss = (3.2 + pulse * 1.2) * Math.max(lf, 0.0001);
      l.spot.scale.set(ss, ss * 0.45, 1);
      // P6 灯柱长条影：灯的竖杆在路面上投下的一条细长影子。
      // 假阴影技术：不投真实 shadowMap，而是在竿底放一条被拉伸的暗色贴片，
      // 朝向由灯位于道路哪一侧决定（影子朝路面中心倒）。这条影子让灯柱「站在地上」。
      if (this.contactShadows && this.contactShadows.visible) {
        const shIdx = 2 + slot;
        if (shIdx < CONTACT_SHADOW_N) {
          dummy.position.set(x - l.side * 0.55, 0.014, z);
          dummy.rotation.set(0, 0, 0);
          // 沿 X（朝路面中心）拉长，沿 Z 收窄 → 细长条
          dummy.scale.set(-l.side * 3.0 * lf, 1, 0.35 * lf);
          dummy.updateMatrix();
          this.contactShadows.setMatrixAt(shIdx, dummy.matrix);
        }
      }
      // 把灯位写进路面 shader 的光池 uniform（每盏灯的横向位置 + 强度）
      this.roadU.uLampX.value[l.slot] = x;
      this.roadU.uLampZ.value[l.slot] = z;
      this.roadU.uLampI.value[l.slot] = lf * (0.55 + pulse * 0.6 + flicker) * this.lampGlowBoost;
      ((l.cone.material as THREE.ShaderMaterial).uniforms.opacity as { value: number }).value =
        theme.coneOpacity * lf * (0.7 + 0.6 * pulse + flicker);
    }

    // ---- city props ----
    if (this.buildings.visible) {
      for (let i = 0; i < this.buildN; i++) {
        const s0 = this.buildSeed[i * 3], s1 = this.buildSeed[i * 3 + 1], s2 = this.buildSeed[i * 3 + 2];
        const sl = this.slot(i, this.buildN, TREE_SPAN, s0, this.slotOut);
        const z = sl.z, cyc = sl.cycle;
        if (z < charZ - 80 && ((frame + i) & 1) === 1) continue;
        const side = hash2(cyc, i * 3.1) > 0.5 ? 1 : -1;
        const bf = this.genFade(z, charZ - TREE_SPAN, charZ + 2, s0);
        const h = (6 + hash2(cyc * 1.7, i) * 13) * bf;
        const w = 3 + s1 * 3.5;
        const x = side * (9.5 + hash2(cyc * 2.9, i * 1.7) * 9);
        dummy.position.set(x, h / 2 - 0.3, z);
        dummy.rotation.set(0, s2 > 0.5 ? 0 : Math.PI / 2, 0);
        dummy.scale.set(w * bf, h, (3 + s2 * 3) * bf);
        dummy.updateMatrix();
        this.buildings.setMatrixAt(i, dummy.matrix);
      }
      this.buildings.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < this.neonN; i++) {
        const s0 = this.neonSeed[i * 3], s1 = this.neonSeed[i * 3 + 1], s2 = this.neonSeed[i * 3 + 2];
        const sl = this.slot(i, this.neonN, SPAN, s0, this.slotOut);
        const z = sl.z, cyc = sl.cycle;
        if (z < charZ - 55 && ((frame + i) & 1) === 1) continue;
        const side = hash2(cyc * 1.3, i * 2.7) > 0.5 ? 1 : -1;
        const nf = this.genFade(z, charZ - SPAN, charZ + 2, s2);
        // flicker: rare dropouts, pure f(t)
        const flick = hash2(cyc, i) > 0.75 ? (Math.sin(t * 13 + i * 7) > -0.7 ? 1 : 0.15) : 1;
        dummy.position.set(side * (8.6 + s1 * 1.5), 2 + s2 * 3.5, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, (0.7 + s0 * 1.6) * nf * flick, 1);
        dummy.updateMatrix();
        this.neon.setMatrixAt(i, dummy.matrix);
      }
      this.neon.instanceMatrix.needsUpdate = true;
      // traffic lights — same ring rhythm as lamps, signal cycles with time
      const tcs = (SPAN * 1.1) / this.trafficN;
      const tSpan = tcs * this.trafficN;
      for (let i = 0; i < this.trafficN; i++) {
        const g = this.traffic[i];
        const q = this.distance - 10 + i * tcs + tcs * 0.5;
        const wrap = Math.floor(q / tSpan);
        const z = charZ + 16 - tSpan + (q - wrap * tSpan);
        const side = i % 2 === 0 ? -1 : 1;
        const tf = this.genFade(z, charZ - SPAN, charZ + 2, hash(i * 5));
        g.position.set(side * 4.9, 0, z);
        g.rotation.y = side > 0 ? Math.PI : 0;
        g.scale.setScalar(Math.max(tf, 0.0001));
        const phase = (t * 0.25 + i * 0.37) % 1;
        const lit = phase < 0.45 ? 2 : phase < 0.55 ? 1 : 0; // green → yellow → red
        for (let k = 0; k < 3; k++) this.trafficMats[i][k].color.setScalar(k === lit ? 1 : 0.12);
        this.trafficMats[i][0].color.setRGB(lit === 0 ? 1 : 0.15, lit === 0 ? 0.29 : 0.06, lit === 0 ? 0.29 : 0.06);
        this.trafficMats[i][1].color.setRGB(lit === 1 ? 1 : 0.15, lit === 1 ? 0.77 : 0.1, lit === 1 ? 0.29 : 0.05);
        this.trafficMats[i][2].color.setRGB(lit === 2 ? 0.29 : 0.05, lit === 2 ? 1 : 0.15, lit === 2 ? 0.48 : 0.08);
      }
    }

    // ---- beach props ----
    if (this.sea.visible) {
      this.sea.position.z = charZ - 80;
      this.seaU.uT.value = t;
      this.seaU.uDist.value = this.distance;
      for (let i = 0; i < this.palmN; i++) {
        const s0 = this.palmSeed[i * 3], s1 = this.palmSeed[i * 3 + 1], s2 = this.palmSeed[i * 3 + 2];
        const sl = this.slot(i, this.palmN, TREE_SPAN, s0, this.slotOut);
        const z = sl.z, cyc = sl.cycle;
        if (z < charZ - 80 && ((frame + i) & 1) === 1) continue;
        // palms cluster on the sea side (+x), a few on the dune side
        const seaSide = hash2(cyc, i * 2.3) > 0.25;
        const x = seaSide ? 6.5 + hash2(cyc * 1.9, i) * 6 : -(6 + hash2(cyc * 1.9, i) * 3);
        const pf = this.genFade(z, charZ - TREE_SPAN, charZ + 2, s0);
        const sc = (0.8 + s1 * 0.7) * pf;
        const sway = Math.sin(t * 0.9 + s2 * 9) * (0.03 + gust * 0.12);
        dummy.position.set(x, 0, z);
        dummy.rotation.set(sway * 0.5, s2 * 6.3 + (seaSide ? 0 : Math.PI), sway);
        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        this.palms.setMatrixAt(i, dummy.matrix);
        this.fronds.setMatrixAt(i, dummy.matrix);
      }
      this.palms.instanceMatrix.needsUpdate = true;
      this.fronds.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < this.umbrellaN; i++) {
        const s0 = this.umbrellaSeed[i * 3], s1 = this.umbrellaSeed[i * 3 + 1], s2 = this.umbrellaSeed[i * 3 + 2];
        const sl = this.slot(i, this.umbrellaN, SPAN, s0, this.slotOut);
        const z = sl.z, cyc = sl.cycle;
        if (z < charZ - 55 && ((frame + i) & 1) === 1) continue;
        const present = hash2(cyc * 2.1, i) > 0.3;
        const uf = this.genFade(z, charZ - SPAN, charZ + 2, s1) * (present ? 1 : 0);
        dummy.position.set(7.5 + hash2(cyc, i * 3.7) * 5, 0, z);
        dummy.rotation.set((s1 - 0.5) * 0.22, s2 * 6.3, (s0 - 0.5) * 0.22);
        dummy.scale.setScalar((0.85 + s2 * 0.5) * uf);
        dummy.updateMatrix();
        this.umbrellas.setMatrixAt(i, dummy.matrix);
      }
      this.umbrellas.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < this.shellN; i++) {
        const s0 = this.shellSeed[i * 3], s2 = this.shellSeed[i * 3 + 2];
        const sl = this.slot(i, this.shellN, SPAN, s0, this.slotOut);
        const z = sl.z, cyc = sl.cycle;
        if (z < charZ - 55 && ((frame + i) & 1) === 1) continue;
        const present = hash2(cyc * 3.1, i * 1.9) > 0.3;
        const side = hash2(cyc, i * 5.3) > 0.4 ? 1 : -1;
        const sf = this.genFade(z, charZ - SPAN, charZ + 2, s2) * (present ? 1 : 0);
        const sc = (0.6 + s2 * 0.9) * sf;
        dummy.position.set(side * (5.3 + hash2(cyc, i * 7.1) * 3.4), 0.02, z);
        dummy.rotation.set(0, s0 * 6.3 + cyc, 0);
        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        if (i % 2 === 0) this.shells.setMatrixAt(i, dummy.matrix);
        else this.starfish.setMatrixAt(i, dummy.matrix);
        // park the unused variant
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        if (i % 2 === 0) this.starfish.setMatrixAt(i, dummy.matrix);
        else this.shells.setMatrixAt(i, dummy.matrix);
      }
      this.shells.instanceMatrix.needsUpdate = true;
      this.starfish.instanceMatrix.needsUpdate = true;
    }

    // ---- winter icicles: track each lamp's arm tip ----
    if (this.icicles.visible) {
      for (const l of this.lamps) {
        const i = l.slot;
        const lf = l.group.scale.x;
        dummy.position.set(l.group.position.x - l.side * 0.7 * lf, (LAMP_H - 0.1) * lf, l.group.position.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(lf);
        dummy.updateMatrix();
        this.icicles.setMatrixAt(i, dummy.matrix);
      }
      this.icicles.instanceMatrix.needsUpdate = true;
    }

    // clouds — slow drift, wrapped in a far band, pure f(t, distance); size/height layers
    for (let i = 0; i < this.cloudN; i++) {
      const c0 = this.cloudSeed[i * 4], c1 = this.cloudSeed[i * 4 + 1], c2 = this.cloudSeed[i * 4 + 2], c3 = this.cloudSeed[i * 4 + 3];
      const band = 320;
      const d = (this.distance * 0.25 + t * (0.6 + c3 * 0.8) + c0 * band) % band;
      const g = this.clouds[i];
      g.position.set(
        (c1 - 0.5) * 160 + Math.sin(t * 0.05 + i) * 4,
        22 + c2 * 30,
        charZ + 30 - band + d // slow parallax: approaches from the horizon at 0.25× walk speed
      );
      g.rotation.y = c0 * 6.3 + t * 0.01;
      g.scale.setScalar(0.7 + c3 * 1.2);
    }

    // mountains — near-static silhouette layers, very slow lateral parallax wrap
    // (two tiles per layer: tile1 covers [-o, W-o], tile0 covers [-W-o, -o]; union always spans the view)
    for (const m of this.mountains) {
      const l = m.userData.layer as number;
      const o = (this.distance * MTN_K[l] + l * 137) % MTN_W;
      m.position.x = -o - (m.userData.tile as number) * MTN_W;
      m.position.z = charZ + MTN_Z[l];
    }

    // far tree/building line — 比山更远、视差更小（0.06），只贴住 Z 不横向循环：
    // 因为齿极密且雾很重，横向漂移会被雾吃掉，不值得付循环成本。
    if (this.farTreeLine.visible) {
      this.farTreeLine.position.z = charZ - 160;
    }

    // celestial body follows the walker at a fixed sky offset
    this.celestial.position.set(theme.celestialX * 110, theme.celestialY, charZ - 150);
    this.celestialGlow.material.opacity =
      (theme.night ? 0.5 : theme.defaultWeather === 'leaves' ? 0.55 : 0.4) + pulse * 0.08;

    // aurora — follows the camera, slow GPU flow, faintly bass-reactive
    if (this.aurora.visible) {
      this.aurora.position.set(this.camera.position.x * 0.4, 36 + Math.sin(t * 0.07) * 2.5, charZ - 115);
      this.auroraUniforms.uT.value = t;
      this.auroraUniforms.uOpacity.value = 0.24 + pulse * 0.1 + Math.sin(t * 0.11) * 0.05;
    }

    // meteors — rare diagonal streaks; activation window is a pure f(t)
    if (theme.night) {
      for (let i = 0; i < METEOR_N; i++) {
        const T = 9 + i * 4.7;
        const a = (t / T + hash(i * 7.7)) % 1;
        const mat = this.meteorMats[i];
        if (a < 0.055) {
          const p = a / 0.055;
          const m = this.meteors[i];
          const sx0 = (hash(i * 3.3 + Math.floor(t / T)) - 0.5) * 120;
          m.position.set(sx0 - p * 26, 44 - p * 12 + hash(i * 5.1) * 10, charZ - 120);
          mat.opacity = Math.sin(p * Math.PI) * 0.85;
        } else {
          mat.opacity = 0;
        }
      }
    }

    // butterflies — wander the roadside, flap faster with the mid band
    if (theme.butterflies) {
      const flapSpeed = 9 + bands.mid * 9;
      for (let i = 0; i < this.butterflyN; i++) {
        const g = this.butterflies[i];
        const span = 46;
        const d = (this.distance * (0.85 + i * 0.05) + hash(i * 3.7) * span) % span;
        const side = i % 2 === 0 ? 1 : -1;
        const z = charZ + 6 - span + d; // flutter toward the walker from up ahead
        const x = side * (2.6 + hash(i * 9.1) * 2.4) + Math.sin(t * (0.7 + i * 0.13) + i * 2.1) * 1.6;
        const y = 0.9 + Math.sin(t * (1.1 + i * 0.17) + i) * 0.45 + bands.mid * 0.25;
        g.position.set(x, y, z);
        g.rotation.y = Math.sin(t * 0.5 + i * 1.7) * 0.8 + (side > 0 ? -0.4 : 0.4);
        const flap = Math.sin(t * flapSpeed + i * 2.4) * 0.95;
        this.butterflyWings[i * 2].rotation.y = flap;
        this.butterflyWings[i * 2 + 1].rotation.y = Math.PI - flap;
      }
    }

    // fireflies — GPU animated; only the anchor follows the walker
    this.fireflies.position.z = charZ;
    this.fireflyUniforms.uT.value = t;

    // light dot: gentle floating bob, drifts slightly side to side while walking
    const bob = Math.sin(t * (playing ? 3.2 : 2)) * 0.1 + (playing ? Math.abs(Math.sin(this.distance * 2.4)) * 0.1 : 0);
    const sx = Math.sin(this.distance * 0.12) * 0.8;
    this.character.position.set(sx, bob, charZ);
    this.charLight.position.set(sx, 1.3 + bob, charZ + 0.4);
    this.charLight.intensity = 2.2 + pulse * 1.4 + Math.sin(t * 3) * 0.22;
    this.charHalo.material.opacity = 0.34 + pulse * 0.14;
    const hs = 1.4 + pulse * 0.45 + Math.sin(t * 2.2) * 0.06;
    this.charHalo.scale.set(hs, hs, 1);

    // contact shadow — P6 双层椭圆：内层小而深（明确接触点）+ 外层大而淡（软边扩散），
    // 单层椭圆总是显得「贴了张黑纸」，两层叠加才像被光晕出来的软阴影。
    if (this.contactShadows && this.contactShadows.visible) {
      const cs = 1.5 + pulse * 0.25;
      // 内层
      dummy.position.set(sx, 0.02, charZ);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(cs, 1, cs * 0.8);
      dummy.updateMatrix();
      this.contactShadows.setMatrixAt(0, dummy.matrix);
      // 外层（更大更淡）：shadowQuality>=2 才画，否则缩零（避免为一个可选层多一次 draw）
      if (QUALITY_SETTINGS[this.quality].shadowQuality >= 2) {
        const cs2 = cs * 2.15;
        dummy.position.set(sx, 0.018, charZ);
        dummy.scale.set(cs2, 1, cs2 * 0.72);
      } else {
        dummy.scale.set(0, 0, 0);
      }
      dummy.updateMatrix();
      this.contactShadows.setMatrixAt(1, dummy.matrix);
      this.contactShadows.instanceMatrix.needsUpdate = true;
    }

    // ------------------------------------------------------------------
    // P5 动态微细节
    // ------------------------------------------------------------------

    // 雪面脚印：只在「雪主题」或「雪天气」时出现（extras=false 的 low 档关闭）。
    // ★ 阈值从 >0.02 提到 >0.3：wI.snow 是**平滑插值**量，切离雪天时会缓慢衰减，
    //   用 0.02 会让脚印在「冬→春/沙滩」的过渡里残留数秒 → 路面上出现一片浅蓝
    //   「浮着的矩形」，被误读成异物（实测踩到）。抬高阈值即在新天气里立刻收掉。
    this.footprints.visible = snowActive && wI.snow > 0.3 && this.extras;
    if (this.footprints.visible) {
      const side = Math.sin(this.distance * 0.12) * 0.5; // 跟随角色的横向摆动
      for (let k = 0; k < FOOTPRINT_N * 2; k++) {
        const step = k >> 1;
        const foot = k % 2 === 0 ? 1 : -1;
        // 越靠后的印子越淡（1 → 0），最后一次淡出避免「突然消失」
        const gf = Math.max(0, 1 - step / FOOTPRINT_N);
        const zz = charZ + 0.9 + step * 0.62;
        dummy.position.set(side + foot * 0.2, 0.013, zz);
        dummy.rotation.set(0, foot * 0.14, 0);
        const s = gf * (0.5 + (k % 3) * 0.03);
        dummy.scale.set(s * 0.55, 1, s * 1.15); // 印子比脚掌「长」：椭圆脚印
        dummy.updateMatrix();
        this.footprints.setMatrixAt(k, dummy.matrix);
      }
      this.footprints.instanceMatrix.needsUpdate = true;
    }

    // 灯下微尘：锚点跟随角色，让相机附近始终有尘埃；仅非 low 档开启。
    this.dust.visible = this.extras && this.effWeather !== 'rain';
    if (this.dust.visible) {
      this.dust.position.set(sx, 0, charZ);
      this.dustU.uT.value = t;
      // 夜间更明显（灯是主要光源），白天几乎没有浮尘可看
      this.dustU.uOpacity.value = (theme.night ? 0.42 : 0.16) + pulse * 0.1;
      this.dustU.uColor.value.set(theme.lampGlow);
    }

    // breath mist — a soft puff every few seconds, drifting forward as it dissolves
    // (winter-night auto default; also active whenever snow weather is selected)
    for (const b of this.breaths) b.visible = snowActive;
    if (snowActive) {
      for (let i = 0; i < this.breaths.length; i++) {
        const a = ((t / 5.5 + i * 0.5) % 1 + 1) % 1;
        const b = this.breaths[i];
        b.position.set(sx + Math.sin(t * 0.7 + i * 3) * 0.1, 1.05 + bob + a * 0.5, charZ - 0.7 - a * 1.6);
        const sc = 0.25 + a * 1.1;
        b.scale.set(sc, sc * 0.7, 1);
        b.material.opacity = (1 - a) * Math.min(1, a / 0.12) * 0.22;
      }
    }

    // camera follows behind the moving dot with soft lag
    this.camera.position.x = Math.sin(t * 0.25) * 0.5 + sx * 0.35;
    this.camera.position.y = 4.6 + Math.sin(t * 0.4) * 0.15 + pulse * 0.1;
    this.camera.position.z += (charZ + 8.6 - this.camera.position.z) * Math.min(1, dt * 3);
    this.camera.lookAt(sx * 0.5, 1.3, charZ - 8);

    this.bloom.strength = theme.bloom + pulse * 0.16 + bands.level * 0.05;
    // 曝光随低频轻微呼吸：让整个画面（而非只有 bloom）跟着鼓点起伏。
    // 幅度由主题 exposureBreath 决定：夜景（冬夜/夜都）更明显、日景（清晨/海滩）更克制，
    // 避免白天出现廉价频闪。low 档关闭呼吸，恒为主题基准曝光。
    const baseExposure = theme.exposure;
    const expAmp = this.fogBreath ? theme.exposureBreath ?? 0.02 : 0;
    const beatExposure = baseExposure * (1 + bands.bass * expAmp * 1.5 + pulse * expAmp);
    this.renderer.toneMappingExposure = beatExposure;
    this.composer.render();
  }

  getCharZ(): number {
    return -this.distance;
  }

  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    // 复用实例：Home 每帧对每行可见歌词调用，避免稳态逐帧分配
    const v = this.projectV.set(x, y, z).project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.canvas.clientWidth,
      y: (-v.y * 0.5 + 0.5) * this.canvas.clientHeight,
      visible: v.z < 1,
    };
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.applyBloomResolution();
  }

  /**
   * 按档位设置 bloom 内部 RT 分辨率。
   *
   * 必须放在 composer.setSize() **之后**调用：UnrealBloomPass.setSize(w,h) 会
   * 无条件按传入尺寸重新分配全部 mip 链，完全忽略构造函数给的 resolution，
   * 因此「半分辨率 bloom」在 setSize 之前设置是没有意义的（会被覆盖）。
   * 这里传入「绘制缓冲尺寸 × 倍率」，让 setSize 再按其内部规则减半。
   */
  private applyBloomResolution() {
    if (!this.bloom) return;
    const qs = QUALITY_SETTINGS[this.quality];
    if (qs.bloomResolutionScale >= 1) return; // 全分辨率时无需干预
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.bloom.setSize(
      Math.max(1, Math.floor(buf.x * qs.bloomResolutionScale)),
      Math.max(1, Math.floor(buf.y * qs.bloomResolutionScale)),
    );
  }

  dispose() {
    // 释放几何 / 材质 / composer，避免 HMR 与重新挂载时泄漏 GPU 资源
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    this.composer?.dispose();
    this.renderer.dispose();
  }
}

/** paint a flat color attribute onto a geometry (for merged multi-part props) */
function paintAttr(geo: THREE.BufferGeometry, r: number, g: number, b: number) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** dark facade diffuse + lit-window emissive textures for city buildings */
function makeFacadeTextures(): { map: THREE.Texture; emissiveMap: THREE.Texture } {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#232838';
  g.fillRect(0, 0, 128, 256);
  const e = document.createElement('canvas');
  e.width = 128;
  e.height = 256;
  const ge = e.getContext('2d')!;
  ge.fillStyle = '#000000';
  ge.fillRect(0, 0, 128, 256);
  const warm = ['#ffd98a', '#ffe9c4', '#ffb45e'];
  const cool = ['#9fd8ff', '#cfe4ff', '#8ab8ff'];
  for (let r = 0; r < 16; r++) {
    for (let col = 0; col < 6; col++) {
      const x = 8 + col * 20;
      const y = 8 + r * 15;
      const h = hash(r * 13.7 + col * 7.1);
      // faint window frames on the diffuse map
      g.fillStyle = '#2c3247';
      g.fillRect(x, y, 12, 9);
      if (h > 0.45) {
        const palette = h > 0.82 ? cool : warm;
        const cc = palette[(hash(r * 3.1 + col * 17.7) * palette.length) | 0];
        g.fillStyle = cc;
        g.fillRect(x, y, 12, 9);
        ge.fillStyle = cc;
        ge.fillRect(x, y, 12, 9);
      }
    }
  }
  const map = new THREE.CanvasTexture(c);
  const emissiveMap = new THREE.CanvasTexture(e);
  map.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  return { map, emissiveMap };
}

function makeGlowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  // 中性白：色相交给调用方（主题色），避免叠加暖黄后所有粒子发橙
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.28)');
  grad.addColorStop(0.78, 'rgba(255,255,255,0.06)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
