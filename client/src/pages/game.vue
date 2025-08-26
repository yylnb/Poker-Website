<template>
  <div class="min-h-screen flex flex-col items-center justify-start bg-[url('/src/assets/table-bg.jpg')] bg-cover bg-center p-safe">
    <div class="relative w-full mx-auto px-3" style="max-width:980px; box-sizing: border-box;">

      <!-- 中央：公共牌与底池显示 -->
      <div class="mx-auto w-full mt-3 sm:mt-5" style="max-width:900px;">
        <div
          class="mx-auto rounded-xl bg-emerald-900/90 shadow-2xl flex items-center justify-center"
          :style="tableStyle"
        >
          <div class="flex flex-col items-center gap-3 p-3 w-full">
            <div class="flex gap-2 overflow-auto px-2 justify-center">
              <div
                v-for="(card, idx) in communityCards"
                :key="idx"
                class="w-16 sm:w-20 h-24 sm:h-28 bg-white text-black flex items-center justify-center rounded-lg shadow-md text-sm sm:text-lg"
              >
                {{ card }}
              </div>

              <div v-if="communityCards.length === 0" class="text-white/60 self-center px-2">
                公共牌（暂无）
              </div>
            </div>

            <div class="text-white/80 text-sm">底池: {{ pot }}K</div>

            <div class="mt-1 text-sm text-white/90 text-center">
              当前回合:
              <span class="font-medium">{{ currentTurnNickname || "—" }}</span>
              <span
                v-if="currentTurnId === socket.id"
                class="ml-2 text-xs bg-yellow-300 text-black px-2 py-0.5 rounded"
              >
                你的回合
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 玩家卡片区：桌面与移动共用 -->
      <div class="mt-6 px-3">
        <div
          v-if="isMobile"
          class="grid grid-cols-2 gap-3 justify-center"
        >
          <div
            v-for="(player, index) in players"
            :key="player.id"
            class="player-card rounded-xl shadow-md bg-black/60 backdrop-blur-sm text-white p-3 flex gap-3 items-center w-full"
          >
            <div
              class="w-12 h-12 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0"
              :class="isLocalPlayer(player) ? 'ring-4 ring-green-400' : ''"
              :style="{ background: isLocalPlayer(player) ? 'linear-gradient(#10b981,#065f46)' : 'linear-gradient(#f59e0b,#b45309)' }"
            >
              {{ player.nickname }}
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex gap-2 mb-2">
                <div
                  v-for="(card, cIndex) in player.hand"
                  :key="cIndex"
                  class="w-11 h-14 rounded-lg bg-white text-black flex items-center justify-center text-xs"
                >
                  <span v-if="isLocalPlayer(player) || stage === 'showdown'">{{ card }}</span>
                  <span v-else>?</span>
                </div>
              </div>

              <div class="text-xs text-white/90">
                <div class="font-medium truncate">{{ player.chips }}K</div>
                <div v-if="player.currentBet" class="text-[11px] text-yellow-200">注: {{ player.currentBet }}K</div>
                <div v-if="player.folded" class="text-[11px] text-red-300">已弃</div>
                <div v-if="currentTurnId === player.id" class="mt-1 inline-block px-2 py-0.5 text-[11px] bg-yellow-300 text-black rounded">
                  当前回合
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="players-grid flex flex-wrap gap-3 justify-center">
          <div
            v-for="(player, index) in players"
            :key="player.id"
            class="player-card rounded-xl shadow-md bg-black/60 backdrop-blur-sm text-white p-3 flex gap-3 items-center w-44"
          >
            <div
              class="w-14 h-14 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0"
              :class="isLocalPlayer(player) ? 'ring-4 ring-green-400' : ''"
              :style="{ background: isLocalPlayer(player) ? 'linear-gradient(#10b981,#065f46)' : 'linear-gradient(#f59e0b,#b45309)' }"
            >
              {{ player.nickname }}
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex gap-2 mb-2">
                <div
                  v-for="(card, cIndex) in player.hand"
                  :key="cIndex"
                  class="w-12 h-16 rounded-lg bg-white text-black flex items-center justify-center text-xs"
                >
                  <span v-if="isLocalPlayer(player) || stage === 'showdown'">{{ card }}</span>
                  <span v-else>?</span>
                </div>
              </div>

              <div class="text-xs text-white/90">
                <div class="font-medium truncate">{{ player.chips }}K</div>
                <div v-if="player.currentBet" class="text-[11px] text-yellow-200">注: {{ player.currentBet }}K</div>
                <div v-if="player.folded" class="text-[11px] text-red-300">已弃</div>
                <div v-if="currentTurnId === player.id" class="mt-1 inline-block px-2 py-0.5 text-[11px] bg-yellow-300 text-black rounded">
                  当前回合
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 控制栏：桌面与移动分别渲染 -->
      <!-- Desktop: 保持原有横向控制栏 -->
      <div v-if="!isMobile" class="fixed bottom-2 left-1/2 -translate-x-1/2 w-full max-w-[980px] px-3 z-40">
        <div class="bg-black/50 backdrop-blur-sm rounded-xl p-2 flex flex-col gap-2 items-center no-scrollbar">
          <div class="w-full flex items-center gap-2">
            <button
              @click="startGame"
              :disabled="!isOwner || stage === 'showdown'"
              :class="['min-w-[90px] px-3 py-2 rounded-lg text-white text-sm', isOwner && stage !== 'showdown' ? 'bg-blue-600' : 'bg-gray-400 cursor-not-allowed']"
            >
              开始游戏
            </button>

            <button
              @click="nextStage"
              :disabled="!isOwner"
              :class="['min-w-[90px] px-3 py-2 rounded-lg text-white text-sm', isOwner ? 'bg-red-600' : 'bg-gray-400 cursor-not-allowed']"
            >
              下一阶段
            </button>

            <button
              v-if="stage === 'showdown'"
              @click="restartGame"
              :disabled="!isOwner"
              :class="['min-w-[90px] px-3 py-2 rounded-lg text-white text-sm', isOwner ? 'bg-violet-600' : 'bg-gray-400 cursor-not-allowed']"
            >
              Restart
            </button>

            <div class="flex gap-2 items-center pl-2">
              <!-- Call -->
              <button
                @click="doCall"
                :disabled="!isMyTurn"
                class="min-w-[70px] px-3 py-2 rounded bg-indigo-600 text-white text-sm flex flex-col items-center leading-tight"
              >
                <span>Call</span>
                <span class="btn-subtext">跟注</span>
              </button>

              <!-- 快捷加注 -->
              <button @click="doRaise(10)" :disabled="!isMyTurn" class="min-w-[70px] px-3 py-2 rounded bg-orange-500 text-white text-sm">+10K</button>
              <button @click="doRaise(50)" :disabled="!isMyTurn" class="min-w-[70px] px-3 py-2 rounded bg-orange-500 text-white text-sm">+50K</button>
              <button @click="doRaise(100)" :disabled="!isMyTurn" class="min-w-[70px] px-3 py-2 rounded bg-orange-500 text-white text-sm">+100K</button>

              <!-- Check -->
              <button
                @click="doCheck"
                :disabled="!isMyTurn || !canCheck"
                class="min-w-[70px] px-3 py-2 rounded bg-slate-600 text-white text-sm flex flex-col items-center leading-tight"
              >
                <span>Check</span>
                <span class="btn-subtext">过牌</span>
              </button>

              <!-- Fold -->
              <button
                @click="doFold"
                :disabled="!isMyTurn"
                class="min-w-[70px] px-3 py-2 rounded bg-stone-700 text-white text-sm flex flex-col items-center leading-tight"
              >
                <span>Fold</span>
                <span class="btn-subtext">弃牌</span>
              </button>
            </div>
          </div>

          <!-- Slider row (desktop) -->
          <div class="w-full flex items-center gap-3">
            <div class="flex-1">
              <input
                type="range"
                v-model="raiseSlider"
                :min="raiseStep"
                :max="sliderMax"
                :step="raiseStep"
                class="w-full"
              />
            </div>
            <div class="text-xs text-white/90 w-24 text-center">{{ raiseSlider }}K</div>

            <!-- Raise 主按钮（带中文解释） -->
            <button
              @click="doRaise(raiseSlider)"
              :disabled="!isMyTurn || raiseSlider <= 0"
              class="px-3 py-2 rounded bg-amber-500 text-black text-sm flex flex-col items-center leading-tight"
            >
              <span>Raise</span>
              <span class="btn-subtext text-black/80">加注</span>
            </button>

            <div class="ml-auto text-xs text-white/80 px-2">Pot: {{ pot }}K</div>
          </div>
        </div>
      </div>

      <!-- Mobile control bar -->
      <div v-else
           class="fixed z-50"
           :style="{ left: '8px', right: '8px', bottom: '8px', maxWidth: 'calc(100vw - 16px)' }"
      >
        <div
          class="bg-black/72 backdrop-blur-sm rounded-xl mobile-controls"
          :style="{ paddingBottom: 'env(safe-area-inset-bottom)', boxSizing: 'border-box' }"
        >
          <!-- 房主小控制（三列） -->
          <div class="grid grid-cols-3 gap-2 p-2">
            <button @click="startGame" :disabled="!isOwner || stage === 'showdown'" :class="['mobile-btn small owner', isOwner && stage !== 'showdown' ? 'owner-enabled' : 'owner-disabled']">开始游戏</button>
            <button @click="nextStage" :disabled="!isOwner" :class="['mobile-btn small owner', isOwner ? 'owner-enabled' : 'owner-disabled']">下一阶段</button>
            <button v-if="stage === 'showdown'" @click="restartGame" :disabled="!isOwner" :class="['mobile-btn small owner', isOwner ? 'owner-enabled' : 'owner-disabled']">Restart</button>
          </div>

          <!-- 主要操作（4列，按钮内双行：英文 + 中文解释） -->
          <div class="grid grid-cols-4 gap-2 p-2">
            <button @click="doCall" :disabled="!isMyTurn" class="mobile-btn primary two-line flex-col">
              <span>Call</span>
              <span class="btn-subtext">跟注</span>
            </button>
            <button @click="doCheck" :disabled="!isMyTurn || !canCheck" class="mobile-btn secondary two-line flex-col">
              <span>Check</span>
              <span class="btn-subtext">过牌</span>
            </button>
            <button @click="doFold" :disabled="!isMyTurn" class="mobile-btn danger two-line flex-col">
              <span>Fold</span>
              <span class="btn-subtext">弃牌</span>
            </button>
            <button @click="doRaise(raiseSlider)" :disabled="!isMyTurn || raiseSlider<=0" class="mobile-btn raise two-line flex-col">
              <span>Raise</span>
              <span class="btn-subtext">加注</span>
            </button>
          </div>

          <!-- Slider 行（整行） -->
          <div class="p-2">
            <input
              type="range"
              v-model="raiseSlider"
              :min="raiseStep"
              :max="sliderMax"
              :step="raiseStep"
              class="w-full mb-2"
            />
            <div class="flex items-center gap-2">
              <div class="text-sm text-white/90">下注: {{ raiseSlider }}K</div>
              <div class="ml-auto text-xs text-white/80">Pot: {{ pot }}K</div>
            </div>
          </div>

          <!-- 快捷加注三列（保持单行文案，不加中文解释） -->
          <div class="grid grid-cols-3 gap-2 p-2">
            <button @click="doRaise(10)" :disabled="!isMyTurn" class="mobile-btn quick">+10K</button>
            <button @click="doRaise(50)" :disabled="!isMyTurn" class="mobile-btn quick">+50K</button>
            <button @click="doRaise(100)" :disabled="!isMyTurn" class="mobile-btn quick">+100K</button>
          </div>
        </div>
      </div>

      <!-- Showdown Modal -->
      <transition name="modal" enter-active-class="ease-out duration-300" leave-active-class="ease-in duration-200">
        <div v-if="showdownModal" class="fixed inset-0 z-50 flex items-center justify-center">
          <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="closeModal"></div>

          <div
            class="relative bg-white rounded-2xl shadow-2xl p-6 w-[720px] max-w-[95%] transform transition-transform"
            :class="{'scale-100 opacity-100': showdownModal, 'scale-95 opacity-0': !showdownModal}"
          >
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-2xl font-bold">摊牌结果</h3>
              <button @click="closeModal" class="text-sm text-gray-500 hover:text-gray-800">关闭</button>
            </div>

            <div class="space-y-4 max-h-[60vh] overflow-auto">
              <div v-for="(potItem, idx) in showdownPots" :key="idx" class="p-3 border rounded-lg">
                <div class="text-sm text-gray-600 mb-2">
                  Pot {{ idx + 1 }}:
                  <span class="font-semibold">{{ potItem.amount }}K</span>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div v-for="(w, wi) in potItem.winners" :key="w.id" class="p-2 bg-gray-50 rounded flex items-center gap-3">
                    <div class="w-12 h-12 rounded-full bg-green-200 flex items-center justify-center text-sm font-medium">
                      {{ w.nickname[0] || 'U' }}
                    </div>
                    <div>
                      <div class="font-medium">{{ w.nickname }}</div>
                      <div class="text-xs text-gray-600">赢得: {{ w.share }}K</div>
                      <div class="text-xs text-gray-500">牌型: {{ w.handName }}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="p-3 border rounded-lg bg-yellow-50">
                <div class="font-medium">最终筹码</div>
                <div class="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2">
                  <div v-for="p in players" :key="p.id" class="text-sm bg-white p-2 rounded">
                    <div class="font-medium">{{ p.nickname }}</div>
                    <div class="text-xs text-gray-600">筹码: {{ p.chips }}K</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-4 flex justify-end gap-2">
              <button v-if="isOwner" @click="restartGame" class="px-4 py-2 rounded bg-violet-600 text-white hover:bg-violet-700">Restart</button>
              <button @click="closeModal" class="px-4 py-2 rounded border">关闭</button>
            </div>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from "vue";
import { io } from "socket.io-client";
import { useUserStore } from "../stores/user";

const store = useUserStore();
// io() initialization unchanged
const socket = io();

const players = ref([]);
const communityCards = ref([]);
const pot = ref(0);
const stage = ref("preflop");
const ownerId = ref(null);
const ownerNickname = ref(null);
const currentMaxBet = ref(0);
const currentTurnId = ref(null);
const currentTurnNickname = ref(null);

const showdownModal = ref(false);
const showdownPots = ref([]);

// mobile breakpoint kept conservative
const isMobile = ref(window.innerWidth < 420);
function handleResize() {
  isMobile.value = window.innerWidth < 420;
}
window.addEventListener("resize", handleResize);

const tableStyle = computed(() => {
  const w = Math.min(window.innerWidth - 40, isMobile.value ? 420 : 600);
  const h = Math.min(window.innerHeight * (isMobile.value ? 0.38 : 0.55), isMobile.value ? 260 : 400);
  return { width: `${w}px`, height: `${h}px` };
});

const localPlayer = computed(() => players.value.find(p => p.id === socket.id) || null);

// slider state: unit = K
const raiseSlider = ref(10);
const raiseStep = computed(() => {
  const maxChips = localPlayer.value?.chips || 0;
  return maxChips >= 10 ? 10 : 1;
});
const sliderMax = computed(() => Math.max(raiseStep.value, localPlayer.value?.chips || raiseStep.value));

watch(sliderMax, (newMax) => {
  if (raiseSlider.value > newMax) raiseSlider.value = newMax;
});
watch(localPlayer, (p) => {
  if (p) raiseSlider.value = Math.min(10, p.chips || 10) || raiseStep.value;
});

onMounted(() => {
  socket.emit("joinRoom", {
    roomId: store.roomId,
    nickname: store.nickname,
  });

  socket.on("roomData", (room) => {
    players.value = room.players || [];
    communityCards.value = room.communityCards || [];
    stage.value = room.stage || "preflop";
    ownerId.value = room.ownerId || null;
    ownerNickname.value = room.players?.find(p => p.id === room.ownerId)?.nickname || null;
    pot.value = room.pot || 0;
    currentMaxBet.value = room.currentMaxBet || 0;
    currentTurnId.value = room.currentTurnId || null;
    currentTurnNickname.value = room.players?.find(p => p.id === room.currentTurnId)?.nickname || null;
  });

  socket.on("gameStarted", (room) => {
    players.value = room.players;
    communityCards.value = room.communityCards;
    stage.value = room.stage;
    pot.value = room.pot || 0;
    currentMaxBet.value = room.currentMaxBet || 0;
    ownerId.value = room.ownerId || null;
    ownerNickname.value = room.players?.find(p => p.id === room.ownerId)?.nickname || null;
    currentTurnId.value = room.currentTurnId || null;
    currentTurnNickname.value = room.players?.find(p => p.id === room.currentTurnId)?.nickname || null;
    showdownModal.value = false;
    showdownPots.value = [];
  });

  socket.on("stageUpdated", (room) => {
    communityCards.value = room.communityCards;
    stage.value = room.stage;
    pot.value = room.pot || 0;
    currentMaxBet.value = room.currentMaxBet || 0;
    players.value = room.players;
    currentTurnId.value = room.currentTurnId || null;
    currentTurnNickname.value = room.players?.find(p => p.id === room.currentTurnId)?.nickname || null;
  });

  socket.on("betPlaced", (room) => {
    players.value = room.players;
    currentMaxBet.value = room.currentMaxBet || 0;
    pot.value = room.pot || 0;
  });

  socket.on("turnUpdated", (payload) => {
    currentTurnId.value = payload.currentTurnId || null;
    currentTurnNickname.value = payload.currentTurnNickname || null;
  });

  socket.on("playerFolded", (room) => {
    players.value = room.players;
  });

  socket.on("playerChecked", ({ room }) => {
    players.value = room.players;
  });

  socket.on("bettingRoundEnded", (room) => {
    players.value = room.players || players.value;
    pot.value = room.pot || pot.value;
    currentTurnId.value = room.currentTurnId || null;
    currentTurnNickname.value = room.players?.find(p => p.id === room.currentTurnId)?.nickname || null;

    if (socket.id === room.ownerId) {
      alert("本轮下注已结束 — 你是房主，可点击「下一阶段」推进游戏。");
    }
  });

  socket.on("showdown", ({ pots, room }) => {
    showdownPots.value = pots || [];
    players.value = room.players || players.value;
    pot.value = room.pot || 0;
    stage.value = room.stage || "showdown";
    currentTurnId.value = room.currentTurnId || null;
    showdownModal.value = true;
  });

  socket.on("errorMessage", (err) => {
    alert(err.message || "服务器返回错误");
  });
});

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
  socket.disconnect();
});

function isLocalPlayer(player) {
  return player.id === socket.id;
}

const isOwner = computed(() => socket.id === ownerId.value);
const isMyTurn = computed(() => socket.id === currentTurnId.value && localPlayer.value && !localPlayer.value.folded && localPlayer.value.chips > 0 && stage.value !== "showdown");
const canCheck = computed(() => {
  const p = localPlayer.value;
  if (!p) return false;
  return (p.currentBet || 0) === (currentMaxBet.value || 0);
});

function startGame() { socket.emit("startGame", store.roomId); }
function nextStage() { socket.emit("nextStage", store.roomId); }
function restartGame() { if (!isOwner.value) return; socket.emit("restartGame", { roomId: store.roomId }); }
function doCall() { if (!isMyTurn.value) return; socket.emit("call", { roomId: store.roomId }); }
function doRaise(amount) {
  const amt = Math.max(0, Math.floor(Number(amount) || 0));
  if (!isMyTurn.value) return;
  if (amt <= 0) return;
  socket.emit("raise", { roomId: store.roomId, raiseAmount: amt });
}
function doFold() { if (!isMyTurn.value) return; socket.emit("fold", { roomId: store.roomId }); }
function doCheck() { if (!isMyTurn.value) return; socket.emit("check", { roomId: store.roomId }); }

function closeModal() {
  showdownModal.value = false;
  showdownPots.value = [];
}

/* playerPosition 保留以兼容旧逻辑（目前卡片布局不使用） */
function playerPosition(index, total) {
  if (!players.value || players.value.length === 0) {
    return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  }
  if (isMobile.value) {
    return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  }
  const containerW = Math.min(window.innerWidth, 900);
  const containerH = Math.min(window.innerHeight * 0.6, 500);
  const centerX = containerW / 2;
  const centerY = containerH / 2;
  const radiusX = Math.min(360, containerW / 2 - 80);
  const radiusY = Math.min(220, containerH / 2 - 40);
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
  const x = centerX + radiusX * Math.cos(angle);
  const y = centerY + radiusY * Math.sin(angle);
  const z = Math.floor(1000 - y);
  return {
    left: `${x}px`,
    top: `${y}px`,
    transform: `translate(-50%, -50%)`,
    zIndex: z
  };
}
</script>

<style>
/* modal transitions */
.modal-enter-from, .modal-leave-to { opacity: 0; transform: scale(0.95); }
.modal-enter-to, .modal-leave-from { opacity: 1; transform: scale(1); }
.modal-enter-active { transition: all 0.25s ease-out; }
.modal-leave-active { transition: all 0.2s ease-in; }

/* safe-area + box-sizing */
.p-safe { padding-bottom: env(safe-area-inset-bottom); box-sizing: border-box; }
* { box-sizing: border-box; }

/* hide scrollbars */
.no-scrollbar::-webkit-scrollbar { display: none; }

/* 按钮中文小字（不使用 @apply） */
.btn-subtext {
  font-size: 11px;
  line-height: 1;
  opacity: 0.85;
}

/* general mobile button styles */
.mobile-btn {
  min-width: 0;
  width: 100%;
  height: 44px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
}

/* 双行按钮在手机上稍微加高一点，便于显示英文+中文 */
.mobile-btn.two-line {
  height: 52px;
  padding-top: 2px;
  padding-bottom: 2px;
}

/* small owner buttons */
.mobile-btn.small { height: 36px; font-size: 13px; font-weight: 600; }

/* color variants */
.mobile-btn.primary { background: linear-gradient(90deg,#7c3aed,#4f46e5); color: #fff; }
.mobile-btn.secondary { background: #4b5563; color: #fff; }
.mobile-btn.danger { background: #7c5a3e; color: #fff; }
.mobile-btn.raise { background: #f59e0b; color: #071126; }
.mobile-btn.quick { background: #fb923c; color: #071126; }
.mobile-btn.owner { color: #fff; }
.owner-enabled { background:#16a34a; } /* green */
.owner-disabled { background:#374151; opacity:0.7; }

/* slider accent */
input[type="range"] { accent-color: #f59e0b; height: 26px; }

/* mobile-specific layout tweaks */
@media (max-width: 420px) {
  .mobile-controls { overflow-x: hidden; -webkit-overflow-scrolling: touch; border-radius: 12px; box-shadow: 0 6px 18px rgba(2,6,23,0.6); }
  .player-card .flex-1 { min-width: 0; }
  .players-grid, .mobile-controls, .player-card { max-width: 100vw; }
  .player-card { padding: 8px; }
  .w-11 { width: 44px; height: 56px; }
}

/* desktop tweaks */
@media (min-width: 421px) {
  .mobile-controls { display: none; }
}
</style>