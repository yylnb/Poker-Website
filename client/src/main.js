import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";

import "./assets/index.css";

import Home from "./pages/Home.vue";
import GameTable from "./pages/GameTable.vue";

const routes = [
  { path: "/", component: Home },
  { path: "/game", component: GameTable },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

createApp(App).use(createPinia()).use(router).mount("#app");
