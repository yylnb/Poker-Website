// 仅移动端原生振动反馈；桌面浏览器 navigator.vibrate 不存在时静默无操作。
// 用户偏好：只要振动，不要声音。

export function haptic(ms = 15) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (_) {
    // 静默降级：不支持的设备/浏览器直接跳过
  }
}

export function actionFeedback(kind) {
  // all-in 振动稍长以区别于普通操作；其余动作统一 15ms
  haptic(kind === "allin" ? 25 : 15);
}
