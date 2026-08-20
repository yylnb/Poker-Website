import OpenAI from "openai";
import { applyPlayerAction, buildAiGameState, getLegalActions } from "./gameEngine.js";

export const AI_COMMENT_LIMIT = 20;
export const AI_SYSTEM_PROMPT = [
  "你是一名风格均衡、有个性的德州扑克玩家。",
  "只根据给出的牌局状态和 legalActions 决策，绝不能猜测或索取其他玩家底牌。",
  "输出严格 JSON，不要输出 Markdown、分析过程或 JSON 以外的文字。",
  'JSON 格式示例：{"action":"call","raiseAmount":null,"message":"这轮有点意思。"}',
  `message 是你对桌上其他玩家说的中文评论，必须自然且不超过 ${AI_COMMENT_LIMIT} 个字符。`,
  "message 可以自由聊天、开玩笑、挑衅、虚张声势或表达情绪；除保密要求外，不限制内容和风格。",
  "最重要的保密规则：自己的底牌只能用于内部决策，绝不能在 message 中直接透露，也不能让别人从措辞中推断出来。",
  "message 不得提及或暗示自己的点数、花色、对子、两对、三条、顺子、同花、葫芦、四条、听牌、踢脚、牌力、胜率或强弱判断。",
  "禁止类似‘顶对当然要加注’、‘我在听花’、‘这手牌很强’、‘这两张值得跟’的评论。",
  "公开信息可以评论；输出前请在内部检查 message 是否可能泄露自己的手牌，但不要输出检查过程。",
].join("\n");

function normalizeAiMessage(message) {
  const trimmed = typeof message === "string" ? message.trim() : "";
  if (!trimmed) throw new Error("AI returned empty comment");
  return [...trimmed].slice(0, AI_COMMENT_LIMIT).join("");
}

export function createDeepSeekProvider({
  apiKey = process.env.DEEPSEEK_API_KEY,
  baseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
  model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
  timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 8000,
} = {}) {
  const client = apiKey ? new OpenAI({ apiKey, baseURL }) : null;

  return {
    configured: Boolean(client),
    model,
    async decide(gameState) {
      if (!client) throw new Error("DEEPSEEK_API_KEY is not configured");

      const completion = await client.chat.completions.create({
        model,
        temperature: 0.7,
        max_tokens: 256,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: AI_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: `请根据以下牌局状态选择一个合法动作并输出 JSON：\n${JSON.stringify(gameState)}`,
          },
        ],
      }, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      return completion.choices[0]?.message?.content || "";
    },
  };
}

export function parseAiDecision(content, legalActions) {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("AI returned empty content");
  }

  const parsed = JSON.parse(content);
  const action = String(parsed.action || "").toLowerCase();
  const legal = legalActions.find((candidate) => candidate.action === action);
  if (!legal) throw new Error(`AI returned illegal action: ${action}`);

  let raiseAmount = null;
  if (action === "raise") {
    raiseAmount = Math.floor(Number(parsed.raiseAmount));
    if (!Number.isFinite(raiseAmount)
      || raiseAmount < legal.minRaiseAmount
      || raiseAmount > legal.maxRaiseAmount) {
      throw new Error("AI returned illegal raise amount");
    }
  }

  const message = normalizeAiMessage(parsed.message);
  return { action, raiseAmount, message };
}

export function conservativeFallback(room, botId) {
  const legalActions = getLegalActions(room, botId);
  const action = legalActions.some((candidate) => candidate.action === "check") ? "check" : "call";
  return {
    action,
    raiseAmount: null,
    message: "网络不稳，先稳一手。",
  };
}

export async function runBotTurn(room, provider) {
  const botId = room.currentTurnId;
  const bot = room.players.find((player) => player.id === botId && player.isBot);
  if (!bot || !room.handInProgress) return { skipped: true };

  const turnVersion = room.turnVersion;
  const legalActions = getLegalActions(room, botId);
  let decision;
  let fallback = false;
  let error = null;

  try {
    const content = await provider.decide(buildAiGameState(room, botId));
    decision = parseAiDecision(content, legalActions);
  } catch (caught) {
    fallback = true;
    error = caught;
    decision = conservativeFallback(room, botId);
  }

  if (!room.handInProgress || room.currentTurnId !== botId || room.turnVersion !== turnVersion) {
    return { stale: true, error };
  }

  const result = applyPlayerAction(room, botId, decision);
  return { bot, decision, result, fallback, error };
}
