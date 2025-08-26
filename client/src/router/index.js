// import { createRouter, createWebHistory } from 'vue-router'
// import Lobby from '../components/Lobby.vue'
// import GameTable from '../components/GameTable.vue'

// export default createRouter({
//   history: createWebHistory(),
//   routes: [
//     { path: '/', component: Lobby },
//     { path: '/game/:roomId', component: GameTable, props: true }
//   ]
// })

// import { createRouter, createWebHistory } from "vue-router";
// import JoinRoom from "../views/JoinRoom.vue";
// import GameTable from "../views/GameTable.vue";

// const routes = [
//   { path: "/", name: "JoinRoom", component: JoinRoom },
//   { path: "/game", name: "GameTable", component: GameTable },
// ];

// const router = createRouter({
//   history: createWebHistory(),
//   routes,
// });

// export default router;

import { createRouter, createWebHistory } from "vue-router";
import JoinRoom from "../pages/JoinRoom.vue";
import GameTable from "../pages/GameTable.vue";

const routes = [
  { path: "/", component: JoinRoom },
  { path: "/game", component: GameTable },
];

export default createRouter({
  history: createWebHistory(),
  routes,
});

