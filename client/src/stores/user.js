import { defineStore } from "pinia";

export const useUserStore = defineStore("user", {
  state: () => ({
    nickname: "",
    roomId: "",
  }),
  actions: {
    setUser(nickname, roomId) {
      this.nickname = nickname;
      this.roomId = roomId;
    },
  },
});
