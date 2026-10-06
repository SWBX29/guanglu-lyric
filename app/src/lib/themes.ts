/** selectable weather modes; 'auto' follows the theme's default weather */
export type WeatherMode = 'auto' | 'clear' | 'petals' | 'rain' | 'leaves' | 'wind' | 'snow' | 'snowstorm';

export interface ThemePreset {
  id: string;
  name: string;
  /** scene layout family: which prop sets are active */
  mapKind: 'nature' | 'city' | 'beach';
  /** night lighting: stars / meteors / stronger lamps */
  night: boolean;
  /** weather used when WeatherMode === 'auto' */
  defaultWeather: Exclude<WeatherMode, 'auto'>;
  skyTop: string;
  skyBottom: string;
  fog: string;
  fogDensity: number;
  ambient: string;
  ambientIntensity: number;
  sunColor: string;
  sunIntensity: number;
  sunPosition: [number, number, number];
  ground: string;
  roadBase: string[];
  curb: string[];
  rock: string[];
  lampPole: string;
  lampGlow: string;
  foliage: string[];
  trunk: string;
  flowerPetals: string[];
  coneColor: string;
  coneOpacity: number;
  characterCore: string;
  characterHalo: string;
  lyricGlow: string;
  particleColor: string;
  particlePalette: string[];
  particleCount: number; // fireflies / snow / petals ambience
  particleKind: 'petal' | 'leaf' | 'snow';
  /** base bloom strength per theme（已按 ACES tone mapping 重校，见 WP2a） */
  bloom: number;
  /** bloom radius（0..1）；高档位会再乘一个倍率 */
  bloomRadius: number;
  /**
   * ACES 曝光补偿。1.0 = 中性。
   * 夜景需要略高（否则暗部细节塌陷成纯黑），日景需要略低
   * （否则高光进入 ACES 肩部，纹理被压平）。
   */
  exposure: number;
  // --- scene dressing (added for rich-nature pass) ---
  mountains: [string, string, string]; // 3 ridge layers, near → far (pre-shaded silhouettes)
  celestialColor: string; // sun / sunset disc / moon face
  celestialGlow: string; // halo sprite tint
  celestialSize: number; // disc radius (world units)
  celestialY: number; // height above horizon
  celestialX: number; // horizontal offset factor (-1..1)
  aurora: boolean; // winter polar lights band
  butterflies: boolean; // spring butterflies
  snowCap: string; // snow tint for caps / whitening

  // ---- 光照分层与材质协调（细节增强 pass 新增，全部可选，读取处 ?? 兜底）----
  /** 半球光地面色：环境光上下分层，独立于 fog（不填则退化为 fog） */
  ambientGround?: string;
  /** 半球光强度：不填则退化为 night ? 0.34 : 0.5 */
  hemiIntensity?: number;
  /** 夜间灯光聚焦度：放大灯柱光晕/光池/光锥（不填则退化为 night ? 1.2 : 0.7） */
  lampFocus?: number;
  /** 雾密度呼吸幅度（±比例，逐帧 sin） */
  fogBreathAmp?: number;
  /** 雾呼吸频率 */
  fogBreathSpeed?: number;
  /** 曝光呼吸幅度（替代固定 bands.bass*0.03） */
  exposureBreath?: number;
  /** 假接触阴影不透明度（不填则 0.34） */
  shadowStrength?: number;
  /** 夜间道具向 snowCap 提亮的统一系数（不填则 0.35） */
  nightLift?: number;
  /** 城市霓虹配色（仅 city 使用） */
  neonHue?: string[];
  /** 海面反射/高光强度（仅 beach 使用） */
  seaReflect?: number;
  /** 道具统一粗糙度基准 */
  propRoughness?: number;
  /** 体积光柱颜色 */
  godrayColor?: string;
  /** 体积光柱基础强度 */
  godrayOpacity?: number;
  /** 远景薄雾带颜色 */
  mistColor?: string;
}

export const THEMES: ThemePreset[] = [
  {
    id: 'spring',
    name: '春日 · 清晨',
    mapKind: 'nature',
    night: false,
    defaultWeather: 'petals',
    skyTop: '#7ba8b6',
    skyBottom: '#e2cda8',
    fog: '#b9cdc5',
    fogDensity: 0.019,
    ambient: '#fff4e0',
    ambientIntensity: 0.44,
    sunColor: '#ffe6b8',
    sunIntensity: 1.25,
    sunPosition: [18, 26, -30],
    ground: '#57705a',
    roadBase: ['#9a9d90', '#a3a695', '#8f9284', '#a8ab9a'],
    curb: ['#c9d6bd', '#d4e0c8', '#bfd0b2'],
    // rock 降饱和偏灰：原 #9aa78f 与 foliage #7fb069 明度太近，夜间/逆光糊在一起
    rock: ['#8e9683', '#7f8778', '#9ba391'],    lampPole: '#4a5248',
    lampGlow: '#ffe9c4',
    foliage: ['#7fb069', '#95c47d', '#6da35e', '#aad49a'],
    trunk: '#8a6f5a',
    flowerPetals: ['#f6b8c8', '#fbe3a6', '#ffffff', '#f49ac1', '#c9a0dc', '#8fc7f0', '#ff9a76'],
    coneColor: '#ffe9c4',
    coneOpacity: 0.09,
    characterCore: '#fff8e7',
    characterHalo: '#ffd98a',
    lyricGlow: '#ffb45e',
    particleColor: '#ffc7da',
    particlePalette: ['#ffc7da', '#ffffff', '#f6b8c8', '#ffe9a8'],
    particleCount: 260,
    particleKind: 'petal',
    bloom: 0.2,
    bloomRadius: 0.44,
    exposure: 0.98,
    mountains: ['#54746d', '#6b8a82', '#86a29a'],
    celestialColor: '#fff3c8',
    celestialGlow: '#ffe9a8',
    celestialSize: 3.2,
    celestialY: 46,
    celestialX: 0.5,
    aurora: false,
    butterflies: true,
    snowCap: '#ffffff',
    // 光照分层：清晨通透，半球光偏亮撑起天光
    ambientGround: '#6a7a58',
    hemiIntensity: 0.52,
    lampFocus: 0.6,
    fogBreathAmp: 0.06,
    fogBreathSpeed: 0.06,
    exposureBreath: 0.015,
    shadowStrength: 0.28,
    nightLift: 0,
    propRoughness: 0.9,
    godrayColor: '#ffe9c4',
    godrayOpacity: 0.03,
    mistColor: '#b9cdc5',
  },
  {
    id: 'autumn',
    name: '秋日 · 夕阳',
    mapKind: 'nature',
    night: false,
    defaultWeather: 'leaves',
    skyTop: '#4a3b63',
    skyBottom: '#f2a35e',
    // 雾色去紫：旧值 #7d5470 是饱和紫，配 fogDensity 0.02 会把整个场景
    // 连同路面、植被一起染成「一坨紫泥」（用户反馈「颜色/光照怪」的主因）。
    // 改为低饱和暖灰玫瑰 —— 保留黄昏余晖的暖意，但不再吃掉物体固有色。
    fog: '#a8836f',
    fogDensity: 0.016,
    ambient: '#d9a06b',
    ambientIntensity: 0.4,
    sunColor: '#ff9a3d',
    sunIntensity: 1.45,
    sunPosition: [-24, 12, -46],
    ground: '#4e4038',
    roadBase: ['#7d6f60', '#85766a', '#756657', '#8d7d6c'],
    // curb 提亮：原 #8a7360 与 roadBase #7d6f60 对比不足（差 <8%），路缘边界不清
    curb: ['#a08870', '#ac9478', '#8f7a66'],
    rock: ['#7a6858', '#6b5a4c', '#857262'],
    lampPole: '#3f3430',
    lampGlow: '#ffbf70',
    foliage: ['#d97b3f', '#c45a3a', '#e8a04c', '#b84a32'],
    trunk: '#5d4436',
    flowerPetals: ['#e8a04c', '#d97b3f', '#f2c063'],
    coneColor: '#ffb066',
    coneOpacity: 0.2,
    characterCore: '#fff3dd',
    characterHalo: '#ffb066',
    lyricGlow: '#ffcf8a',
    particleColor: '#e8963f',
    particlePalette: ['#f2c063', '#e8963f', '#d97b3f', '#f7d98a', '#ffd76e'],
    particleCount: 180,
    particleKind: 'leaf',
    bloom: 0.28,
    bloomRadius: 0.5,
    exposure: 0.94,
    mountains: ['#4e3448', '#61445a', '#77566c'],
    celestialColor: '#ff8a45',
    celestialGlow: '#ff9a55',
    celestialSize: 13,
    celestialY: 10,
    celestialX: -0.55,
    aurora: false,
    butterflies: false,
    snowCap: '#ffffff',
    // 光照分层：夕阳暖光主导，曝光呼吸更明显；curb 提亮与 roadBase 拉开对比
    ambientGround: '#5a4038',
    hemiIntensity: 0.46,
    lampFocus: 1.0,
    fogBreathAmp: 0.05,
    fogBreathSpeed: 0.05,
    exposureBreath: 0.02,
    shadowStrength: 0.32,
    nightLift: 0,
    propRoughness: 0.9,
    godrayColor: '#ffb066',
    godrayOpacity: 0.05,
    mistColor: '#7d5470',
  },
  {
    id: 'winter',
    name: '冬夜 · 隆冬',
    mapKind: 'nature',
    night: true,
    defaultWeather: 'snow',
    skyTop: '#060a1c',
    skyBottom: '#1b2a4a',
    fog: '#0b1226',
    fogDensity: 0.024,
    ambient: '#3a4a6e',
    ambientIntensity: 0.42,
    sunColor: '#9fc4ff',
    sunIntensity: 0.72,
    sunPosition: [10, 30, -20],
    ground: '#1d2947',
    roadBase: ['#3a4360', '#424b6a', '#343d58', '#4a5478'],
    curb: ['#46557c', '#51618c', '#3d4a6e'],
    rock: ['#3d4767', '#333d5a', '#46527a'],
    lampPole: '#2a2f45',
    lampGlow: '#ffc98a',
    // foliage 提亮：原 #274048 与 ground #1d2947 / rock #3d4767 明度过近，夜景糊成一片
    foliage: ['#2f5560', '#38626b', '#264a53'],
    trunk: '#3a3348',
    flowerPetals: ['#bcd7ff', '#e8f2ff'],
    coneColor: '#a8ccff',
    coneOpacity: 0.22,
    characterCore: '#fffdf4',
    characterHalo: '#ffd98a',
    lyricGlow: '#ffd98a',
    particleColor: '#ffffff',
    particlePalette: ['#ffffff', '#dfeaff', '#bcd7ff'],
    particleCount: 320,
    particleKind: 'snow',
    bloom: 0.30,
    bloomRadius: 0.62,
    exposure: 1.28,
    mountains: ['#141d36', '#1a2542', '#223052'],
    celestialColor: '#e8f1ff',
    celestialGlow: '#a8c4ff',
    celestialSize: 6,
    celestialY: 52,
    celestialX: 0.45,
    aurora: true,
    butterflies: false,
    snowCap: '#eaf2ff',
    // 光照分层：冬夜冷而暗，灯光聚焦最强；nightLift 让道具统一提亮（避免夜景糊成一片）
    ambientGround: '#141c34',
    hemiIntensity: 0.3,
    lampFocus: 1.35,
    fogBreathAmp: 0.1,
    fogBreathSpeed: 0.09,
    exposureBreath: 0.03,
    shadowStrength: 0.4,
    nightLift: 0.35,
    propRoughness: 0.88,
    godrayColor: '#a8c4ff',
    godrayOpacity: 0.07,
    mistColor: '#0b1226',
  },
  {
    id: 'city',
    name: '城市 · 夜都',
    mapKind: 'city',
    night: true,
    defaultWeather: 'clear',
    skyTop: '#0b0e24',
    skyBottom: '#3a2a5e',
    fog: '#141832',
    fogDensity: 0.02,
    ambient: '#4a5a8e',
    ambientIntensity: 0.36,
    sunColor: '#8ea8ff',
    sunIntensity: 0.5,
    sunPosition: [-14, 30, -24],
    ground: '#151824',
    roadBase: ['#2e3242', '#343849', '#2a2e3c', '#3a3f52'],
    // curb 提亮：夜间灯光下路面边界更清晰
    curb: ['#5a6076', '#646a82', '#4e5468'],
    rock: ['#3a3f52', '#323748', '#454b60'],
    lampPole: '#23283a',
    lampGlow: '#cfe4ff',
    foliage: ['#2f4d57', '#274048', '#3a5a52'],
    trunk: '#2c2838',
    flowerPetals: ['#7dd8ff', '#ff7ad9', '#b48aff', '#7affd4'],
    coneColor: '#a8ccff',
    coneOpacity: 0.16,
    characterCore: '#fffdf4',
    characterHalo: '#9fc4ff',
    lyricGlow: '#8ad8ff',
    particleColor: '#cfe4ff',
    particlePalette: ['#ffffff', '#dfeaff', '#bcd7ff'],
    particleCount: 200,
    particleKind: 'snow',
    bloom: 0.46,
    bloomRadius: 0.58,
    exposure: 1.22,
    mountains: ['#10142a', '#161b36', '#1d2342'],
    celestialColor: '#e8f1ff',
    celestialGlow: '#a8c4ff',
    celestialSize: 5,
    celestialY: 54,
    celestialX: -0.4,
    aurora: false,
    butterflies: false,
    snowCap: '#dfe8ff',
    // 光照分层：夜都灯光最聚焦，霓虹承担主要发光；curb 提亮与路面拉开
    ambientGround: '#1a1e2e',
    hemiIntensity: 0.28,
    lampFocus: 1.5,
    fogBreathAmp: 0.12,
    fogBreathSpeed: 0.11,
    exposureBreath: 0.028,
    shadowStrength: 0.36,
    nightLift: 0.4,
    neonHue: ['#ff3ea5', '#3ea5ff', '#b14aff', '#4affd4'],
    propRoughness: 0.85,
    godrayColor: '#cfe4ff',
    godrayOpacity: 0.08,
    mistColor: '#141832',
  },
  {
    id: 'beach',
    name: '夏日 · 海滩',
    mapKind: 'beach',
    night: false,
    defaultWeather: 'clear',
    skyTop: '#3f9fd8',
    skyBottom: '#cfeef2',
    fog: '#a8d8e0',
    fogDensity: 0.014,
    ambient: '#fff4dc',
    ambientIntensity: 0.5,
    sunColor: '#fff0c0',
    sunIntensity: 1.75,
    sunPosition: [22, 34, -30],
    ground: '#e0c890',
    roadBase: ['#e8d6a0', '#dfcc92', '#f0e0ae', '#d8c488'],
    curb: ['#c8b282', '#d2bc8c', '#bfa878'],
    // rock 加深：原与 ground #e0c890 明度过近，缺少礁石质感
    rock: ['#b09870', '#a08860', '#bca47c'],
    lampPole: '#6a5a44',
    lampGlow: '#ffe9c4',
    foliage: ['#4a9a5e', '#5aa86a', '#3d8a52', '#6ab87a'],
    trunk: '#8a6f4e',
    flowerPetals: ['#ff9a76', '#ffd76e', '#ffffff', '#ff7a9a'],
    coneColor: '#ffe9c4',
    coneOpacity: 0.05,
    characterCore: '#fff8e7',
    characterHalo: '#ffd98a',
    lyricGlow: '#ffb45e',
    particleColor: '#ffffff',
    particlePalette: ['#ffffff', '#fff4dc', '#ffe9a8'],
    particleCount: 160,
    particleKind: 'petal',
    bloom: 0.2,
    bloomRadius: 0.42,
    exposure: 0.92,
    mountains: ['#5a8ab0', '#6f9ec2', '#88b4d4'],
    celestialColor: '#fff6d8',
    celestialGlow: '#ffedb0',
    celestialSize: 4.2,
    celestialY: 44,
    celestialX: 0.55,
    aurora: false,
    butterflies: true,
    snowCap: '#ffffff',
    // 光照分层：夏日强日照、通透，半球光最高；海面反射最强
    ambientGround: '#c8b878',
    hemiIntensity: 0.56,
    lampFocus: 0.5,
    fogBreathAmp: 0.04,
    fogBreathSpeed: 0.05,
    exposureBreath: 0.012,
    shadowStrength: 0.24,
    nightLift: 0,
    seaReflect: 0.55,
    propRoughness: 0.92,
    godrayColor: '#fff4dc',
    godrayOpacity: 0.03,
    mistColor: '#a8d8e0',
  },
];
