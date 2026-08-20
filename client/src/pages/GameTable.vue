<template>
  <div class="h-dvh flex flex-col items-center justify-start bg-[radial-gradient(circle,#0a0f0a,#000000)] overflow-hidden p-safe">
    <div class="relative w-full mx-auto px-3 flex flex-col flex-1 min-h-0" style="max-width:980px; box-sizing: border-box;">

      <!-- 顶部：返回按钮 + 房间标题（flex-shrink-0 不参与滚动） -->
      <div class="flex-shrink-0">
        <!-- 左上角返回大厅按钮 -->
        <button
          @click="goLobby"
          class="btn btn-ghost absolute top-2 left-2 z-50 px-3 py-1.5 text-sm"
        >
          返回大厅
        </button>

        <!-- 房间标题 -->
        <div class="w-full text-center text-white/90 text-sm mt-10 mb-2">
          PokerYY -- 房间号：{{ store.roomId }}
        </div>

        <div v-if="isOwner" class="ai-toolbar flex items-center justify-center gap-2 mb-2">
          <button
            @click="addAiPlayer"
            :disabled="!canManageBots || botCount >= 3"
            class="btn btn-ghost ai-add-button inline-flex items-center justify-center gap-2 text-xs"
            title="添加 AI 玩家"
          >
            <Bot :size="16" aria-hidden="true" />
            <Plus :size="14" aria-hidden="true" />
            <span>添加 AI</span>
            <span class="text-white/60">{{ botCount }}/3</span>
          </button>
          <span v-if="!canManageBots" class="text-[11px] text-white/50">本局结束后可调整</span>
        </div>
      </div>

      <!-- 中部可滚动区：台面 + 玩家区（顶部和底部控制栏均不滚动） -->
      <div class="game-mid flex-1 min-h-0 overflow-y-auto">
        <!-- 中央：公共牌与底池显示 -->
        <div class="mx-auto w-full mt-3 sm:mt-5" style="max-width:900px;">
        <div
          class="mx-auto felt flex items-center justify-center"
          :style="tableStyle"
        >
          <div class="flex flex-col items-center gap-3 p-3 w-full">
            <div class="flex gap-2 overflow-auto px-2 justify-center">
              <div
                v-for="(card, idx) in communityCards"
                :key="idx"
                class="community-card w-12 sm:w-20 h-24 sm:h-28 bg-white flex items-center justify-center rounded-lg shadow-md text-sm sm:text-lg"
                :class="cardColor(card)"
              >
                {{ card }}
              </div>

              <div v-if="communityCards.length === 0" class="text-white/60 self-center px-2">
                公共牌（暂无）
              </div>
            </div>

            <div class="pot-badge">
              <span class="chip-icon"></span>底池 {{ pot }}K
            </div>

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
          class="grid grid-cols-2 gap-3 justify-center items-start"
        >
          <div
            v-for="(player, index) in players"
            :key="player.id"
            class="player-card glass-card relative text-white p-3 flex flex-wrap gap-3 items-start self-start w-full"
            :class="{ 'turn-active': currentTurnId === player.id }"
          >
            <button
              v-if="player.isBot && canManageBots"
              @click="removeAiPlayer(player.id)"
              class="bot-remove-button"
              :title="`移除 ${player.nickname}`"
              :aria-label="`移除 ${player.nickname}`"
            >
              <X :size="14" aria-hidden="true" />
            </button>
            <div
              class="w-12 h-12 rounded-full flex items-center justify-center text-base font-medium flex-shrink-0"
              :class="isLocalPlayer(player) ? 'ring-4 ring-green-400' : ''"
              :style="{ background: player.isBot ? 'linear-gradient(#475569,#1e293b)' : isLocalPlayer(player) ? 'linear-gradient(#10b981,#065f46)' : 'linear-gradient(#f59e0b,#b45309)' }"
            >
              <Bot v-if="player.isBot" :size="22" aria-hidden="true" />
              <span v-else>{{ (player.nickname || '?').charAt(0) }}</span>
            </div>

            <div class="flex-1 min-w-0">
              <div class="font-medium text-xs truncate pr-4 mb-1">{{ player.nickname }}</div>
              <Transition name="hand-slot">
                <div v-if="player.hand?.length" class="hand-slot flex gap-2">
                  <div
                    v-for="(card, cIndex) in player.hand"
                    :key="cIndex"
                    class="w-11 h-14 rounded-lg bg-white text-black flex items-center justify-center text-xs"
                  >
                    <span v-if="isLocalPlayer(player) || stage === 'showdown'" :class="cardColor(card)">{{ card }}</span>
                    <span v-else>?</span>
                  </div>
                </div>
              </Transition>

              <div class="text-xs text-white/90">
                <div class="font-medium truncate">{{ player.chips }}K</div>
                <div v-if="player.currentBet" class="bet-chip inline-flex items-center gap-1 text-[11px] text-yellow-200" :key="player.currentBet">
                  <span class="chip-icon"></span>{{ player.currentBet }}K
                </div>
                <div v-if="player.folded" class="text-[11px] text-red-300">已弃</div>
                <div v-if="currentTurnId === player.id" class="mt-1 inline-block px-2 py-0.5 text-[11px] bg-yellow-300 text-black rounded">
                  当前回合
                </div>
              </div>

            </div>

            <div
              v-if="player.isBot && (aiStatuses[player.id] === 'thinking' || aiMessages[player.id])"
              class="ai-message-slot"
            >
              <div v-if="aiStatuses[player.id] === 'thinking'" class="ai-thinking">
                <LoaderCircle :size="13" class="animate-spin" aria-hidden="true" />
                思考中
              </div>
              <div v-else class="ai-speech" :title="aiMessages[player.id].message">
                <span>{{ aiMessages[player.id].message }}</span>
                <span v-if="aiMessages[player.id].fallback" class="ai-fallback">降级</span>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="players-grid flex flex-wrap gap-3 justify-center items-start">
          <div
            v-for="(player, index) in players"
            :key="player.id"
            class="player-card glass-card relative text-white p-3 flex flex-wrap gap-3 items-start self-start w-48"
            :class="{ 'turn-active': currentTurnId === player.id }"
          >
            <button
              v-if="player.isBot && canManageBots"
              @click="removeAiPlayer(player.id)"
              class="bot-remove-button"
              :title="`移除 ${player.nickname}`"
              :aria-label="`移除 ${player.nickname}`"
            >
              <X :size="14" aria-hidden="true" />
            </button>
            <div
              class="w-14 h-14 rounded-full flex items-center justify-center text-base font-medium flex-shrink-0"
              :class="isLocalPlayer(player) ? 'ring-4 ring-green-400' : ''"
              :style="{ background: player.isBot ? 'linear-gradient(#475569,#1e293b)' : isLocalPlayer(player) ? 'linear-gradient(#10b981,#065f46)' : 'linear-gradient(#f59e0b,#b45309)' }"
            >
              <Bot v-if="player.isBot" :size="24" aria-hidden="true" />
              <span v-else>{{ (player.nickname || '?').charAt(0) }}</span>
            </div>

            <div class="flex-1 min-w-0">
              <div class="font-medium text-xs truncate pr-4 mb-1">{{ player.nickname }}</div>
              <Transition name="hand-slot">
                <div v-if="player.hand?.length" class="hand-slot flex gap-2">
                  <div
                    v-for="(card, cIndex) in player.hand"
                    :key="cIndex"
                    class="w-12 h-16 rounded-lg bg-white text-black flex items-center justify-center text-xs"
                  >
                    <span v-if="isLocalPlayer(player) || stage === 'showdown'" :class="cardColor(card)">{{ card }}</span>
                    <span v-else>?</span>
                  </div>
                </div>
              </Transition>

              <div class="text-xs text-white/90">
                <div class="font-medium truncate">{{ player.chips }}K</div>
                <div v-if="player.currentBet" class="bet-chip inline-flex items-center gap-1 text-[11px] text-yellow-200" :key="player.currentBet">
                  <span class="chip-icon"></span>{{ player.currentBet }}K
                </div>
                <div v-if="player.folded" class="text-[11px] text-red-300">已弃</div>
                <div v-if="currentTurnId === player.id" class="mt-1 inline-block px-2 py-0.5 text-[11px] bg-yellow-300 text-black rounded">
                  当前回合
                </div>
              </div>

            </div>

            <div
              v-if="player.isBot && (aiStatuses[player.id] === 'thinking' || aiMessages[player.id])"
              class="ai-message-slot"
            >
              <div v-if="aiStatuses[player.id] === 'thinking'" class="ai-thinking">
                <LoaderCircle :size="13" class="animate-spin" aria-hidden="true" />
                思考中
              </div>
              <div v-else class="ai-speech" :title="aiMessages[player.id].message">
                <span>{{ aiMessages[player.id].message }}</span>
                <span v-if="aiMessages[player.id].fallback" class="ai-fallback">降级</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
      <!-- /中部可滚动区 -->

      <!-- 控制栏：桌面与移动分别渲染 -->
      <!-- Desktop: 保持原有横向控制栏 -->
      <div v-if="!isMobile" class="fixed bottom-2 left-1/2 -translate-x-1/2 w-full max-w-[980px] px-3 z-40">
        <div class="glass-bar p-2 flex flex-col gap-2 items-center no-scrollbar">
          <div class="w-full flex items-center gap-2">
            <button
              @click="startGame"
              :disabled="!isOwner || handInProgress || stage === 'showdown'"
              class="btn btn-owner min-w-[90px] px-3 py-2 text-sm"
            >
              开始游戏
            </button>

            <button
              v-if="stage === 'showdown'"
              @click="restartGame"
              :disabled="!isOwner"
              class="btn btn-call min-w-[90px] px-3 py-2 text-sm"
            >
              Restart
            </button>

            <div class="flex gap-2 items-center pl-2">
              <!-- Call -->
              <button
                @click="doCall"
                :disabled="!isMyTurn"
                class="btn btn-call min-w-[70px] px-3 py-2 text-sm flex flex-col items-center leading-tight"
              >
                <span>Call</span>
                <span class="btn-subtext">跟注</span>
              </button>

              <!-- 快捷加注 -->
              <button @click="doRaise(10)" :disabled="!isMyTurn" class="btn btn-raise min-w-[70px] px-3 py-2 text-sm">+10K</button>
              <button @click="doRaise(50)" :disabled="!isMyTurn" class="btn btn-raise min-w-[70px] px-3 py-2 text-sm">+50K</button>
              <button @click="doRaise(100)" :disabled="!isMyTurn" class="btn btn-raise min-w-[70px] px-3 py-2 text-sm">+100K</button>

              <!-- Check -->
              <button
                @click="doCheck"
                :disabled="!isMyTurn || !canCheck"
                class="btn btn-check min-w-[70px] px-3 py-2 text-sm flex flex-col items-center leading-tight"
              >
                <span>Check</span>
                <span class="btn-subtext">过牌</span>
              </button>

              <!-- Fold -->
              <button
                @click="doFold"
                :disabled="!isMyTurn"
                class="btn btn-fold min-w-[70px] px-3 py-2 text-sm flex flex-col items-center leading-tight"
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
              class="btn btn-raise px-3 py-2 text-sm flex flex-col items-center leading-tight"
            >
              <span>Raise</span>
              <span class="btn-subtext">加注</span>
            </button>

            <!-- All-in -->
            <button
              @click="doAllIn"
              :disabled="!isMyTurn"
              class="btn btn-allin px-3 py-2 text-sm flex flex-col items-center leading-tight"
            >
              <span>All-in</span>
              <span class="btn-subtext">全押</span>
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
          class="glass-bar mobile-controls"
          :style="{ paddingBottom: 'env(safe-area-inset-bottom)', boxSizing: 'border-box' }"
        >
          <!-- 房主小控制 -->
          <div class="grid grid-cols-2 gap-2 p-2">
            <button @click="startGame" :disabled="!isOwner || handInProgress || stage === 'showdown'" :class="['mobile-btn small owner', isOwner && !handInProgress && stage !== 'showdown' ? 'owner-enabled' : 'owner-disabled']">开始游戏</button>
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
          <div class="grid grid-cols-4 gap-2 p-2">
            <button @click="doRaise(10)" :disabled="!isMyTurn" class="mobile-btn quick">+10K</button>
            <button @click="doRaise(50)" :disabled="!isMyTurn" class="mobile-btn quick">+50K</button>
            <button @click="doRaise(100)" :disabled="!isMyTurn" class="mobile-btn quick">+100K</button>
            <button @click="doAllIn" :disabled="!isMyTurn" class="mobile-btn allin">All-in</button>
          </div>
        </div>
      </div>

      <!-- Showdown Modal -->
      <transition name="modal" enter-active-class="ease-out duration-300" leave-active-class="ease-in duration-200">
        <div v-if="showdownModal" class="fixed inset-0 z-50 flex items-center justify-center">
          <div class="absolute inset-0 glass-overlay" @click="closeModal"></div>

          <div
            class="relative bg-white/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-6 w-[720px] max-w-[95%] transform transition-transform"
            :class="{'scale-100 opacity-100': showdownModal, 'scale-95 opacity-0': !showdownModal}"
          >
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-2xl font-bold text-gray-900">摊牌结果</h3>
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
                      <div class="font-medium text-black">{{ w.nickname }}</div>
                      <div class="text-xs text-gray-600">赢得: {{ w.share }}K</div>
                      <div class="text-xs text-gray-500">牌型: {{ w.handName }}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="p-3 border rounded-lg bg-yellow-50">
                <div class="font-medium text-black">最终筹码</div>
                <div class="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2">
                  <div v-for="p in players" :key="p.id" class="text-sm bg-white p-2 rounded">
                    <div class="font-medium text-black">{{ p.nickname }}</div>
                    <div class="text-xs text-gray-600">筹码: {{ p.chips }}K</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-4 flex justify-end gap-2">
              <button v-if="isOwner" @click="restartGame" class="btn btn-call px-4 py-2">Restart</button>
              <button @click="closeModal" class="px-4 py-2 rounded border border-gray-300 bg-white text-gray-700 font-semibold hover:bg-gray-100">关闭</button>
            </div>
          </div>
        </div>
      </transition>

      <!-- 轮次提示全屏 overlay -->
      <transition name="announce">
        <div v-if="announcement.show"
             class="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
          <div class="glass-overlay absolute inset-0"></div>
          <div class="relative text-center px-6">
            <div class="text-white/70 text-base sm:text-lg tracking-[0.4em] mb-3">下一轮</div>
            <div class="announce-text text-5xl sm:text-7xl font-bold text-white drop-shadow-2xl">
              {{ announcement.text }}
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
import { Bot, LoaderCircle, Plus, X } from "lucide-vue-next";
import { useRouter } from "vue-router";
import { useUserStore } from "../stores/user";
import { actionFeedback } from "../utils/feedback";

const router = useRouter();
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
const handInProgress = ref(false);
const aiStatuses = ref({});
const aiMessages = ref({});
const aiMessageTimers = new Map();

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
  const h = Math.min(window.innerHeight * (isMobile.value ? 0.32 : 0.34), isMobile.value ? 220 : 320);
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

function applyRoom(room) {
  if (!room) return;
  players.value = room.players || [];
  communityCards.value = room.communityCards || [];
  stage.value = room.stage || "preflop";
  ownerId.value = room.ownerId || null;
  ownerNickname.value = room.players?.find(p => p.id === room.ownerId)?.nickname || null;
  pot.value = room.pot || 0;
  currentMaxBet.value = room.currentMaxBet || 0;
  currentTurnId.value = room.currentTurnId || null;
  currentTurnNickname.value = room.players?.find(p => p.id === room.currentTurnId)?.nickname || null;
  handInProgress.value = Boolean(room.handInProgress);
}

onMounted(() => {
  socket.emit("joinRoom", {
    roomId: store.roomId,
    nickname: store.nickname,
  });

  socket.on("roomData", (room) => {
    applyRoom(room);
  });

  socket.on("gameStarted", (room) => {
    applyRoom(room);
    showdownModal.value = false;
    showdownPots.value = [];
  });

  socket.on("stageUpdated", (room) => {
    applyRoom(room);
    if (stageTextMap[room.stage]) showAnnounce("下一轮：" + stageTextMap[room.stage]);
  });

  socket.on("betPlaced", (room) => {
    applyRoom(room);
  });

  socket.on("turnUpdated", (payload) => {
    currentTurnId.value = payload.currentTurnId || null;
    currentTurnNickname.value = payload.currentTurnNickname || null;
  });

  socket.on("playerFolded", (room) => {
    applyRoom(room);
  });

  socket.on("playerChecked", ({ room }) => {
    applyRoom(room);
  });

  socket.on("bettingRoundEnded", (room) => {
    applyRoom(room);
    // 阶段推进由服务端自动完成，紧接着的 stageUpdated 会更新公共牌与新回合
  });

  socket.on("showdown", ({ pots, room }) => {
    showdownPots.value = pots || [];
    applyRoom(room);
    showdownModal.value = true;
    if (stageTextMap.showdown) showAnnounce("下一轮：" + stageTextMap.showdown);
  });

  socket.on("aiStatus", ({ botId, status }) => {
    aiStatuses.value = { ...aiStatuses.value, [botId]: status };
  });

  socket.on("aiAction", ({ botId, message, fallback }) => {
    aiStatuses.value = { ...aiStatuses.value, [botId]: "idle" };
    aiMessages.value = { ...aiMessages.value, [botId]: { message, fallback } };
    if (aiMessageTimers.has(botId)) clearTimeout(aiMessageTimers.get(botId));
    aiMessageTimers.set(botId, setTimeout(() => {
      const nextMessages = { ...aiMessages.value };
      delete nextMessages[botId];
      aiMessages.value = nextMessages;
      aiMessageTimers.delete(botId);
    }, 8000));
  });

  socket.on("errorMessage", (err) => {
    alert(err.message || "服务器返回错误");
  });
});

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
  socket.disconnect();
  if (announceTimer) clearTimeout(announceTimer);
  for (const timer of aiMessageTimers.values()) clearTimeout(timer);
  aiMessageTimers.clear();
});

function isLocalPlayer(player) {
  return player.id === socket.id;
}

function cardColor(card) {
  if (!card) return 'text-gray-800';
  return (card.includes('♥') || card.includes('♦')) ? 'text-red-600' : 'text-gray-800';
}

// 轮次提示
const announcement = ref({ show: false, text: "" });
let announceTimer = null;
function showAnnounce(text) {
  announcement.value = { show: true, text };
  if (announceTimer) clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { announcement.value.show = false; }, 2500);
}
const stageTextMap = {
  preflop: "翻牌前",
  flop: "翻牌圈",
  turn: "转牌圈",
  river: "河牌圈",
  showdown: "最终摊牌"
};

const isOwner = computed(() => socket.id === ownerId.value);
const botCount = computed(() => players.value.filter(player => player.isBot).length);
const canManageBots = computed(() => isOwner.value && (!handInProgress.value || stage.value === "showdown"));
const isMyTurn = computed(() => socket.id === currentTurnId.value && localPlayer.value && !localPlayer.value.folded && localPlayer.value.chips > 0 && stage.value !== "showdown");
const canCheck = computed(() => {
  const p = localPlayer.value;
  if (!p) return false;
  return (p.currentBet || 0) === (currentMaxBet.value || 0);
});

function startGame() { socket.emit("startGame", store.roomId); }
function restartGame() { if (!isOwner.value) return; socket.emit("restartGame", { roomId: store.roomId }); }
function addAiPlayer() {
  if (!canManageBots.value || botCount.value >= 3) return;
  socket.emit("addBot", { roomId: store.roomId });
}
function removeAiPlayer(botId) {
  if (!canManageBots.value) return;
  socket.emit("removeBot", { roomId: store.roomId, botId });
}
function doCall() { if (!isMyTurn.value) return; actionFeedback("call"); socket.emit("call", { roomId: store.roomId }); }
function doRaise(amount) {
  const amt = Math.max(0, Math.floor(Number(amount) || 0));
  if (!isMyTurn.value) return;
  if (amt <= 0) return;
  actionFeedback("raise");
  socket.emit("raise", { roomId: store.roomId, raiseAmount: amt });
}

function doAllIn() {
  if (!isMyTurn.value || !localPlayer.value) return;
  actionFeedback("allin");
  socket.emit("raise", { roomId: store.roomId, raiseAmount: localPlayer.value.chips });
}
function doFold() { if (!isMyTurn.value) return; actionFeedback("fold"); socket.emit("fold", { roomId: store.roomId }); }
function doCheck() { if (!isMyTurn.value) return; actionFeedback("check"); socket.emit("check", { roomId: store.roomId }); }

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

function goLobby() {
  router.push("/");
}
</script>

<style>
/* 中部游戏区滚动（台面 + 玩家卡），顶部和底部控制栏不滚 */
.game-mid {
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;          /* Firefox */
  -ms-overflow-style: none;       /* IE/Edge */
}
.game-mid::-webkit-scrollbar { display: none; }  /* Chrome/Safari */
@media (max-width: 420px)  { .game-mid { padding-bottom: 240px; } }
@media (min-width: 421px)  { .game-mid { padding-bottom: 100px; } }

.ai-toolbar { min-height: 34px; }
.ai-add-button { min-width: 132px; height: 34px; padding: 0 10px; }
.players-grid { align-items: flex-start; }
.player-card {
  align-content: flex-start;
  align-self: flex-start;
  height: auto;
}
.hand-slot {
  max-height: 64px;
  margin-bottom: 8px;
  overflow: hidden;
  transform-origin: top;
}
.hand-slot-enter-active,
.hand-slot-leave-active {
  transition: max-height 180ms ease, margin-bottom 180ms ease, opacity 140ms ease, transform 180ms ease;
}
.hand-slot-enter-from,
.hand-slot-leave-to {
  max-height: 0;
  margin-bottom: 0;
  opacity: 0;
  transform: translateY(-4px);
}
.ai-message-slot { flex: 0 0 100%; width: 100%; }
.ai-thinking,
.ai-speech {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  width: 100%;
  min-height: 40px;
  max-width: 100%;
  padding: 6px 8px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.72);
  color: rgba(255, 255, 255, 0.88);
  font-size: 11px;
  line-height: 1.4;
}
.ai-speech > span:first-child {
  flex: 1;
  min-width: 0;
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
  overflow-wrap: anywhere;
}
.ai-fallback {
  flex-shrink: 0;
  padding: 1px 4px;
  border-radius: 4px;
  background: #a16207;
  color: #fef9c3;
  font-size: 9px;
}
.bot-remove-button {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.84);
  color: rgba(255, 255, 255, 0.72);
}
.bot-remove-button:hover { background: #991b1b; color: #fff; }
.bot-remove-button:focus-visible { outline: 2px solid #facc15; outline-offset: 2px; }

/* 轮次提示全屏动画 */
.announce-enter-active { transition: opacity .3s ease-out; }
.announce-leave-active { transition: opacity .5s ease-in; }
.announce-enter-from, .announce-leave-to { opacity: 0; }
.announce-enter-to, .announce-leave-from { opacity: 1; }
@keyframes announce-in {
  0%   { transform: scale(0.7); }
  60%  { transform: scale(1.05); }
  100% { transform: scale(1); }
}
.announce-text { animation: announce-in .5s ease-out; }

/* 当前回合玩家卡脉冲发光 */
.turn-active { animation: turn-pulse 1.6s ease-in-out infinite; border-color: rgba(250,204,21,.6); }

/* 公共牌发牌动画 */
.community-card { animation: card-deal .35s ease-out; }

/* 下注筹码弹出动画 */
.bet-chip { animation: chip-bet .25s ease-out; }

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
