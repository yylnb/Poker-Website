<template>
  <div class="min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_center,#0a0f0a,#000000)] text-white p-safe">
    <div class="w-full max-w-md px-4">
      <div class="glass-card p-6 flex flex-col gap-4 items-stretch">
        <div class="text-center">
          <h1 class="text-3xl sm:text-4xl font-bold">PokerYY</h1>
          <div class="text-xs sm:text-sm text-white/60 tracking-wider mt-1">德州扑克网站</div>
        </div>

        <label class="text-xs text-white/80">昵称</label>
        <input
          v-model="nickname"
          type="text"
          placeholder="输入你的昵称"
          :class="['glass-input w-full text-black', isMobile ? 'p-5 text-xl' : 'p-4 text-lg']"
        />

        <label class="text-xs text-white/80">房间号</label>
        <input
          v-model="roomId"
          type="text"
          placeholder="输入房间号"
          :class="['glass-input w-full text-black', isMobile ? 'p-5 text-xl' : 'p-4 text-lg']"
        />

        <button
          @click="joinRoom"
          :class="['btn btn-primary mt-2 w-full text-lg', isMobile ? 'py-4 text-xl' : 'py-3']"
        >
          进入德州扑克房间
        </button>

        <!-- <div class="text-xs text-white/60 text-center mt-2">
          Tip: 手机请连接与服务器相同的 Wi-Fi，访问局域网 IP（例如 http://192.168.1.11:8080）。
        </div> -->
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useUserStore } from "../stores/user";

const nickname = ref("");
const roomId = ref("");
const router = useRouter();
const store = useUserStore();

// 移动端判断，阈值与 GameTable 保持一致 (420)
const isMobile = ref(window.innerWidth < 420);
function handleResize() {
  isMobile.value = window.innerWidth < 420;
}
onMounted(() => {
  window.addEventListener("resize", handleResize);
});
onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
});

function joinRoom() {
  if (!nickname.value || !roomId.value) {
    alert("请输入昵称和房间号");
    return;
  }
  store.setUser(nickname.value, roomId.value);
  router.push("/game");
}
</script>

<style>
/* safe-area for devices with notch */
.p-safe {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}

/* small visual polish for desktop */
@media (min-width: 960px) {
  .rounded-xl { box-shadow: 0 10px 30px rgba(2,6,23,0.6); }
}

/* mobile tweaks */
@media (max-width: 420px) {
  input { border-radius: 14px; }
  button { border-radius: 14px; }
}
</style>
