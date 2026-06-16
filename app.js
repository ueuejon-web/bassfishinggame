/**
 * BASS FEVER - モバイルバスフィッシングゲーム
 * コアロジック & UI制御 (メジャーサイズ連動 & 左右同期魚影版)
 */

// --- ゲーム状態定義 ---
const STATE = {
  TITLE: 'TITLE',
  CAST_WAIT: 'CAST_WAIT',
  CASTING: 'CASTING',
  RETRIEVING: 'RETRIEVING', // 回収フェーズ
  FIGHT: 'FIGHT',
  RESULT: 'RESULT'
};

let currentState = STATE.TITLE;

// --- 抽選パラメータ ---
const FISH_DATA = {
  CAN: { name: '空き缶', minL: 0, maxL: 0, speed: 0, pullPower: 0, isTrash: true },
  SMALL: { name: 'SMALL', minL: 15, maxL: 25, speed: 1.0, pullPower: 0.7, isTrash: false },
  MEDIUM: { name: 'MEDIUM', minL: 25, maxL: 40, speed: 1.6, pullPower: 1.2, isTrash: false },
  LARGE: { name: 'LARGE', minL: 40, maxL: 50, speed: 2.4, pullPower: 1.8, isTrash: false },
  HUGE: { name: 'EXTRA LARGE', minL: 50, maxL: 60, speed: 3.5, pullPower: 2.6, isTrash: false }
};

// --- ゲーム変数 ---
let selectedFishType = null; // 魚種キー
let fishLength = 0;          // 全長(cm)
let fishWeight = 0;          // 重量(g)
let distance = 15.0;         // 魚（またはルアー）との距離(m)
let tension = 50.0;          // テンション値(0-100, 50=中央)
let tensionVelocity = 0.0;   // テンションの慣性物理用速度
let playerPos = 50.0;        // プレイヤーの位置(0-100)

// 回収・HIT制御用
let willHit = false;         // 今回のキャストで魚がヒットするか
let hitDistance = 0.0;       // ヒットが発生する距離

// 特大バス限定エラ洗い（ジャンプ）用
let isJumping = false;
let jumpTimer = 0;
let jumpTensionHoldTime = 0;

// 操作入力管理フラグ (指一本スワイプ＆リール回転統合)
let isPressing = false;
let pressStartX = 0;
let pressStartPlayerPos = 50.0;
let lastReelAngle = null;
let accumulatedReelRotation = 0;
let isFightTouchActive = false;
let fightTouchSide = null;

// --- 音声効果 (簡易シンセサイザー) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(freq, duration, type = 'sine') {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  
  gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playCastWhoosh() {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(900, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(220, audioCtx.currentTime + 0.55);
  gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.55);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.55);
}

function playSplashSound() {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(240, audioCtx.currentTime);
  gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.18);
}

// --- バイブレーション安全関数 ---
function vibrate(ms) {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(ms);
    } catch (e) {
      // サイレントに無視
    }
  }
}

// 画面揺れ演出
function shakeScreen() {
  const container = document.getElementById('game-container');
  container.classList.add('shake-screen');
  setTimeout(() => {
    container.classList.remove('shake-screen');
  }, 250);
}

// --- UI要素の取得 ---
const screens = {
  TITLE: document.getElementById('screen-title'),
  CAST: document.getElementById('screen-cast'),
  FIGHT: document.getElementById('screen-fight'),
  RESULT: document.getElementById('screen-result')
};

// HUDとコントロールエリアの要素
const elDistance = document.getElementById('txt-distance');
const elDepthFill = document.getElementById('depth-fill');
const elFishInfoFight = document.getElementById('fish-info-fight');
const elTensionGaugeArea = document.getElementById('tension-gauge-area');
const elTensionPointer = document.getElementById('tension-pointer');

// 結果画面のアセット表示切り替え用
const elCanvasResult = document.getElementById('canvas-result-fish');
const elImgResult = document.getElementById('img-result-fish');
const elRulerTicks = document.querySelector('.ruler-ticks');

// メジャー目盛りの動的初期化 (0〜60cm)
function initRulerTicks() {
  if (!elRulerTicks) return;
  elRulerTicks.innerHTML = '';
  for (let cm = 0; cm <= 60; cm += 10) {
    const tick = document.createElement('div');
    tick.className = 'ruler-tick-num';
    tick.innerText = cm;
    elRulerTicks.appendChild(tick);
  }
}

// --- 画面切り替え ---
function changeState(newState) {
  currentState = newState;
  Object.keys(screens).forEach(key => {
    screens[key].classList.remove('active');
  });

  if (newState === STATE.TITLE) {
    screens.TITLE.classList.add('active');
  } else if (newState === STATE.CAST_WAIT || newState === STATE.CASTING) {
    screens.CAST.classList.add('active');
  } else if (newState === STATE.RETRIEVING) {
    screens.FIGHT.classList.add('active');
    elTensionGaugeArea.style.visibility = 'hidden';
    elFishInfoFight.style.display = 'none';
    document.querySelector('.reel-label').innerText = 'リールを回してルアーを回収せよ！';
  } else if (newState === STATE.FIGHT) {
    screens.FIGHT.classList.add('active');
    elTensionGaugeArea.style.visibility = 'visible';
    elFishInfoFight.style.display = 'none';
    document.querySelector('.reel-label').innerText = '左右にドラッグして耐えつつ、回して巻く！';
  } else if (newState === STATE.RESULT) {
    screens.RESULT.classList.add('active');
  }
}

// --- 初期化 ---
document.getElementById('btn-start').addEventListener('click', () => {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  playSound(440, 0.1);
  vibrate(50);
  initRulerTicks(); // メジャー目盛りの設置
  changeState(STATE.CAST_WAIT);
});

// --- キャスト操作 ---
const waterSurface = document.getElementById('water-surface');

waterSurface.addEventListener('click', (e) => {
  if (currentState !== STATE.CAST_WAIT) return;
  
  currentState = STATE.CASTING;
  
  // タップ位置取得
  const rect = waterSurface.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const normalizedY = Math.min(Math.max(y / rect.height, 0), 1);
  const castStrength = 1 - normalizedY;
  const castDistance = 4.0 + castStrength * 10.0;

  playCastWhoosh();

  setTimeout(() => {
    playSplashSound();
    vibrate(30); // 着水振動「ぽちゃっ」
    setupLureRetconciliation(castDistance);
  }, 1000);
});

// --- 回収フェーズ開始（着水時抽選） ---
function setupLureRetconciliation(castDistance) {
  const rand = Math.random() * 100;
  
  distance = Math.min(Math.max(castDistance, 4.0), 14.0);
  
  isJumping = false;
  jumpTimer = 0;
  jumpTensionHoldTime = 0;

  if (rand < 40) {
    // スルー 40%
    willHit = false;
    selectedFishType = null;
    hitDistance = -1;
  } else {
    willHit = true;
    if (rand < 60) {
      selectedFishType = 'SMALL'; // 小バス 20%
    } else if (rand < 80) {
      selectedFishType = 'MEDIUM'; // 中バス 20%
    } else if (rand < 88) {
      selectedFishType = 'LARGE'; // 大バス 8%
    } else if (rand < 93) {
      selectedFishType = 'HUGE'; // 特大バス 5%
    } else {
      selectedFishType = 'CAN'; // 空き缶 7%
    }

    // HITする距離を決定（1.5m 〜 14.0m の間）
    hitDistance = 1.5 + Math.random() * 12.5;
    
    if (Math.random() < 0.1) {
      hitDistance = 14.8; 
    }
  }

  updateDistanceMeter();
  
  changeState(STATE.RETRIEVING);

  // リトリーブ用のCanvas描画（何も表示しない）
  const canvas = document.getElementById('canvas-fish');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// 距離UIと左側縦メーターの更新
function updateDistanceMeter() {
  elDistance.innerText = distance.toFixed(1);
  const percentage = Math.max(0, Math.min(100, ((distance - 1.0) / 14.0) * 100));
  elDepthFill.style.height = `${percentage}%`;
}

// 重量計算
function calculateWeight(length) {
  if (length === 0) return 0;
  return Math.round(300 + ((length - 15) / 45) * 3700);
}

// --- 指一本でスワイプ（左右移動）＆リール回転を同時に受けるイベント処理 ---
const reelDisc = document.getElementById('reel-disc');

function handleStart(clientX, clientY) {
  isPressing = true;
  pressStartX = clientX;
  pressStartPlayerPos = playerPos;

  const rect = reelDisc.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  lastReelAngle = Math.atan2(clientY - centerY, clientX - centerX);
  accumulatedReelRotation = 0;
}

function handleMove(clientX, clientY) {
  if (!isPressing) return;

  // 左右の移動（バランス調整）: 指の水平スライド量を反映
  const deltaX = clientX - pressStartX;
  const sensitivity = 0.25; 
  let nextPos = pressStartPlayerPos + deltaX * sensitivity;
  playerPos = Math.max(0, Math.min(100, nextPos));

  // リール回転
  const rect = reelDisc.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const currentAngle = Math.atan2(clientY - centerY, clientX - centerX);

  if (lastReelAngle !== null) {
    let diff = currentAngle - lastReelAngle;
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;

    accumulatedReelRotation += Math.abs(diff);

    reelDisc.style.transform = `rotate(${currentAngle * (180 / Math.PI)}deg)`;

    const quarterTurn = Math.PI / 2;
    if (accumulatedReelRotation >= quarterTurn) {
      accumulatedReelRotation -= quarterTurn;
      processReelTurn();
    }
  }
  lastReelAngle = currentAngle;
}

reelDisc.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  handleStart(touch.clientX, touch.clientY);
}, { passive: false });

reelDisc.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  handleMove(touch.clientX, touch.clientY);
}, { passive: false });

reelDisc.addEventListener('mousedown', (e) => {
  e.preventDefault();
  handleStart(e.clientX, e.clientY);
});

window.addEventListener('mousemove', (e) => {
  if (isPressing) {
    handleMove(e.clientX, e.clientY);
  }
});

function handleRelease() {
  isPressing = false;
  lastReelAngle = null;
  isFightTouchActive = false;
  fightTouchSide = null;
}

window.addEventListener('mouseup', handleRelease);
window.addEventListener('touchend', handleRelease);

if (elTensionPointer) {
  const startTensionTouch = (clientX, clientY) => {
    if (currentState !== STATE.FIGHT) return;
    isFightTouchActive = true;
    fightTouchSide = clientX < window.innerWidth / 2 ? 'left' : 'right';
  };

  elTensionPointer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startTensionTouch(e.clientX, e.clientY);
  });

  elTensionPointer.addEventListener('touchstart', (e) => {
    if (e.touches.length === 0) return;
    const touch = e.touches[0];
    isFightTouchActive = true;
    fightTouchSide = touch.clientX < window.innerWidth / 2 ? 'left' : 'right';
  }, { passive: false });
}

function processReelTurn() {
  if (currentState === STATE.RETRIEVING) {
    distance -= 0.25;
    if (distance < 1.0) distance = 1.0;
    updateDistanceMeter();
    
    vibrate(15);
    playSound(220, 0.04, 'triangle');

    if (willHit && distance <= hitDistance) {
      triggerHit();
    } else if (distance <= 1.0) {
      showLandingMiss();
    }
  } else if (currentState === STATE.FIGHT) {
    reelIn();
  }
}

function triggerHit() {
  const config = FISH_DATA[selectedFishType];
  
  if (config.isTrash) {
    fishLength = 0;
    fishWeight = 0;
    elFishInfoFight.innerText = 'ゴミ？';
  } else {
    fishLength = Math.round(config.minL + Math.random() * (config.maxL - config.minL));
    fishWeight = calculateWeight(fishLength);
    elFishInfoFight.innerText = `${config.name} (${fishLength}cm)`;
  }

  tension = 50.0;
  tensionVelocity = 0.0;
  playerPos = 50.0;
  isJumping = false;
  jumpTimer = 0;
  
  // エリア追跡のリセット
  currentArea = AREA.CENTER;
  previousArea = AREA.CENTER;
  areaStayTime = 0;
  areaChangeCount = 0;
  lastTime = 0;
  fishMoveTime = 0;

  vibrate(200);
  shakeScreen();
  playSound(600, 0.1, 'sine');
  setTimeout(() => playSound(800, 0.15, 'sine'), 100);

  changeState(STATE.FIGHT);
  requestAnimationFrame(fightLoop);
}

function showLandingMiss() {
  changeState(STATE.CAST_WAIT);
}

function reelIn() {
  if (tension > 25 && tension < 75) {
    if (isTensionInWhiteZone() || !isMediumOrLarger()) {
      if (distance > 1.0) {
        distance -= 0.25;
        if (distance < 1.0) distance = 1.0;
        updateDistanceMeter();
      }
      vibrate(15);
      playSound(300, 0.05, 'triangle');
      if (distance <= 1.0) {
        landingSuccess();
      }
    } else if (isTensionInBlueZone()) {
      if (tension < 50) {
        tension = Math.max(0, tension - 12);
      } else {
        tension = Math.min(100, tension + 12);
      }
      updateTensionUI();
      playSound(220, 0.05, 'triangle');
    }
  } else {
    playSound(180, 0.1, 'sawtooth');
  }
}

// --- ファイト状態物理シミュレーション ---
let lastTime = 0;
let fishMoveTime = 0;
let fishTargetOffset = 0;
let fishCombinedOffset = 0; // 合成オフセット（振幅＋横方向ラン）
let previousCombinedOffset = 0;
let fishMoveVelocity = 0; // 合成オフセットの瞬時速度
let fishRunPhase = 0; // 横移動の位相
let fishFacingRight = true;

// --- エリア定義とファイトルール ---
const AREA = {
  BLUE: 'BLUE',
  CENTER: 'CENTER',
  RED: 'RED'
};

// エリア境界 (playerPos: 0-100)
const AREA_BOUNDARIES = {
  BLUE_END: 35,      // 0-35: BLUE
  RED_START: 65      // 65-100: RED
};

// サイズ別ファイトルール
const FIGHT_RULES = {
  SMALL: {
    name: 'SMALL',
    allowedAreas: [AREA.BLUE, AREA.CENTER],  // 青のエリアまでしかいかない
    difficulty: 'EASY'
  },
  MEDIUM: {
    name: 'MEDIUM',
    allowedAreas: [AREA.BLUE, AREA.CENTER, AREA.RED],  // 赤にも行くが
    difficulty: 'NORMAL'
  },
  LARGE: {
    name: 'LARGE',
    allowedAreas: [AREA.BLUE, AREA.CENTER, AREA.RED],
    difficulty: 'HARD'
  },
  HUGE: {
    name: 'EXTRA LARGE',
    allowedAreas: [AREA.BLUE, AREA.CENTER, AREA.RED],
    difficulty: 'EXTREME'
  }
};

// ファイト中のエリア追跡
let currentArea = AREA.CENTER;
let previousArea = AREA.CENTER;
let areaStayTime = 0;
let lastAreaChangeTime = 0;
let areaChangeCount = 0;
let tensionArea = AREA.CENTER;
let previousTensionArea = AREA.CENTER;
let redZoneActionTimer = 0;

function getAreaFromPosition(pos) {
  if (pos < AREA_BOUNDARIES.BLUE_END) {
    return AREA.BLUE;
  } else if (pos > AREA_BOUNDARIES.RED_START) {
    return AREA.RED;
  } else {
    return AREA.CENTER;
  }
}

function updateAreaTracking(dt) {
  const newArea = getAreaFromPosition(playerPos);
  
  if (newArea !== currentArea) {
    previousArea = currentArea;
    currentArea = newArea;
    areaStayTime = 0;
    areaChangeCount++;
    lastAreaChangeTime = 0;
  } else {
    areaStayTime += dt;
  }
}

function updateAreaTimerUI() {
  return;
}

function isMediumOrLarger() {
  return selectedFishType === 'MEDIUM' || selectedFishType === 'LARGE' || selectedFishType === 'HUGE';
}

function getTensionAreaFromValue(value) {
  if (value <= 25 || value >= 75) {
    return AREA.RED;
  }
  if ((value > 25 && value < 35) || (value > 65 && value < 75)) {
    return AREA.BLUE;
  }
  return AREA.CENTER;
}

function updateTensionAreaTracking() {
  const newArea = getTensionAreaFromValue(tension);
  if (newArea !== tensionArea) {
    previousTensionArea = tensionArea;
    tensionArea = newArea;
  }
}

function isTensionInWhiteZone() {
  return tension >= 35 && tension <= 65;
}

function isTensionInBlueZone() {
  return (tension > 25 && tension < 35) || (tension > 65 && tension < 75);
}

function isLeftBlueZone() {
  return tension > 25 && tension < 35;
}

function isRightBlueZone() {
  return tension > 65 && tension < 75;
}

function getOppositeBlueTarget() {
  return tension <= 50 ? 70 : 30;
}

function getOppositeRedTarget() {
  return tension <= 50 ? 90 : 10;
}

function applyTouchReturnToWhite(dt) {
  if (!isMediumOrLarger() || !isFightTouchActive) return;
  const drift = 20 * dt;
  if (tension < 50) {
    tension = Math.min(50, tension + drift);
  } else {
    tension = Math.max(50, tension - drift);
  }
}

function handleTensionRedEntry() {
  if (!isMediumOrLarger()) return;
  if (distance <= 1.0) return;
  if (redZoneActionTimer > 0) return;

  const rand = Math.random() * 100;
  let target = null;

  if (selectedFishType === 'MEDIUM') {
    if (rand < 50) {
      target = getOppositeBlueTarget();
    }
  } else if (selectedFishType === 'LARGE') {
    if (rand < 20) {
      target = getOppositeBlueTarget();
    } else if (rand < 30) {
      target = getOppositeRedTarget();
    }
  } else if (selectedFishType === 'HUGE') {
    if (rand < 20) {
      target = getOppositeBlueTarget();
    } else if (rand < 40) {
      target = getOppositeRedTarget();
    }
  }

  if (target !== null) {
    tension = target;
    tensionVelocity = 0;
    redZoneActionTimer = 3.0;
  }
}

function isTensionInRedZone() {
  return tension <= 25 || tension >= 75;
}

function isTouchingCorrespondingRedArea() {
  if (!isFightTouchActive || !fightTouchSide) return false;
  if (tension <= 25) {
    return fightTouchSide === 'left';
  }
  if (tension >= 75) {
    return fightTouchSide === 'right';
  }
  return true;
}

function getRedTensionSide() {
  if (!isTensionInRedZone()) return null;
  return tension <= 25 ? 'left' : 'right';
}

function shouldReturnLine() {
  if (!isMediumOrLarger() || currentState !== STATE.FIGHT) return false;

  if (!isFightTouchActive) {
    return true;
  }

  if (!isTensionInRedZone()) {
    return false;
  }

  const targetSide = getRedTensionSide();
  return fightTouchSide !== targetSide;
}

function applyReturnLine(dt) {
  if (!shouldReturnLine()) return false;

  const returnSpeed = 0.6; // m per second
  distance += returnSpeed * dt;
  distance = Math.min(distance, 15.0);
  updateDistanceMeter();

  if (distance >= 15.0) {
    fishRanAway();
    return true;
  }

  return false;
}

function fishRanAway() {
  currentState = STATE.RESULT;
  playSound(180, 0.4, 'sawtooth');
  vibrate([80, 40, 80]);
  
  document.getElementById('result-title').innerText = '逃げられた...';
  document.getElementById('res-name').innerText = '逃げられてしまった...';
  document.getElementById('res-length').innerText = '-';
  document.getElementById('res-weight').innerText = '-';
  
  elImgResult.style.display = 'none';
  elCanvasResult.style.display = 'block';
  const ctx = elCanvasResult.getContext('2d');
  ctx.clearRect(0, 0, elCanvasResult.width, elCanvasResult.height);
  
  changeState(STATE.RESULT);
}

function checkAreaRuleViolation() {
  return false;
}

function handleAreaRuleViolation() {
  return false;
}

const fishShadowLeft = new Image();
fishShadowLeft.src = 'fish_shadow.png';
const fishShadowRight = new Image();
fishShadowRight.src = 'fish_shadow2.png';
const trashFightImage = new Image();
trashFightImage.src = '3a058364-9de6-4db6-af61-16094564de18 - 2.png';
const trashResultImage = new Image();
trashResultImage.src = '3a058364-9de6-4db6-af61-16094564de18.png';

function fightLoop(timestamp) {
  if (currentState !== STATE.FIGHT) return;
  
  if (!lastTime) lastTime = timestamp;
  const dt = Math.min((timestamp - lastTime) / 1000, 0.08);
  lastTime = timestamp;

  const fish = FISH_DATA[selectedFishType];

  // エリア追跡と滞在時間管理
  updateAreaTracking(dt);
  updateAreaTimerUI();

  // MEDIUM以上の戻し処理
  if (applyReturnLine(dt)) {
    return;
  }

  // ルール違反チェック
  if (checkAreaRuleViolation()) {
    handleAreaRuleViolation();
    return;
  }

  if (selectedFishType === 'HUGE') {
    jumpTimer += dt;
    if (!isJumping && jumpTimer > 4.5 && Math.random() < 0.005) {
      isJumping = true;
      jumpTensionHoldTime = 1.5;
      jumpTimer = 0;
      vibrate(150);
      shakeScreen();
      playSound(120, 0.4, 'sawtooth');
    }
    
    if (isJumping) {
      jumpTensionHoldTime -= dt;
      if (jumpTensionHoldTime <= 0) {
        isJumping = false;
      } else {
        fishTargetOffset = Math.sin(timestamp / 30) * 35;
      }
    }
  }

  if (!fish.isTrash && !isJumping) {
    fishMoveTime += dt * fish.speed;
    fishTargetOffset = Math.sin(fishMoveTime) * 25 + Math.sin(fishMoveTime * 1.5) * 8;
  } else if (fish.isTrash) {
    fishTargetOffset = 0;
  }

  // 横方向のラン（位相を進めて左右往復を作る）
  fishRunPhase += dt * (0.8 + fish.speed * 0.6);
  const lateralOsc = Math.sin(fishRunPhase) * (8 + fish.speed * 4);

  // 合成オフセットと速度（フレーム間差分）
  fishCombinedOffset = fishTargetOffset + lateralOsc;
  fishMoveVelocity = (fishCombinedOffset - previousCombinedOffset) / Math.max(dt, 0.0001);
  fishFacingRight = fishCombinedOffset >= previousCombinedOffset;
  previousCombinedOffset = fishCombinedOffset;

  const targetTension = 50 + fishTargetOffset - (playerPos - 50) * fish.pullPower;
  const springStrength = 12.0; 
  const damping = 18.0;

  const force = (targetTension - tension) * springStrength;
  tensionVelocity += force * dt;
  tensionVelocity -= tensionVelocity * damping * dt;

  tensionVelocity = Math.max(-150, Math.min(150, tensionVelocity));
  
  tension += tensionVelocity * dt;
  tension = Math.max(0, Math.min(100, tension));

  if (redZoneActionTimer > 0) {
    redZoneActionTimer = Math.max(0, redZoneActionTimer - dt);
  }

  applyTouchReturnToWhite(dt);
  updateTensionAreaTracking();
  if (previousTensionArea !== tensionArea && tensionArea === AREA.RED) {
    handleTensionRedEntry();
  }

  updateTensionUI();
  handleFightVibration();
  drawFishCanvas();

  if (distance <= 1.0) {
    landingSuccess();
    return;
  }

  requestAnimationFrame(fightLoop);
}

let vibTimer = 0;
function handleFightVibration() {
  vibTimer++;
  let gap = 30;
  let force = 10;
  
  const diff = Math.abs(tension - 50);

  if (diff > 35) {
    gap = 4;
    force = 80;
  } else if (diff > 15) {
    gap = 12;
    force = 30;
  } else {
    gap = 35;
    force = 8;
  }

  if (vibTimer % gap === 0) {
    vibrate(force);
  }
}

function updateTensionUI() {
  const pointer = document.getElementById('tension-pointer');
  if (pointer) {
    pointer.style.left = `${tension}%`;
  }
}

// --- リアルなブラックバスのCanvas描画 (ファイト中) ---
function drawFishCanvas() {
  const canvas = document.getElementById('canvas-fish');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const fish = FISH_DATA[selectedFishType];
  if (fish.isTrash) {
    if (trashFightImage.complete && trashFightImage.naturalWidth > 0) {
      const maxWidth = canvas.width * 0.85;
      const maxHeight = canvas.height * 0.85;
      const resultScale = 0.5;
      let drawWidth = trashFightImage.naturalWidth;
      let drawHeight = trashFightImage.naturalHeight;
      const ratio = Math.min(maxWidth / drawWidth, maxHeight / drawHeight, 1);
      drawWidth *= ratio * resultScale;
      drawHeight *= ratio * resultScale;
      ctx.drawImage(trashFightImage, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
    } else {
      drawTrash(ctx, canvas.width / 2, canvas.height / 2);
    }
    return;
  }

  const baseLen = 85;
  const lengthScale = 1.0 + ((fishLength - 15) / 45);
  const drawWidth = baseLen * lengthScale;
  const drawHeight = 28 * (1.0 + ((fishLength - 15) / 45) * 0.7);

  // 魚影の位置をテンションゲージ近傍へ移動、上下動は控えめに。左右は合成オフセットで動かす
  const x = canvas.width * 0.48 + fishCombinedOffset * 0.5;
  let y = canvas.height * 0.72 + (isJumping ? -16 : Math.sin(Date.now() / 420) * 3);

  const fishImg = fishFacingRight ? fishShadowRight : fishShadowLeft;
  if (fishImg.complete && fishImg.naturalWidth > 0) {
    const imageAspect = fishImg.naturalWidth / fishImg.naturalHeight;
    const finalDrawWidth = drawWidth * 0.82; // 少し小さく
    const finalDrawHeight = finalDrawWidth / imageAspect; // アスペクト比維持

    // 激しく移動している時は頭を少し下げる（回転）と縦方向に沈む表現
    const tiltFromVelocity = -fishMoveVelocity * 0.002; // 速度に応じた傾き
    const tilt = Math.max(-0.35, Math.min(0.35, tiltFromVelocity + (tension - 50) * 0.0008));
    y += Math.max(0, Math.min(14, Math.abs(fishMoveVelocity) * 0.04));

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.drawImage(fishImg, -finalDrawWidth / 2, -finalDrawHeight / 2, finalDrawWidth, finalDrawHeight);
    ctx.restore();
  } else {
    drawRealisticBass(ctx, x, y, drawWidth * 0.82, drawHeight * 0.82, (tension - 50) * 0.006);
  }
}

function drawRealisticBass(ctx, x, y, width, height, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // 背びれ
  ctx.fillStyle = '#4f5e43';
  ctx.beginPath();
  ctx.moveTo(-width * 0.2, -height * 0.45);
  ctx.quadraticCurveTo(0, -height * 0.8, width * 0.15, -height * 0.45);
  ctx.lineTo(width * 0.1, -height * 0.4);
  ctx.quadraticCurveTo(-0.05, -height * 0.65, -width * 0.15, -height * 0.4);
  ctx.closePath();
  ctx.fill();

  // 背部2
  ctx.fillStyle = '#5c6e4e';
  ctx.beginPath();
  ctx.moveTo(width * 0.1, -height * 0.4);
  ctx.quadraticCurveTo(width * 0.25, -height * 0.7, width * 0.35, -height * 0.3);
  ctx.lineTo(width * 0.3, -height * 0.25);
  ctx.closePath();
  ctx.fill();

  // 腹びれ & 尻びれ
  ctx.fillStyle = '#b5be9e';
  ctx.beginPath();
  ctx.moveTo(-width * 0.1, height * 0.4);
  ctx.lineTo(-width * 0.15, height * 0.6);
  ctx.lineTo(-width * 0.05, height * 0.45);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(width * 0.15, height * 0.35);
  ctx.quadraticCurveTo(width * 0.25, height * 0.55, width * 0.3, height * 0.25);
  ctx.closePath();
  ctx.fill();

  // 尾ひれ
  ctx.fillStyle = '#5c6e4e';
  ctx.beginPath();
  ctx.moveTo(width * 0.42, -height * 0.1);
  ctx.quadraticCurveTo(width * 0.58, -height * 0.5, width * 0.6, -height * 0.5);
  ctx.quadraticCurveTo(width * 0.53, 0, width * 0.6, height * 0.5);
  ctx.quadraticCurveTo(width * 0.58, height * 0.5, width * 0.42, height * 0.1);
  ctx.closePath();
  ctx.fill();

  // 胴体
  const grad = ctx.createLinearGradient(0, -height / 2, 0, height / 2);
  grad.addColorStop(0, '#2d3b24');
  grad.addColorStop(0.35, '#5c6e4e');
  grad.addColorStop(0.65, '#9da880');
  grad.addColorStop(0.9, '#f4f6eb');
  grad.addColorStop(1, '#ffffff');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-width * 0.5, 0);
  ctx.bezierCurveTo(-width * 0.3, -height * 0.65, width * 0.2, -height * 0.55, width * 0.45, -height * 0.1);
  ctx.lineTo(width * 0.45, height * 0.1);
  ctx.bezierCurveTo(width * 0.2, height * 0.55, -width * 0.3, height * 0.65, -width * 0.5, 0);
  ctx.closePath();
  ctx.fill();

  // 胸びれ
  ctx.fillStyle = 'rgba(181, 190, 158, 0.8)';
  ctx.beginPath();
  ctx.moveTo(-width * 0.2, height * 0.15);
  ctx.quadraticCurveTo(-width * 0.08, height * 0.38, -width * 0.1, height * 0.1);
  ctx.closePath();
  ctx.fill();

  // 側線
  ctx.fillStyle = '#1e2417';
  ctx.beginPath();
  for (let i = -6; i <= 4; i++) {
    const ratio = i / 10;
    const cx = width * ratio;
    const cy = Math.sin(ratio * Math.PI) * (height * 0.08);
    const rSize = height * (0.08 + Math.random() * 0.07);
    ctx.arc(cx, cy, rSize, 0, Math.PI * 2);
    ctx.arc(cx - 2, cy - height * 0.1, rSize * 0.6, 0, Math.PI * 2);
    ctx.arc(cx + 1, cy + height * 0.12, rSize * 0.5, 0, Math.PI * 2);
  }
  ctx.fill();

  // 鰓蓋
  ctx.strokeStyle = '#46543b';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(-width * 0.25, -height * 0.05, height * 0.3, -Math.PI * 0.4, Math.PI * 0.5);
  ctx.stroke();

  // 口
  ctx.strokeStyle = '#1e2417';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-width * 0.5, 0);
  ctx.lineTo(-width * 0.32, height * 0.08);
  ctx.stroke();

  // 目
  ctx.fillStyle = '#ffd700';
  ctx.beginPath();
  ctx.arc(-width * 0.36, -height * 0.14, height * 0.1, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(-width * 0.36, -height * 0.14, height * 0.06, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// 空き缶の描画
function drawTrash(ctx, x, y) {
  const scale = 0.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#78716c';
  ctx.shadowBlur = 0;
  
  ctx.fillRect(-22, -32, 44, 64);
  
  ctx.fillStyle = '#451a03';
  ctx.fillRect(-12, -10, 10, 15);
  ctx.fillRect(5, 12, 12, 10);
  
  ctx.fillStyle = '#44403c';
  ctx.fillRect(-24, -34, 48, 4);
  ctx.fillRect(-24, 30, 48, 4);
  
  ctx.strokeStyle = '#a8a29e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(-4, -38, 5, 0, Math.PI * 2);
  ctx.stroke();
  
  ctx.restore();
}

// --- 逃げられた判定 ---
// --- ランディング成功判定 ---
function landingSuccess() {
  currentState = STATE.RESULT;
  
  playSound(523.25, 0.1, 'sine');
  setTimeout(() => playSound(659.25, 0.1, 'sine'), 100);
  setTimeout(() => playSound(783.99, 0.1, 'sine'), 200);
  setTimeout(() => {
    playSound(1046.50, 0.3, 'sine');
    vibrate([100, 50, 100]);
    shakeScreen();
  }, 300);

  const fish = FISH_DATA[selectedFishType];
  
  document.getElementById('result-title').innerText = 'LANDING SUCCESS!';
  document.getElementById('res-name').innerText = fish.name;
  
  if (fish.isTrash) {
    document.getElementById('res-length').innerText = 'なし';
    document.getElementById('res-weight').innerText = 'なし';
    
    // ゴミは専用画像で表示する
    elCanvasResult.style.display = 'none';
    elImgResult.src = trashResultImage.src;
    elImgResult.style.width = 'auto';
    elImgResult.style.maxWidth = '50%';
    elImgResult.style.height = 'auto';
    elImgResult.style.display = 'block';
  } else {
    document.getElementById('res-length').innerText = `${fishLength} cm`;
    document.getElementById('res-weight').innerText = `${fishWeight} g`;
    
    // 【要件変更】魚種画像切り替え ＆ メジャーサイズ連動
    // 40cmまでは1枚目 (fish_small.png)、それ以上は2枚目 (fish_large.png)
    if (fishLength <= 40) {
      elImgResult.src = 'fish_small.png';
    } else {
      elImgResult.src = 'fish_large.png';
    }
    
    const widthPercentage = (fishLength / 60) * 100;
    elImgResult.style.width = `calc(${widthPercentage}% - 16px)`; 
    
    elCanvasResult.style.display = 'none';
    elImgResult.style.display = 'block';
  }

  changeState(STATE.RESULT);
}

// --- リスタート ---
document.getElementById('btn-restart').addEventListener('click', () => {
  playSound(440, 0.05);
  changeState(STATE.CAST_WAIT);
});
