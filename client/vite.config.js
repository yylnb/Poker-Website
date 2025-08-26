import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// export default defineConfig({
//   plugins: [vue()],
//   server: {
//     host: '0.0.0.0',    //"192.168.1.11",   //host: true,
//     port: 8080,
//     // allowedHosts: [
//     //   'greatgoat.f1.luyouxia.net'
//     // ]
//   }
// });

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 8080,
    proxy: {
      '/socket.io': {
        target:'http://192.168.1.11:3001', // 后端实际地址
        ws: true,
        changeOrigin: true,
      },
    },
    allowedHosts: [
      'greatgoat.f1.luyouxia.net'
    ]
  },
});